-- Platform holds for the vendor status state machine (Suspended / Banned).
-- Null means derive status from verification + availability (Pending → Active / Paused).

alter table public.vendors
  add column if not exists roster_status text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'vendors_roster_status_check'
  ) then
    alter table public.vendors
      add constraint vendors_roster_status_check
      check (roster_status is null or roster_status in ('suspended', 'banned'));
  end if;
end $$;

comment on column public.vendors.roster_status is
  'Platform hold override for vendor status state machine: suspended | banned. Null = derive from verification.';
