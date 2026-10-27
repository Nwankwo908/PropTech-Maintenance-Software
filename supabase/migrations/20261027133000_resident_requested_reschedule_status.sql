-- A resident can ask to move a confirmed visit. That status was written by
-- tenant-initiated reschedule but rejected by the original check.

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
      'resident_requested_reschedule',
      'scheduling_needs_review'
    )
  );
