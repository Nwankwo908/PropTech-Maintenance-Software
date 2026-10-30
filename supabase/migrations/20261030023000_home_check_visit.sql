-- Dashboard Home Checks ask the vendor to accept and schedule before any photo text.
alter table public.home_checks
  add column if not exists visit jsonb not null default '{}'::jsonb;

comment on column public.home_checks.visit is
  'Acceptance and visit scheduling for a dashboard Home Check. Empty for photo-first checks.';
