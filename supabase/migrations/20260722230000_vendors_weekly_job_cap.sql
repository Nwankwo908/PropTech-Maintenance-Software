-- Optional weekly dispatch cap for vendor capacity SMS (JOBS MAX n).
-- Capacity pause stays on vendor_verifications.availability; account readiness stays on verification status.

alter table public.vendors
  add column if not exists weekly_job_cap integer;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'vendors_weekly_job_cap_check'
  ) then
    alter table public.vendors
      add constraint vendors_weekly_job_cap_check
      check (weekly_job_cap is null or weekly_job_cap >= 0);
  end if;
end $$;

comment on column public.vendors.weekly_job_cap is
  'Optional weekly job dispatch cap from SMS JOBS MAX n. Null = unlimited. Auto-pauses capacity when week assignments reach the cap.';
