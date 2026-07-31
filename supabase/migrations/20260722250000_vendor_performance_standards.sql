-- Vendor Performance Standards (§7):
-- ratings / no-shows / acceptance → coaching, warnings, profile & suspension reviews;
-- Class A/B misconduct → immediate roster suspension.

alter table public.vendors
  add column if not exists performance_notices jsonb not null default '{}'::jsonb;

alter table public.vendors
  add column if not exists performance_review text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'vendors_performance_review_check'
  ) then
    alter table public.vendors
      add constraint vendors_performance_review_check
      check (
        performance_review is null
        or performance_review in (
          'coaching',
          'profile_review',
          'suspension_review'
        )
      );
  end if;
end $$;

comment on column public.vendors.performance_notices is
  'Idempotency for performance actions: { rating_coaching, rating_suspension_review, noshow_warning, noshow_suspension_review, acceptance_profile_review }.';

comment on column public.vendors.performance_review is
  'Open performance review queue: coaching | profile_review | suspension_review. Cleared by ops.';

comment on column public.vendors.roster_status_reason is
  'Why roster_status was set (e.g. coi_expired, license_expired, compliance_expired, misconduct_class_a, misconduct_class_b, performance_low_rating, performance_noshow). Cleared on restore.';

-- Confirmed appointment lapsed without progress → counted as a vendor no-show.
create table if not exists public.vendor_job_no_shows (
  id uuid primary key default gen_random_uuid(),
  landlord_id uuid not null references public.landlords (id) on delete cascade,
  vendor_id uuid not null references public.vendors (id) on delete cascade,
  maintenance_request_id uuid not null references public.maintenance_requests (id) on delete cascade,
  scheduled_at timestamptz not null,
  recorded_at timestamptz not null default now(),
  source text not null default 'performance_cron',
  constraint vendor_job_no_shows_ticket_key unique (maintenance_request_id)
);

create index if not exists vendor_job_no_shows_vendor_recorded_idx
  on public.vendor_job_no_shows (vendor_id, recorded_at desc);

create index if not exists vendor_job_no_shows_landlord_recorded_idx
  on public.vendor_job_no_shows (landlord_id, recorded_at desc);

comment on table public.vendor_job_no_shows is
  'Vendor missed a confirmed appointment (schedule_confirmed + past scheduled_at, never started).';

alter table public.vendor_job_no_shows enable row level security;

drop policy if exists vendor_job_no_shows_select_staff on public.vendor_job_no_shows;
create policy vendor_job_no_shows_select_staff
  on public.vendor_job_no_shows
  for select
  to authenticated
  using (public.is_staff_admin());

-- Class A/B misconduct reports → immediate suspension.
create table if not exists public.vendor_misconduct_reports (
  id uuid primary key default gen_random_uuid(),
  landlord_id uuid not null references public.landlords (id) on delete cascade,
  vendor_id uuid not null references public.vendors (id) on delete cascade,
  class text not null,
  summary text not null,
  reported_by text,
  maintenance_request_id uuid references public.maintenance_requests (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint vendor_misconduct_reports_class_check
    check (class in ('A', 'B'))
);

create index if not exists vendor_misconduct_reports_vendor_idx
  on public.vendor_misconduct_reports (vendor_id, created_at desc);

comment on table public.vendor_misconduct_reports is
  'Class A (physical safety) / Class B (theft/fraud) misconduct — triggers immediate roster suspension.';

alter table public.vendor_misconduct_reports enable row level security;

drop policy if exists vendor_misconduct_reports_select_staff on public.vendor_misconduct_reports;
create policy vendor_misconduct_reports_select_staff
  on public.vendor_misconduct_reports
  for select
  to authenticated
  using (public.is_staff_admin());
