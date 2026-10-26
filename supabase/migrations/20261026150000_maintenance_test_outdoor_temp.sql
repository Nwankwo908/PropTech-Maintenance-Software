-- Test-only outdoor °F for disposable maintenance-verification landlords.
-- Intake reads a row only when landlords.id matches the d15a0000 prefix.
-- Every other account keeps National Weather Service lookup.

create table if not exists public.maintenance_test_outdoor_temp (
  landlord_id uuid primary key references public.landlords (id) on delete cascade,
  temp_f integer not null,
  created_at timestamptz not null default now(),
  constraint maintenance_test_outdoor_temp_range check (temp_f between -40 and 130)
);

comment on table public.maintenance_test_outdoor_temp is
  'Controlled outdoor °F for disposable maintenance verification landlords (id prefix d15a0000). No row means live National Weather Service.';

alter table public.maintenance_test_outdoor_temp enable row level security;

revoke all on table public.maintenance_test_outdoor_temp from anon, authenticated;
