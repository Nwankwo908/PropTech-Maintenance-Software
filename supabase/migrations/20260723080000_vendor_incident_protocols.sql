-- Vendor Incident Protocols (pre-launch gates for marketplace matching):
-- 1) No-show: T+120 landlord+tenant notify, T+125 rematch
-- 2) Property damage: suspend pending review
-- 3) Bad actor: immediate suspend / permanent ban

alter table public.vendor_job_no_shows
  add column if not exists landlord_tenant_notified_at timestamptz,
  add column if not exists rematched_at timestamptz,
  add column if not exists rematch_vendor_id uuid references public.vendors (id) on delete set null;

comment on column public.vendor_job_no_shows.landlord_tenant_notified_at is
  'T+120: landlord + tenant notified of vendor no-show.';
comment on column public.vendor_job_no_shows.rematched_at is
  'T+125: automatic rematch to another ACTIVE vendor.';

create table if not exists public.vendor_property_damage_reports (
  id uuid primary key default gen_random_uuid(),
  landlord_id uuid not null references public.landlords (id) on delete cascade,
  vendor_id uuid not null references public.vendors (id) on delete cascade,
  maintenance_request_id uuid references public.maintenance_requests (id) on delete set null,
  summary text not null,
  reported_by text,
  created_at timestamptz not null default now()
);

create index if not exists vendor_property_damage_reports_vendor_idx
  on public.vendor_property_damage_reports (vendor_id, created_at desc);

comment on table public.vendor_property_damage_reports is
  'Property damage incidents — vendor suspended pending review. Ulo does not pay claims.';

alter table public.vendor_property_damage_reports enable row level security;

drop policy if exists vendor_property_damage_reports_select_staff
  on public.vendor_property_damage_reports;
create policy vendor_property_damage_reports_select_staff
  on public.vendor_property_damage_reports
  for select
  to authenticated
  using (public.is_staff_admin());

-- Allow resident no-show notification event.
alter table public.resident_notification_log
  drop constraint if exists resident_notification_log_event_check;

alter table public.resident_notification_log
  add constraint resident_notification_log_event_check
  check (
    event_type in (
      'ticket_submitted',
      'vendor_assigned',
      'vendor_accepted',
      'schedule_confirmed',
      'repair_in_progress',
      'repair_completed',
      'vendor_no_show'
    )
  );
