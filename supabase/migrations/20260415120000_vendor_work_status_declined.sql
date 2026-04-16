-- Allow vendors to decline assigned jobs (email/SMS actions + portal).

alter table public.maintenance_requests
  drop constraint if exists maintenance_requests_vendor_work_status_check;

alter table public.maintenance_requests
  add constraint maintenance_requests_vendor_work_status_check
    check (
      vendor_work_status in (
        'pending_accept',
        'accepted',
        'in_progress',
        'completed',
        'declined'
      )
    );

comment on column public.maintenance_requests.vendor_work_status is
  'Vendor lifecycle: pending_accept → accepted | declined → in_progress → completed.';

alter table public.vendor_status_events
  drop constraint if exists vendor_status_events_source_check;

alter table public.vendor_status_events
  add constraint vendor_status_events_source_check
    check (
      source is null
      or source in ('portal', 'email_link', 'edge', 'email_signed')
    );
