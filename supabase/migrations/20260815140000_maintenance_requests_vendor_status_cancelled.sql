-- Resident-cancelled work orders must leave the vendor lifecycle, not stay unassigned.

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
        'declined',
        'unassigned',
        'cancelled'
      )
    );

comment on column public.maintenance_requests.vendor_work_status is
  'Vendor lifecycle: pending_accept → accepted | declined → …; unassigned when no vendor is available; cancelled when the resident or team stops the request.';
