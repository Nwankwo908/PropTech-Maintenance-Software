-- Job schedule fields for vendor SMS availability → confirmed appointment (Phase 1 / 4.1).

alter table public.maintenance_requests
  add column if not exists scheduled_at timestamptz,
  add column if not exists scheduled_window_text text,
  add column if not exists schedule_confirmed_at timestamptz;

comment on column public.maintenance_requests.scheduled_at is
  'Best-effort parsed appointment instant from vendor availability SMS (nullable).';
comment on column public.maintenance_requests.scheduled_window_text is
  'Vendor availability phrase (source of truth for confirm copy), e.g. Tomorrow 10am.';
comment on column public.maintenance_requests.schedule_confirmed_at is
  'When Ulo confirmed the appointment and notified tenant + landlord.';

create index if not exists maintenance_requests_scheduled_at_idx
  on public.maintenance_requests (scheduled_at)
  where scheduled_at is not null;

-- Allow schedule_confirmed (+ vendor_accepted if missing) on resident notification log.
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
      'repair_completed'
    )
  );
