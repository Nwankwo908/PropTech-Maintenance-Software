-- Auto-reassignment after vendor decline: audit vendor on events, ticket category, unassigned status.

alter table public.vendor_status_events
  add column if not exists vendor_id uuid references public.vendors (id) on delete set null;

comment on column public.vendor_status_events.vendor_id is
  'Vendor who performed or is associated with this transition (e.g. decliner).';

alter table public.vendor_status_events
  drop constraint if exists vendor_status_events_source_check;

alter table public.vendor_status_events
  add constraint vendor_status_events_source_check
    check (
      source is null
      or source in (
        'portal',
        'email_link',
        'edge',
        'email_signed',
        'auto_reassign'
      )
    );

alter table public.maintenance_requests
  add column if not exists issue_category text;

comment on column public.maintenance_requests.issue_category is
  'Optional trade/category for vendor matching (aligned with vendors.category); set when a vendor is assigned.';

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
        'unassigned'
      )
    );

comment on column public.maintenance_requests.vendor_work_status is
  'Vendor lifecycle: pending_accept → accepted | declined → …; unassigned when no vendor is available after declines.';

create index if not exists vendor_status_events_ticket_to_status_idx
  on public.vendor_status_events (ticket_id, to_status);
