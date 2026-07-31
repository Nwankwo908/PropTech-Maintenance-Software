-- Canonical properties table: stable property_id that survives renames.
-- Existing synthetic ids from derive_property_id(landlord_id, building) are reused
-- as primary keys so workflow_runs / graph events stay linked.

create extension if not exists "uuid-ossp";

-- ---------------------------------------------------------------------------
-- 1. Table
-- ---------------------------------------------------------------------------

create table if not exists public.properties (
  id uuid primary key,
  landlord_id uuid not null references public.landlords (id) on delete cascade,
  name text not null,
  street_address text,
  city text,
  state text,
  zip_code text,
  property_type text,
  manager_name text,
  manager_phone text,
  unit_count integer
    check (unit_count is null or unit_count >= 0),
  year_built integer
    check (year_built is null or (year_built >= 1800 and year_built <= 2100)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint properties_name_not_blank check (length(trim(name)) > 0)
);

-- Add columns if an older dashboard-created properties table already exists.
alter table public.properties add column if not exists landlord_id uuid;
alter table public.properties add column if not exists name text;
alter table public.properties add column if not exists street_address text;
alter table public.properties add column if not exists city text;
alter table public.properties add column if not exists state text;
alter table public.properties add column if not exists zip_code text;
alter table public.properties add column if not exists property_type text;
alter table public.properties add column if not exists manager_name text;
alter table public.properties add column if not exists manager_phone text;
alter table public.properties add column if not exists unit_count integer;
alter table public.properties add column if not exists year_built integer;
alter table public.properties add column if not exists created_at timestamptz not null default now();
alter table public.properties add column if not exists updated_at timestamptz not null default now();

comment on table public.properties is
  'Canonical property records. id is stable across renames; display name lives in name.';
comment on column public.properties.id is
  'Stable property UUID. New rows mint via derive_property_id(landlord_id, name) for continuity with historical graph/workflow rows.';
comment on column public.properties.name is
  'Display name (building). Renaming updates this field only — id does not change.';

create unique index if not exists properties_landlord_name_unique_idx
  on public.properties (landlord_id, lower(trim(name)));

create index if not exists properties_landlord_id_idx
  on public.properties (landlord_id);

-- ---------------------------------------------------------------------------
-- 2. units.property_id
-- ---------------------------------------------------------------------------

alter table public.units
  add column if not exists property_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'units_property_id_fkey'
  ) then
    alter table public.units
      add constraint units_property_id_fkey
      foreign key (property_id) references public.properties (id)
      on delete set null;
  end if;
end $$;

create index if not exists units_property_id_idx
  on public.units (property_id)
  where property_id is not null;

comment on column public.units.property_id is
  'FK to properties.id. building text remains for display/back-compat; property_id is the stable link.';

-- ---------------------------------------------------------------------------
-- 3. Backfill from distinct unit buildings
-- ---------------------------------------------------------------------------

-- Insert missing buildings only (skip when a row already matches landlord + name).
insert into public.properties (
  id,
  landlord_id,
  name,
  city,
  state,
  zip_code,
  unit_count
)
select
  public.derive_property_id(src.landlord_id, src.building_name) as id,
  src.landlord_id,
  src.building_name as name,
  src.city,
  src.state,
  src.zip_code,
  src.unit_count
from (
  select
    u.landlord_id,
    trim(u.building) as building_name,
    max(nullif(trim(u.city), '')) as city,
    max(nullif(trim(u.state), '')) as state,
    max(nullif(trim(u.zip_code), '')) as zip_code,
    count(*)::integer as unit_count
  from public.units u
  where u.landlord_id is not null
    and nullif(trim(u.building), '') is not null
    and exists (
      select 1 from public.landlords l where l.id = u.landlord_id
    )
  group by u.landlord_id, trim(u.building)
) src
where not exists (
  select 1
  from public.properties p
  where p.landlord_id = src.landlord_id
    and lower(trim(p.name)) = lower(src.building_name)
)
on conflict (id) do update
set
  name = excluded.name,
  city = coalesce(public.properties.city, excluded.city),
  state = coalesce(public.properties.state, excluded.state),
  zip_code = coalesce(public.properties.zip_code, excluded.zip_code),
  unit_count = coalesce(excluded.unit_count, public.properties.unit_count),
  updated_at = now();

