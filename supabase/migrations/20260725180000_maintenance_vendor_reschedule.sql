-- Vendor SMS reschedule: prior appointment, reason, resident confirmation.

alter table public.maintenance_requests
  add column if not exists previous_scheduled_at timestamptz,
  add column if not exists previous_scheduled_window_text text,
  add column if not exists reschedule_requested_by text,
  add column if not exists reschedule_reason text,
  add column if not exists reschedule_requested_at timestamptz,
  add column if not exists resident_confirmation_status text,
  add column if not exists resident_confirmed_at timestamptz,
  add column if not exists schedule_status text;

comment on column public.maintenance_requests.previous_scheduled_at is
  'Appointment time before the latest vendor reschedule.';
comment on column public.maintenance_requests.previous_scheduled_window_text is
  'Human window text before the latest vendor reschedule.';
comment on column public.maintenance_requests.reschedule_requested_by is
  'Actor who requested reschedule (vendor | landlord | system).';
comment on column public.maintenance_requests.reschedule_reason is
  'Plain-language reason from the vendor SMS when provided.';
comment on column public.maintenance_requests.reschedule_requested_at is
  'When the latest reschedule was requested.';
comment on column public.maintenance_requests.resident_confirmation_status is
  'pending | confirmed | declined | counter_proposed for vendor-driven reschedule.';
comment on column public.maintenance_requests.resident_confirmed_at is
  'When the resident confirmed the rescheduled appointment.';
comment on column public.maintenance_requests.schedule_status is
  'scheduled | vendor_reschedule_requested | vendor_rescheduled_pending_resident | scheduled_confirmed | resident_declined_reschedule | scheduling_needs_review';

alter table public.maintenance_requests
  drop constraint if exists maintenance_requests_resident_confirmation_status_check;

alter table public.maintenance_requests
  add constraint maintenance_requests_resident_confirmation_status_check
  check (
    resident_confirmation_status is null
    or resident_confirmation_status in (
      'pending',
      'confirmed',
      'declined',
      'counter_proposed'
    )
  );

alter table public.maintenance_requests
  drop constraint if exists maintenance_requests_schedule_status_check;

alter table public.maintenance_requests
  add constraint maintenance_requests_schedule_status_check
  check (
    schedule_status is null
    or schedule_status in (
      'scheduled',
      'vendor_reschedule_requested',
      'vendor_rescheduled_pending_resident',
      'scheduled_confirmed',
      'resident_declined_reschedule',
      'scheduling_needs_review'
    )
  );

-- Allow schedule_rescheduled on resident notification log.
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
      'schedule_rescheduled',
      'repair_in_progress',
      'repair_completed',
      'vendor_no_show'
    )
  );
