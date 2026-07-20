-- Lease economics for residents (guided onboarding + resident profiles).
alter table public.users
  add column if not exists monthly_rent numeric,
  add column if not exists rent_due_day smallint;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'users_rent_due_day_check'
      and conrelid = 'public.users'::regclass
  ) then
    alter table public.users
      add constraint users_rent_due_day_check
      check (rent_due_day is null or (rent_due_day >= 1 and rent_due_day <= 31));
  end if;
end $$;

comment on column public.users.monthly_rent is
  'Contract monthly rent amount for the resident occupancy.';
comment on column public.users.rent_due_day is
  'Day of month rent is due (1–31).';