-- Link units to the property row that matches building name (stable id or pre-existing).
update public.units u
set property_id = p.id
from public.properties p
where u.property_id is null
  and u.landlord_id = p.landlord_id
  and nullif(trim(u.building), '') is not null
  and lower(trim(u.building)) = lower(trim(p.name));

-- Satellite profile tables: fill property_id when building matches
update public.property_building_profiles pbp
set property_id = public.derive_property_id(pbp.landlord_id, pbp.building)
where pbp.property_id is null
  and nullif(trim(pbp.building), '') is not null
  and exists (
    select 1 from public.properties p
    where p.id = public.derive_property_id(pbp.landlord_id, pbp.building)
  );

do $$
begin
  if to_regclass('public.property_access_profiles') is not null then
    update public.property_access_profiles pap
    set property_id = public.derive_property_id(pap.landlord_id, pap.building)
    where pap.property_id is null
      and nullif(trim(pap.building), '') is not null
      and exists (
        select 1 from public.properties p
        where p.id = public.derive_property_id(pap.landlord_id, pap.building)
      );
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4. ensure_property — upsert by landlord + name, stable id
-- ---------------------------------------------------------------------------

create or replace function public.ensure_property(
  p_landlord_id uuid,
  p_name text,
  p_street_address text default null,
  p_city text default null,
  p_state text default null,
  p_zip_code text default null,
  p_property_type text default null,
  p_manager_name text default null,
  p_manager_phone text default null,
  p_unit_count integer default null,
  p_year_built integer default null
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_name text := nullif(trim(coalesce(p_name, '')), '');
  v_id uuid;
  v_existing_id uuid;
begin
  if p_landlord_id is null then
    raise exception 'ensure_property: landlord_id is required';
  end if;
  if v_name is null then
    raise exception 'ensure_property: name is required';
  end if;

  select id into v_existing_id
  from public.properties
  where landlord_id = p_landlord_id
    and lower(trim(name)) = lower(v_name)
  limit 1;

  if v_existing_id is not null then
    update public.properties
    set
      street_address = coalesce(nullif(trim(coalesce(p_street_address, '')), ''), street_address),
      city = coalesce(nullif(trim(coalesce(p_city, '')), ''), city),
      state = coalesce(nullif(trim(coalesce(p_state, '')), ''), state),
      zip_code = coalesce(nullif(trim(coalesce(p_zip_code, '')), ''), zip_code),
      property_type = coalesce(nullif(trim(coalesce(p_property_type, '')), ''), property_type),
      manager_name = coalesce(nullif(trim(coalesce(p_manager_name, '')), ''), manager_name),
      manager_phone = coalesce(nullif(trim(coalesce(p_manager_phone, '')), ''), manager_phone),
      unit_count = coalesce(p_unit_count, unit_count),
      year_built = coalesce(p_year_built, year_built),
      updated_at = now()
    where id = v_existing_id;
    return v_existing_id;
  end if;

  v_id := public.derive_property_id(p_landlord_id, v_name);

  insert into public.properties (
    id,
    landlord_id,
    name,
    street_address,
    city,
    state,
    zip_code,
    property_type,
    manager_name,
    manager_phone,
    unit_count,
    year_built
  )
  values (
    v_id,
    p_landlord_id,
    v_name,
    nullif(trim(coalesce(p_street_address, '')), ''),
    nullif(trim(coalesce(p_city, '')), ''),
    nullif(trim(coalesce(p_state, '')), ''),
    nullif(trim(coalesce(p_zip_code, '')), ''),
    nullif(trim(coalesce(p_property_type, '')), ''),
    nullif(trim(coalesce(p_manager_name, '')), ''),
    nullif(trim(coalesce(p_manager_phone, '')), ''),
    p_unit_count,
    p_year_built
  )
  on conflict (id) do update
  set
    name = excluded.name,
    street_address = coalesce(excluded.street_address, public.properties.street_address),
    city = coalesce(excluded.city, public.properties.city),
    state = coalesce(excluded.state, public.properties.state),
    zip_code = coalesce(excluded.zip_code, public.properties.zip_code),
    property_type = coalesce(excluded.property_type, public.properties.property_type),
    manager_name = coalesce(excluded.manager_name, public.properties.manager_name),
    manager_phone = coalesce(excluded.manager_phone, public.properties.manager_phone),
    unit_count = coalesce(excluded.unit_count, public.properties.unit_count),
    year_built = coalesce(excluded.year_built, public.properties.year_built),
    updated_at = now();

  return v_id;
end;
$$;

comment on function public.ensure_property is
  'Upsert a properties row by landlord + name. Mints id via derive_property_id so historical synthetic ids stay valid.';

grant execute on function public.ensure_property(
  uuid, text, text, text, text, text, text, text, text, integer, integer
) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. rename_property — change display name; keep id; sync denormalized building text
-- ---------------------------------------------------------------------------

create or replace function public.rename_property(
  p_property_id uuid,
  p_new_name text
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_new text := nullif(trim(coalesce(p_new_name, '')), '');
  v_old text;
  v_landlord uuid;
begin
  if p_property_id is null then
    raise exception 'rename_property: property_id is required';
  end if;
  if v_new is null then
    raise exception 'rename_property: new name is required';
  end if;

  select name, landlord_id into v_old, v_landlord
  from public.properties
  where id = p_property_id
  for update;

  if v_landlord is null then
    raise exception 'rename_property: property % not found', p_property_id;
  end if;

  if lower(trim(v_old)) = lower(v_new) and trim(v_old) = v_new then
    return p_property_id;
  end if;

  if exists (
    select 1
    from public.properties
    where landlord_id = v_landlord
      and lower(trim(name)) = lower(v_new)
      and id <> p_property_id
  ) then
    raise exception 'rename_property: another property already uses name %', v_new;
  end if;

  update public.properties
  set name = v_new, updated_at = now()
  where id = p_property_id;

  update public.units
  set building = v_new, updated_at = now()
  where property_id = p_property_id
     or (
       landlord_id = v_landlord
       and lower(trim(coalesce(building, ''))) = lower(trim(v_old))
     );

  update public.users
  set building = v_new
  where landlord_id = v_landlord
    and lower(trim(coalesce(building, ''))) = lower(trim(v_old));

  if to_regclass('public.property_building_profiles') is not null then
    update public.property_building_profiles
    set building = v_new, property_id = p_property_id, updated_at = now()
    where landlord_id = v_landlord
      and (
        property_id = p_property_id
        or lower(trim(building)) = lower(trim(v_old))
      );
  end if;

  if to_regclass('public.property_access_profiles') is not null then
    update public.property_access_profiles
    set building = v_new, property_id = p_property_id, updated_at = now()
    where landlord_id = v_landlord
      and (
        property_id = p_property_id
        or lower(trim(building)) = lower(trim(v_old))
      );
  end if;

  return p_property_id;
end;
$$;

comment on function public.rename_property is
  'Renames a property display name without changing properties.id. Syncs units.building and related denormalized building text.';

grant execute on function public.rename_property(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. RLS
-- ---------------------------------------------------------------------------

alter table public.properties enable row level security;

drop policy if exists properties_select_staff on public.properties;
drop policy if exists properties_insert_staff on public.properties;
drop policy if exists properties_update_staff on public.properties;
drop policy if exists properties_delete_staff on public.properties;

create policy properties_select_staff
  on public.properties for select to authenticated
  using (public.is_staff_admin());

create policy properties_insert_staff
  on public.properties for insert to authenticated
  with check (public.is_staff_admin());

create policy properties_update_staff
  on public.properties for update to authenticated
  using (public.is_staff_admin())
  with check (public.is_staff_admin());

create policy properties_delete_staff
  on public.properties for delete to authenticated
  using (public.is_staff_admin());

-- ---------------------------------------------------------------------------
-- 7. Update helper comment
-- ---------------------------------------------------------------------------

comment on function public.derive_property_id(uuid, text) is
  'Deterministic property UUID from landlord + building name. Used to mint properties.id so historical synthetic property_id values remain valid.';
