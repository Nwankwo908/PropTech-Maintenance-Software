-- Vendor Home Checks require acceptance and coordinated access before photo instructions.
alter table public.home_checks
  add column if not exists visit jsonb not null default '{}'::jsonb;

comment on column public.home_checks.visit is
  'Vendor acceptance and coordinated tenant or landlord access scheduling. Empty for legacy photo-first checks.';
