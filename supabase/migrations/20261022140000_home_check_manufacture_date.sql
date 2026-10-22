-- Landlord plate corrections can include a manufacture month and year.
-- Age is computed here from that date and the current date. An incomplete date stays unknown.
create or replace function public.confirm_home_check_label_review(p_check_id uuid, p_landlord_id uuid, p_corrections jsonb default '[]')
returns void language plpgsql set search_path = public as $$
declare
  c public.home_checks;
  correction jsonb;
  asset public.unit_assets;
  field text;
  key text;
  value text;
  meta jsonb;
  manufacture_year integer;
  manufacture_month integer;
  age_years integer;
  age_basis text;
  now_utc timestamp := timezone('utc', now());
begin
  select * into strict c from public.home_checks where id = p_check_id and landlord_id = p_landlord_id for update;
  if c.completed_at is null then raise exception 'All four photos are required'; end if;
  if exists(select 1 from public.home_check_photos h join public.property_inspection_photos p on p.id = h.inspection_photo_id where h.check_id = c.id and p.status in ('queued', 'analyzing')) then raise exception 'Equipment photo reading is still processing'; end if;
  if jsonb_typeof(p_corrections) <> 'array' or jsonb_array_length(p_corrections) > 2 then raise exception 'Invalid label corrections'; end if;
  for correction in select * from jsonb_array_elements(p_corrections) loop
    select * into strict asset from public.unit_assets where id = (correction->>'assetId')::uuid and home_check_id = c.id and landlord_id = c.landlord_id for update;
    meta := asset.metadata;
    foreach field in array array['modelNumber', 'serialNumber'] loop
      if not (correction ? field) then continue; end if;
      if jsonb_typeof(correction->field) not in ('string', 'null') then raise exception 'Label corrections must be text'; end if;
      value := nullif(trim(correction->>field), '');
      if length(value) > 80 or value ~ '[?\[\]{}]' then raise exception 'Enter only label characters you can read'; end if;
      key := case when field = 'modelNumber' then 'model' else 'serial' end;
      meta := jsonb_set(meta, array['homeCheck','fields',key], coalesce(meta#>array['homeCheck','fields',key], '{}') || jsonb_build_object('value', value, 'source', 'landlord', 'confidence', case when value is null then 'low' else 'high' end, 'basis', 'Landlord checked the data plate and supplied this text.'));
      if field = 'modelNumber' then update public.unit_assets set model = value where id = asset.id;
      else meta := jsonb_set(meta, '{serialNumber}', coalesce(to_jsonb(value), 'null')); end if;
    end loop;
    if correction ? 'manufactureYear' or correction ? 'manufactureMonth' then
      if correction ? 'manufactureYear' and jsonb_typeof(correction->'manufactureYear') not in ('number', 'null') then raise exception 'Enter a manufacture year from the data plate.'; end if;
      if correction ? 'manufactureMonth' and jsonb_typeof(correction->'manufactureMonth') not in ('number', 'null') then raise exception 'Enter a manufacture month from the data plate.'; end if;
      manufacture_year := nullif(correction->>'manufactureYear', '')::integer;
      manufacture_month := nullif(correction->>'manufactureMonth', '')::integer;
      if manufacture_year is not null and (manufacture_year < 1970 or manufacture_year > extract(year from now_utc)::integer) then
        raise exception 'Enter a manufacture year from the data plate.';
      end if;
      if manufacture_month is not null and (manufacture_month < 1 or manufacture_month > 12) then
        raise exception 'Enter a manufacture month from the data plate.';
      end if;
      if manufacture_year is null or manufacture_month is null then
        age_years := null;
        age_basis := case
          when manufacture_year is not null then format('Manufacture year %s is visible, but the month is not, so age stays unknown.', manufacture_year)
          else 'The manufacture date is unclear, so age stays unknown.'
        end;
      elsif extract(month from now_utc)::integer = manufacture_month then
        age_years := null;
        age_basis := format(
          'Manufacture month is %s %s, but the day is not on the label. Age could be %s or %s years as of %s, so it stays unknown.',
          to_char(make_date(2000, manufacture_month, 1), 'FMMonth'),
          manufacture_year,
          extract(year from now_utc)::integer - manufacture_year - 1,
          extract(year from now_utc)::integer - manufacture_year,
          to_char(now_utc, 'FMMonth FMDD, YYYY')
        );
      else
        age_years := extract(year from now_utc)::integer - manufacture_year
          - case when extract(month from now_utc)::integer > manufacture_month then 0 else 1 end;
        age_basis := format(
          'Manufacture date %s %s. Age is %s years as of %s.',
          to_char(make_date(2000, manufacture_month, 1), 'FMMonth'),
          manufacture_year,
          age_years,
          to_char(now_utc, 'FMMonth FMDD, YYYY')
        );
      end if;
      meta := jsonb_set(meta, '{homeCheck,manufactureDate}', jsonb_build_object('year', manufacture_year, 'month', manufacture_month));
      meta := jsonb_set(
        meta,
        '{homeCheck,fields,approximateAge}',
        coalesce(meta#> '{homeCheck,fields,approximateAge}', '{}') || jsonb_build_object(
          'value', age_years,
          'source', 'landlord',
          'confidence', case when age_years is null then 'low' else 'high' end,
          'estimated', true,
          'basis', age_basis
        )
      );
      meta := meta || jsonb_build_object('ageBasis', 'landlord_plate');
      update public.unit_assets set estimated_age_years = age_years, metadata = meta where id = asset.id;
      meta := (select metadata from public.unit_assets where id = asset.id);
    end if;
    update public.unit_assets set metadata = meta || jsonb_build_object('landlordLabelVerified', true) where id = asset.id;
    insert into public.home_check_events(check_id, event_type, role, metadata) values(c.id, 'landlord_label_corrected', c.role, jsonb_build_object('asset_id', asset.id, 'actor_role', 'landlord'));
  end loop;
  if exists(select 1 from public.unit_assets a where a.home_check_id = c.id and coalesce((a.metadata#>>'{homeCheck,labelReadability,retakeRequested}')::boolean, false) and not coalesce((a.metadata->>'landlordLabelVerified')::boolean, false)) then raise exception 'Correct the flagged label in Property Intelligence or retake it before confirming'; end if;
  perform public.confirm_home_check(c.id, c.landlord_id);
end $$;
