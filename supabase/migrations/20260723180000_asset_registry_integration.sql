-- Asset Registry ↔ unit_assets integration + building-level build year.
-- Manual registry writes and AI confirm both use unit_assets as the Asset node.

-- Allow manual_updated provenance on detection_source
alter table public.unit_assets
  drop constraint if exists unit_assets_detection_source_check;

alter table public.unit_assets
  add constraint unit_assets_detection_source_check
  check (detection_source in ('photo_ai', 'manual', 'inspection', 'manual_updated'));

comment on column public.unit_assets.detection_source is
  'How the asset record was created/last written: photo_ai, inspection, manual, or manual_updated (human edited after AI).';

-- Client-side Asset Registry upserts (authenticated dashboard)
create policy unit_assets_insert_authenticated
  on public.unit_assets
  for insert
  to authenticated
  with check (true);

create policy unit_assets_update_authenticated
  on public.unit_assets
  for update
  to authenticated
  using (true)
  with check (true);

-- PM tasks created alongside registry assets
create policy preventive_maintenance_tasks_insert_authenticated
  on public.preventive_maintenance_tasks
  for insert
  to authenticated
  with check (true);

create policy preventive_maintenance_tasks_update_authenticated
  on public.preventive_maintenance_tasks
  for update
  to authenticated
  using (true)
  with check (true);

-- Property-level build year (fallback age basis for assets without install date)
create table if not exists public.property_building_profiles (
  id uuid primary key default gen_random_uuid(),
  landlord_id uuid not null references public.landlords (id) on delete cascade,
  building text not null,
  property_id uuid,
  year_built integer
    check (year_built is null or (year_built >= 1800 and year_built <= 2100)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (landlord_id, building)
);

comment on table public.property_building_profiles is
  'Per-building profile fields (e.g. year built) used for asset age estimates and PM scoring.';

create index if not exists property_building_profiles_landlord_building_idx
  on public.property_building_profiles (landlord_id, building);

alter table public.property_building_profiles enable row level security;

create policy property_building_profiles_select_authenticated
  on public.property_building_profiles
  for select
  to authenticated
  using (true);

create policy property_building_profiles_insert_authenticated
  on public.property_building_profiles
  for insert
  to authenticated
  with check (true);

create policy property_building_profiles_update_authenticated
  on public.property_building_profiles
  for update
  to authenticated
  using (true)
  with check (true);
