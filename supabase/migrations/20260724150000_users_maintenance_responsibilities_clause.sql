-- Lease maintenance responsibilities language captured during resident onboarding.

alter table public.users
  add column if not exists maintenance_responsibilities_clause text;

comment on column public.users.maintenance_responsibilities_clause is
  'Lease maintenance responsibilities clause (who handles what) entered during onboarding or resident edit.';
