-- Onboarding inventory consistency for Limited Alpha fresh Start + reconcile.
-- Does NOT call purge_landlord_portfolio / factory reset (preserves vendors + account settings).

-- ---------------------------------------------------------------------------
-- 1. Session lineage on properties / units
-- ---------------------------------------------------------------------------

alter table public.properties
  add column if not exists onboarding_session_id text;

alter table public.units
  add column if not exists onboarding_session_id text;

comment on column public.properties.onboarding_session_id is
  'Setup run that created/last reconciled this property during Limited Alpha onboarding.';
comment on column public.units.onboarding_session_id is
  'Setup run that created/last reconciled this unit during Limited Alpha onboarding.';

create index if not exists properties_landlord_onboarding_session_idx
  on public.properties (landlord_id, onboarding_session_id);

create index if not exists units_landlord_onboarding_session_idx
  on public.units (landlord_id, onboarding_session_id);

-- ---------------------------------------------------------------------------
-- 2. Import idempotency keys
-- ---------------------------------------------------------------------------

create table if not exists public.onboarding_import_keys (
  landlord_id uuid not null references public.landlords (id) on delete cascade,
  onboarding_session_id text not null,
  document_key text not null,
  record_kind text not null,
  record_key text not null,
  entity_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (landlord_id, onboarding_session_id, document_key, record_kind, record_key),
  constraint onboarding_import_keys_kind_check
    check (record_kind in ('property', 'unit', 'resident', 'lease'))
);

create index if not exists onboarding_import_keys_landlord_session_idx
  on public.onboarding_import_keys (landlord_id, onboarding_session_id);

alter table public.onboarding_import_keys enable row level security;

drop policy if exists onboarding_import_keys_staff_all on public.onboarding_import_keys;
create policy onboarding_import_keys_staff_all
  on public.onboarding_import_keys
  for all
  to authenticated
  using (public.is_staff_admin())
  with check (public.is_staff_admin());

grant select, insert, update, delete on public.onboarding_import_keys to authenticated;
grant all on public.onboarding_import_keys to service_role;

-- ---------------------------------------------------------------------------
-- 3. Address normalization helpers
-- ---------------------------------------------------------------------------

create or replace function public.normalize_onboarding_street(p_street text)
returns text
language plpgsql
immutable
as $$
declare
  s text;
begin
  s := lower(trim(coalesce(p_street, '')));
  if s = '' then
    return '';
  end if;
  s := regexp_replace(s, '[[:punct:]]+', ' ', 'g');
  s := regexp_replace(s, '\s+', ' ', 'g');
  s := regexp_replace(s, '\y(street|st)\y', 'st', 'g');
  s := regexp_replace(s, '\y(avenue|ave)\y', 'ave', 'g');
  s := regexp_replace(s, '\y(boulevard|blvd)\y', 'blvd', 'g');
  s := regexp_replace(s, '\y(drive|dr)\y', 'dr', 'g');
  s := regexp_replace(s, '\y(road|rd)\y', 'rd', 'g');
  s := regexp_replace(s, '\y(lane|ln)\y', 'ln', 'g');
  s := regexp_replace(s, '\y(court|ct)\y', 'ct', 'g');
  s := regexp_replace(s, '\y(place|pl)\y', 'pl', 'g');
  s := regexp_replace(s, '\y(circle|cir)\y', 'cir', 'g');
  s := regexp_replace(s, '\y(highway|hwy)\y', 'hwy', 'g');
  s := regexp_replace(s, '\y(apartment|apt)\y', 'apt', 'g');
  s := regexp_replace(s, '\y(suite|ste)\y', 'ste', 'g');
  s := regexp_replace(s, '\y(north|n)\y', 'n', 'g');
  s := regexp_replace(s, '\y(south|s)\y', 's', 'g');
  s := regexp_replace(s, '\y(east|e)\y', 'e', 'g');
  s := regexp_replace(s, '\y(west|w)\y', 'w', 'g');
  return trim(regexp_replace(s, '\s+', ' ', 'g'));
end;
$$;

create or replace function public.normalize_onboarding_zip(p_zip text)
returns text
language sql
immutable
as $$
  select nullif(substring(regexp_replace(coalesce(p_zip, ''), '\D', '', 'g') from 1 for 5), '');
