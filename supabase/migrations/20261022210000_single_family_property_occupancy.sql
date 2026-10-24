-- Single-family imports do not create Unit 1 or Home.
-- Residents, leases, and occupancy attach to the property.

alter table public.occupancy
  add column if not exists property_id uuid references public.properties (id) on delete cascade;

alter table public.occupancy
  alter column unit_id drop not null;

alter table public.occupancy
  drop constraint if exists occupancy_place_check;

alter table public.occupancy
  add constraint occupancy_place_check
  check (unit_id is not null or property_id is not null);

create index if not exists occupancy_property_id_idx
  on public.occupancy (property_id)
  where property_id is not null;

create unique index if not exists occupancy_active_property_resident_idx
  on public.occupancy (property_id, resident_id)
  where status = 'active' and unit_id is null and property_id is not null;

comment on column public.occupancy.property_id is
  'Property occupied when a single-family home has no unit row. unit_id stays set for multifamily.';

create or replace function public.onboarding_property_is_single_family(p_type text)
returns boolean
language sql
immutable
as $$
  select p_type is not null and (
    lower(trim(p_type)) in ('single_family_home', 'single_family', 'sfr', 'detached', 'house')
    or position('single' in lower(p_type)) > 0
  );
$$;

create or replace function public.reconcile_onboarding_inventory(
  p_landlord_id uuid,
  p_session_id text,
  p_properties jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session text := trim(coalesce(p_session_id, ''));
  v_current text;
  v_prop jsonb;
  v_name text;
  v_street text;
  v_city text;
  v_state text;
  v_zip text;
  v_ptype text;
  v_manager text;
  v_manager_phone text;
  v_unit_count int;
  v_unit_labels text;
  v_client_id text;
  v_addr_key text;
  v_match_id uuid;
  v_property_id uuid;
  v_desired_ids uuid[] := '{}';
  v_label text;
  v_labels text[];
  v_unit_id uuid;
  v_desired_unit_ids uuid[] := '{}';
  v_out_props jsonb := '[]'::jsonb;
  v_units_out jsonb := '[]'::jsonb;
  v_stale_prop uuid;
  v_stale_unit uuid;
  v_single_family boolean := false;
begin
  if v_session = '' then
    raise exception 'onboarding session id is required';
  end if;

  if not public.can_mutate_onboarding_inventory(p_landlord_id) then
    raise exception 'not authorized for onboarding inventory on landlord %', p_landlord_id;
  end if;

  select onboarding_session_id
  into v_current
  from public.landlord_onboarding
  where landlord_id = p_landlord_id
  for update;

  if v_current is null or trim(v_current) is distinct from v_session then
    raise exception
      using message = 'Stale onboarding session. Refresh and start setup again.',
           errcode = 'P0001';
  end if;

  if p_properties is null or jsonb_typeof(p_properties) <> 'array' or jsonb_array_length(p_properties) = 0 then
    raise exception 'Add at least one property.';
  end if;

  for v_prop in select * from jsonb_array_elements(p_properties)
  loop
    v_name := trim(coalesce(v_prop ->> 'name', ''));
    v_street := trim(coalesce(v_prop ->> 'streetAddress', v_prop ->> 'street_address', ''));
    v_city := trim(coalesce(v_prop ->> 'city', ''));
    v_state := trim(coalesce(v_prop ->> 'state', ''));
    v_zip := trim(coalesce(v_prop ->> 'zipCode', v_prop ->> 'zip_code', ''));
    v_ptype := nullif(trim(coalesce(v_prop ->> 'propertyType', v_prop ->> 'property_type', '')), '');
    v_manager := nullif(trim(coalesce(v_prop ->> 'propertyManagerName', v_prop ->> 'managerName', '')), '');
    v_manager_phone := nullif(trim(coalesce(v_prop ->> 'propertyManagerPhone', v_prop ->> 'managerPhone', '')), '');
    v_unit_count := greatest(coalesce((v_prop ->> 'unitCount')::int, (v_prop ->> 'unit_count')::int, 1), 1);
    v_unit_labels := trim(coalesce(v_prop ->> 'unitLabels', v_prop ->> 'unit_labels', ''));
    v_single_family := public.onboarding_property_is_single_family(v_ptype);
    if v_single_family then
      v_unit_count := 0;
    end if;
    v_client_id := trim(coalesce(v_prop ->> 'id', ''));
    v_addr_key := public.onboarding_address_match_key(v_street, v_city, v_state, v_zip);

    if v_name = '' then
      continue;
    end if;

    v_match_id := null;

    -- Prefer stable UUID from client when it already belongs to this landlord
    if v_client_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      select p.id into v_match_id
      from public.properties p
      where p.landlord_id = p_landlord_id
        and p.id = v_client_id::uuid;
    end if;

    -- Address identity (verified street present)
    if v_match_id is null and v_addr_key <> '' then
      select p.id into v_match_id
      from public.properties p
      where p.landlord_id = p_landlord_id
        and public.onboarding_address_match_key(
          p.street_address, p.city, p.state, p.zip_code
        ) = v_addr_key
      limit 1;
    end if;

    -- Name fallback when no address key
    if v_match_id is null and v_addr_key = '' then
      select p.id into v_match_id
      from public.properties p
      where p.landlord_id = p_landlord_id
        and lower(trim(p.name)) = lower(v_name)
      limit 1;
    end if;

    -- Ambiguous: name matches a different address — leave separate (insert new)
    if v_match_id is null then
      v_property_id := public.derive_property_id(p_landlord_id, v_name);
      insert into public.properties (
        id, landlord_id, name, street_address, city, state, zip_code,
        property_type, manager_name, manager_phone, unit_count, onboarding_session_id
      ) values (
        v_property_id, p_landlord_id, v_name,
        nullif(v_street, ''), nullif(v_city, ''), nullif(v_state, ''), nullif(v_zip, ''),
        v_ptype, v_manager, v_manager_phone, v_unit_count, v_session
      )
      on conflict (id) do update set
        name = excluded.name,
        street_address = coalesce(excluded.street_address, public.properties.street_address),
        city = coalesce(excluded.city, public.properties.city),
        state = coalesce(excluded.state, public.properties.state),
        zip_code = coalesce(excluded.zip_code, public.properties.zip_code),
        property_type = coalesce(excluded.property_type, public.properties.property_type),
        manager_name = coalesce(excluded.manager_name, public.properties.manager_name),
        manager_phone = coalesce(excluded.manager_phone, public.properties.manager_phone),
        unit_count = coalesce(excluded.unit_count, public.properties.unit_count),
        onboarding_session_id = v_session,
        updated_at = now();
    else
      v_property_id := v_match_id;
      update public.properties
      set
        name = v_name,
        street_address = case when v_street <> '' then v_street else street_address end,
        city = case when v_city <> '' then v_city else city end,
        state = case when v_state <> '' then v_state else state end,
        zip_code = case when v_zip <> '' then v_zip else zip_code end,
        property_type = coalesce(v_ptype, property_type),
        manager_name = coalesce(v_manager, manager_name),
        manager_phone = coalesce(v_manager_phone, manager_phone),
        unit_count = v_unit_count,
        onboarding_session_id = v_session,
        updated_at = now()
      where id = v_property_id
        and landlord_id = p_landlord_id;
    end if;

    v_desired_ids := array_append(v_desired_ids, v_property_id);

    if v_single_family then
      v_labels := array[]::text[];
      update public.occupancy o
      set property_id = v_property_id,
          unit_id = null
      where o.landlord_id = p_landlord_id
        and o.unit_id in (
          select u.id
          from public.units u
          where u.landlord_id = p_landlord_id
            and (
              u.property_id = v_property_id
              or lower(trim(coalesce(u.building, ''))) = lower(v_name)
            )
        );

      update public.users
      set unit = ''
      where landlord_id = p_landlord_id
        and lower(trim(coalesce(building, ''))) = lower(v_name);

      insert into public.occupancy (
        landlord_id, property_id, resident_id, move_in_date, status
      )
      select
        usr.landlord_id,
        v_property_id,
        usr.id,
        usr.move_in_date,
        'active'
      from public.users usr
      where usr.landlord_id = p_landlord_id
        and lower(trim(coalesce(usr.building, ''))) = lower(v_name)
        and usr.move_in_date is not null
        and usr.lease_end_date is not null
        and coalesce(usr.status, 'active') <> 'past_resident'
        and not exists (
          select 1
          from public.occupancy existing
          where existing.landlord_id = p_landlord_id
            and existing.resident_id = usr.id
            and existing.status = 'active'
            and (
              existing.property_id = v_property_id
              or existing.unit_id is null
            )
        );

      delete from public.units u
      where u.landlord_id = p_landlord_id
        and (
          u.property_id = v_property_id
          or lower(trim(coalesce(u.building, ''))) = lower(v_name)
        )
        and not exists (
          select 1 from public.maintenance_requests mr where mr.unit_id = u.id
        )
        and (
          to_regclass('public.home_checks') is null
          or not exists (select 1 from public.home_checks hc where hc.unit_id = u.id)
        )
        and (
          to_regclass('public.unit_assets') is null
          or not exists (select 1 from public.unit_assets ua where ua.unit_id = u.id)
        );
    elsif v_unit_labels = '' then
      v_labels := array['1'];
    else
      select coalesce(array_agg(trim(x)), array['1'])
      into v_labels
      from unnest(string_to_array(v_unit_labels, ',')) as x
      where trim(x) <> '';
      if v_labels is null or cardinality(v_labels) = 0 then
        v_labels := array['1'];
      end if;
    end if;

    foreach v_label in array v_labels
    loop
      select u.id into v_unit_id
      from public.units u
      where u.landlord_id = p_landlord_id
        and lower(trim(u.unit_label)) = lower(trim(v_label))
        and (
          u.property_id = v_property_id
          or lower(trim(coalesce(u.building, ''))) = lower(v_name)
        )
      limit 1;

      if v_unit_id is null then
        begin
          insert into public.units (
            landlord_id, unit_label, building, property_id, status,
            city, state, zip_code, onboarding_session_id
          ) values (
            p_landlord_id, trim(v_label), v_name, v_property_id, 'inactive',
            nullif(v_city, ''), nullif(v_state, ''), nullif(v_zip, ''), v_session
          )
          returning id into v_unit_id;
        exception
          when unique_violation then
            select u.id into v_unit_id
            from public.units u
            where u.landlord_id = p_landlord_id
              and lower(trim(u.unit_label)) = lower(trim(v_label))
              and lower(trim(coalesce(u.building, ''))) = lower(v_name)
            limit 1;
            update public.units
            set
              property_id = v_property_id,
              onboarding_session_id = v_session,
              city = case when v_city <> '' then v_city else city end,
              state = case when v_state <> '' then v_state else state end,
              zip_code = case when v_zip <> '' then v_zip else zip_code end,
              updated_at = now()
            where id = v_unit_id
              and landlord_id = p_landlord_id;
        end;
      else
        update public.units
        set
          building = v_name,
          property_id = v_property_id,
          city = case when v_city <> '' then v_city else city end,
          state = case when v_state <> '' then v_state else state end,
          zip_code = case when v_zip <> '' then v_zip else zip_code end,
          onboarding_session_id = v_session,
          updated_at = now()
        where id = v_unit_id
          and landlord_id = p_landlord_id;
      end if;

      v_desired_unit_ids := array_append(v_desired_unit_ids, v_unit_id);
      v_units_out := v_units_out || jsonb_build_array(jsonb_build_object(
        'id', v_unit_id,
        'propertyId', v_property_id,
        'unitLabel', trim(v_label),
        'building', v_name
      ));
    end loop;

    v_out_props := v_out_props || jsonb_build_array(jsonb_build_object(
      'id', v_property_id,
      'name', v_name,
      'streetAddress', nullif(v_street, ''),
      'city', nullif(v_city, ''),
      'state', nullif(v_state, ''),
      'zipCode', nullif(v_zip, ''),
      'propertyType', v_ptype,
      'unitCount', v_unit_count,
      'unitLabels', array_to_string(v_labels, ', ')
    ));
  end loop;

  if cardinality(v_desired_ids) = 0 then
    raise exception 'Add at least one property.';
  end if;

  -- Remove stale units (safe: no occupancy)
  for v_stale_unit in
    select u.id
    from public.units u
    where u.landlord_id = p_landlord_id
      and not (u.id = any (v_desired_unit_ids))
      and not exists (select 1 from public.occupancy o where o.unit_id = u.id)
  loop
    if public.onboarding_inventory_has_unsafe_ops(p_landlord_id) then
      raise exception
        using message = 'Cannot remove prior units while live operational records exist.',
             errcode = 'P0001';
    end if;
    delete from public.units where id = v_stale_unit and landlord_id = p_landlord_id;
  end loop;

  -- Remove stale properties (safe: no remaining units, no unsafe ops)
  for v_stale_prop in
    select p.id
    from public.properties p
    where p.landlord_id = p_landlord_id
      and not (p.id = any (v_desired_ids))
  loop
    if exists (select 1 from public.units u where u.property_id = v_stale_prop) then
      raise exception
        using message = 'Cannot remove a property that still has linked units with occupants.',
             errcode = 'P0001';
    end if;
    if public.onboarding_inventory_has_unsafe_ops(p_landlord_id) then
      raise exception
        using message = 'Cannot remove prior properties while live operational records exist.',
             errcode = 'P0001';
    end if;
    delete from public.properties where id = v_stale_prop and landlord_id = p_landlord_id;
  end loop;

  return jsonb_build_object(
    'properties', v_out_props,
    'units', v_units_out,
    'session_id', v_session
  );
end;
$$;


revoke all on function public.onboarding_property_is_single_family(text) from public;
grant execute on function public.onboarding_property_is_single_family(text) to authenticated, service_role;

revoke all on function public.reconcile_onboarding_inventory(uuid, text, jsonb) from public;
grant execute on function public.reconcile_onboarding_inventory(uuid, text, jsonb) to authenticated, service_role;
