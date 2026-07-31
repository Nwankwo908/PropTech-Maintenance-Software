-- Building-level property access for vendor job details (gate, lockbox, parking, etc.).

create table if not exists public.property_access_profiles (
  id uuid primary key default gen_random_uuid(),
  landlord_id uuid not null references public.landlords (id) on delete cascade,
  building text not null,
  property_id uuid,
  building_entry text not null default '',
  gate_code text not null default '',
  lockbox_location text not null default '',
  lockbox_code text not null default '',
  utility_room_access text not null default '',
  visitor_parking text not null default '',
  superintendent_contact text not null default '',
  emergency_access_notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (landlord_id, building)
);

comment on table public.property_access_profiles is
  'Per-building access details shown to vendors on the public work-order job page.';

create index if not exists property_access_profiles_landlord_building_idx
  on public.property_access_profiles (landlord_id, building);

alter table public.property_access_profiles enable row level security;

create policy property_access_profiles_select_authenticated
  on public.property_access_profiles
  for select
  to authenticated
  using (true);

create policy property_access_profiles_insert_authenticated
  on public.property_access_profiles
  for insert
  to authenticated
  with check (true);

create policy property_access_profiles_update_authenticated
  on public.property_access_profiles
  for update
  to authenticated
  using (true)
  with check (true);
