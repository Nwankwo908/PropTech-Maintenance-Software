-- Human-readable labels can be corrected by the landlord. Pending model work
-- and unacknowledged ambiguous readings cannot be confirmed by a bare OK.
create function public.confirm_home_check_label_review(p_check_id uuid, p_landlord_id uuid, p_corrections jsonb default '[]')
returns void language plpgsql set search_path = public as $$
declare c public.home_checks; correction jsonb; asset public.unit_assets; field text; key text; value text; meta jsonb;
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
      if jsonb_typeof(correction->field) <> 'string' then raise exception 'Label corrections must be text'; end if;
      value := nullif(trim(correction->>field), '');
      if length(value) > 80 or value ~ '[?\[\]{}]' then raise exception 'Enter only label characters you can read'; end if;
      key := case when field = 'modelNumber' then 'model' else 'serial' end;
      meta := jsonb_set(meta, array['homeCheck','fields',key], coalesce(meta#>array['homeCheck','fields',key], '{}') || jsonb_build_object('value', value, 'source', 'landlord', 'confidence', case when value is null then 'low' else 'high' end, 'basis', 'Landlord checked the data plate and supplied this text.'));
      if field = 'modelNumber' then update public.unit_assets set model = value where id = asset.id;
      else meta := jsonb_set(meta, '{serialNumber}', coalesce(to_jsonb(value), 'null')); end if;
    end loop;
    update public.unit_assets set metadata = meta || jsonb_build_object('landlordLabelVerified', true) where id = asset.id;
    insert into public.home_check_events(check_id, event_type, role, metadata) values(c.id, 'landlord_label_corrected', c.role, jsonb_build_object('asset_id', asset.id, 'actor_role', 'landlord'));
  end loop;
  if exists(select 1 from public.unit_assets a where a.home_check_id = c.id and coalesce((a.metadata#>>'{homeCheck,labelReadability,retakeRequested}')::boolean, false) and not coalesce((a.metadata->>'landlordLabelVerified')::boolean, false)) then raise exception 'Correct the flagged label in Property Intelligence or retake it before confirming'; end if;
  perform public.confirm_home_check(c.id, c.landlord_id);
end $$;
revoke all on function public.confirm_home_check_label_review(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.confirm_home_check_label_review(uuid, uuid, jsonb) to service_role;
