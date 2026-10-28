-- Property Details → Insurance, saved per property so every device and teammate
-- sees the same policy (and the same Property Health documentation score).
-- Previously this lived only in the browser's localStorage.
--
-- `profile` holds the policy fields (carrier, policy number, dates, coverage).
-- The scanned binder itself is not stored here: the check below rejects inline
-- file data so a multi-megabyte data URL can never land in this table.

create table if not exists public.property_insurance_profiles (
  id uuid primary key default gen_random_uuid(),
  landlord_id uuid not null references public.landlords (id) on delete cascade,
  property_id uuid references public.properties (id) on delete cascade,
  -- Same property name the Property Details panel is keyed by.
  building text not null check (length(btrim(building)) > 0),
  profile jsonb not null default '{}'::jsonb
    check (jsonb_typeof(profile) = 'object' and not (profile ? 'binderFileUrl')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (landlord_id, building)
);

create index if not exists property_insurance_profiles_landlord_idx
  on public.property_insurance_profiles (landlord_id);

comment on table public.property_insurance_profiles is
  'Landlord''s own insurance policy per property (Property Details → Insurance). Vendor COIs do not belong here.';

alter table public.property_insurance_profiles enable row level security;

drop policy if exists property_insurance_profiles_select on public.property_insurance_profiles;
drop policy if exists property_insurance_profiles_insert on public.property_insurance_profiles;
drop policy if exists property_insurance_profiles_update on public.property_insurance_profiles;
drop policy if exists property_insurance_profiles_delete on public.property_insurance_profiles;

create policy property_insurance_profiles_select
  on public.property_insurance_profiles for select to authenticated
  using (public.can_access_landlord(landlord_id));

create policy property_insurance_profiles_insert
  on public.property_insurance_profiles for insert to authenticated
  with check (public.can_access_landlord(landlord_id));

create policy property_insurance_profiles_update
  on public.property_insurance_profiles for update to authenticated
  using (public.can_access_landlord(landlord_id))
  with check (public.can_access_landlord(landlord_id));

create policy property_insurance_profiles_delete
  on public.property_insurance_profiles for delete to authenticated
  using (public.can_access_landlord(landlord_id));

grant select, insert, update, delete on public.property_insurance_profiles to authenticated;