$$;

create or replace function public.normalize_onboarding_state(p_state text)
returns text
language sql
immutable
as $$
  select nullif(upper(trim(coalesce(p_state, ''))), '');
$$;

create or replace function public.normalize_onboarding_city(p_city text)
returns text
language sql
immutable
as $$
  select nullif(lower(trim(regexp_replace(coalesce(p_city, ''), '\s+', ' ', 'g'))), '');
$$;

create or replace function public.onboarding_address_match_key(
  p_street text,
  p_city text,
  p_state text,
  p_zip text
)
returns text
language sql
immutable
as $$
  select case
    when public.normalize_onboarding_street(p_street) = '' then ''
    else concat_ws(
      '|',
      public.normalize_onboarding_street(p_street),
      coalesce(public.normalize_onboarding_city(p_city), ''),
      coalesce(public.normalize_onboarding_state(p_state), ''),
      coalesce(public.normalize_onboarding_zip(p_zip), '')
    )
  end;
$$;

revoke all on function public.normalize_onboarding_street(text) from public;
revoke all on function public.normalize_onboarding_zip(text) from public;
revoke all on function public.normalize_onboarding_state(text) from public;
revoke all on function public.normalize_onboarding_city(text) from public;
revoke all on function public.onboarding_address_match_key(text, text, text, text) from public;
grant execute on function public.normalize_onboarding_street(text) to authenticated, service_role;
grant execute on function public.normalize_onboarding_zip(text) to authenticated, service_role;
grant execute on function public.normalize_onboarding_state(text) to authenticated, service_role;
grant execute on function public.normalize_onboarding_city(text) to authenticated, service_role;
grant execute on function public.onboarding_address_match_key(text, text, text, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Auth helper — Limited Alpha only
-- ---------------------------------------------------------------------------

create or replace function public.can_mutate_onboarding_inventory(p_landlord_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  allowed constant uuid[] := array[
    'de300000-0000-4000-8000-000000000003'::uuid,
    'de300000-0000-4000-8000-000000000004'::uuid
  ];
  jwt_role text := coalesce(auth.jwt() ->> 'role', '');
  jwt_email text := lower(trim(coalesce(auth.jwt() ->> 'email', '')));
  member_landlord uuid;
begin
  if not (p_landlord_id = any (allowed)) then
    return false;
  end if;
  if jwt_role = 'service_role' then
    return true;
  end if;
  if not public.is_staff_admin() then
    return false;
  end if;
  -- Core staff may touch either Alpha account; portal members only their landlord.
  if jwt_email in (
    'emeka@ulohome.io',
    'osi@ulohome.io',
    'limitedalpha1@ulohome.io',
    'limitedalpha2@ulohome.io'
  ) or jwt_email like '%@property-admin.auth.local' then
    return true;
  end if;
  select m.landlord_id
  into member_landlord
  from public.landlord_portal_members m
  where lower(m.email) = jwt_email
  limit 1;
  if member_landlord is not null then
    return member_landlord = p_landlord_id;
  end if;
  -- Seeded login emails mapped 1:1
  if jwt_email = 'limitedalpha1@ulohome.io' then
    return p_landlord_id = 'de300000-0000-4000-8000-000000000003'::uuid;
  end if;
  if jwt_email = 'limitedalpha2@ulohome.io' then
    return p_landlord_id = 'de300000-0000-4000-8000-000000000004'::uuid;
  end if;
  return public.is_staff_admin();
end;
$$;

revoke all on function public.can_mutate_onboarding_inventory(uuid) from public;
grant execute on function public.can_mutate_onboarding_inventory(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. Unsafe operational refs (block fresh replacement)
-- ---------------------------------------------------------------------------

create or replace function public.onboarding_inventory_has_unsafe_ops(p_landlord_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  -- Live maintenance not from Fast Track import lineage
  if exists (
    select 1
    from public.maintenance_requests mr
    where mr.landlord_id = p_landlord_id
      and coalesce(mr.metadata ->> 'source', '') is distinct from 'onboarding_import'
  ) then
    return true;
  end if;

  if to_regclass('public.unit_assets') is not null
     and exists (
       select 1 from public.unit_assets ua where ua.landlord_id = p_landlord_id
     ) then
    return true;
  end if;

  if to_regclass('public.home_checks') is not null
     and exists (
       select 1 from public.home_checks hc where hc.landlord_id = p_landlord_id
     ) then
    return true;
  end if;

  if to_regclass('public.inspections') is not null
     and exists (
       select 1 from public.inspections i where i.landlord_id = p_landlord_id
     ) then
    return true;
  end if;

  if to_regclass('public.rent_payments') is not null
     and exists (
       select 1 from public.rent_payments rp where rp.landlord_id = p_landlord_id
     ) then
    return true;
  end if;

  if to_regclass('public.rent_ledger_entries') is not null
     and exists (
       select 1 from public.rent_ledger_entries rle where rle.landlord_id = p_landlord_id
     ) then
    return true;
  end if;

  return false;
end;
$$;

revoke all on function public.onboarding_inventory_has_unsafe_ops(uuid) from public;
grant execute on function public.onboarding_inventory_has_unsafe_ops(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. start_fresh_onboarding_run
-- ---------------------------------------------------------------------------

create or replace function public.start_fresh_onboarding_run(
  p_landlord_id uuid,
  p_session_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session text := trim(coalesce(p_session_id, ''));
  v_started timestamptz := now();
  v_draft jsonb;
begin
  if v_session = '' then
    raise exception 'onboarding session id is required';
  end if;

  if not public.can_mutate_onboarding_inventory(p_landlord_id) then
    raise exception 'not authorized for onboarding inventory on landlord %', p_landlord_id;
  end if;

  if public.onboarding_inventory_has_unsafe_ops(p_landlord_id) then
    raise exception
      using message = 'This account has live work orders, payments, inspections, or equipment records. Factory reset is required before starting a fresh setup, or finish setup without wiping the portfolio.',
           errcode = 'P0001';
  end if;

  -- Lock onboarding row (create shell if missing)
  insert into public.landlord_onboarding (landlord_id, onboarding_status, current_step)
  values (p_landlord_id, 'in_progress', 'entry')
  on conflict (landlord_id) do nothing;

  perform 1
  from public.landlord_onboarding
  where landlord_id = p_landlord_id
  for update;

  -- Clear occupancy then residents then units then properties (vendors untouched)
  delete from public.occupancy where landlord_id = p_landlord_id;
  delete from public.users where landlord_id = p_landlord_id;
  delete from public.units where landlord_id = p_landlord_id;
  delete from public.properties where landlord_id = p_landlord_id;
  delete from public.onboarding_import_keys where landlord_id = p_landlord_id;

  select draft_state into v_draft
  from public.landlord_onboarding
  where landlord_id = p_landlord_id;

  v_draft := coalesce(v_draft, '{}'::jsonb)
    - 'extractionReview'
    - 'uploadDocuments'
    - 'propertyForms'
    - 'residentForms';

  update public.landlord_onboarding
  set
    onboarding_status = 'in_progress',
    completed_at = null,
    onboarding_session_id = v_session,
    onboarding_session_started_at = v_started,
    properties = '[]'::jsonb,
    draft_state = v_draft,
    updated_at = v_started
  where landlord_id = p_landlord_id;

  return jsonb_build_object(
    'session_id', v_session,
    'started_at', v_started,
    'landlord_id', p_landlord_id
  );
end;
$$;

revoke all on function public.start_fresh_onboarding_run(uuid, text) from public;
grant execute on function public.start_fresh_onboarding_run(uuid, text) to authenticated, service_role;

comment on function public.start_fresh_onboarding_run(uuid, text) is
  'Limited Alpha fresh Start: transactional clear of properties/units/occupancy/residents + mint session. Blocks when live ops refs exist. Preserves vendors and account settings.';

-- ---------------------------------------------------------------------------
-- 7. reconcile_onboarding_inventory
-- ---------------------------------------------------------------------------

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

    if v_unit_labels = '' then
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

revoke all on function public.reconcile_onboarding_inventory(uuid, text, jsonb) from public;
grant execute on function public.reconcile_onboarding_inventory(uuid, text, jsonb) to authenticated, service_role;

comment on function public.reconcile_onboarding_inventory(uuid, text, jsonb) is
  'Transactional reconcile of Limited Alpha onboarding properties/units for the current session. Rejects stale sessions; rolls back on unsafe deletes.';
