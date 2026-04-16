-- Vendor workflow on tickets + portal API key per vendor + optional audit trail.

alter table public.vendors
  add column if not exists portal_api_key uuid unique;

alter table public.vendors
  alter column portal_api_key set default gen_random_uuid();

comment on column public.vendors.portal_api_key is
  'Bearer secret for vendor-list-tickets / vendor-update-job-status (rotate in DB).';

alter table public.maintenance_requests
  add column if not exists vendor_work_status text not null default 'pending_accept'
    constraint maintenance_requests_vendor_work_status_check
      check (
        vendor_work_status in (
          'pending_accept',
          'accepted',
          'in_progress',
          'completed'
        )
      );

alter table public.maintenance_requests
  add column if not exists vendor_action_token uuid;

comment on column public.maintenance_requests.vendor_work_status is
  'Vendor kanban lifecycle: pending_accept → accepted → in_progress → completed.';
comment on column public.maintenance_requests.vendor_action_token is
  'Per-ticket secret for portal deep links and token-based status updates.';

create table if not exists public.vendor_status_events (
  id uuid primary key default gen_random_uuid(),
  at timestamptz not null default now(),
  ticket_id uuid not null references public.maintenance_requests (id) on delete cascade,
  from_status text,
  to_status text not null,
  source text
    constraint vendor_status_events_source_check
      check (source is null or source in ('portal', 'email_link', 'edge'))
);

comment on table public.vendor_status_events is
  'Audit log for maintenance_requests.vendor_work_status changes.';

create index if not exists vendor_status_events_ticket_id_idx
  on public.vendor_status_events (ticket_id);

alter table public.vendor_status_events enable row level security;

-- Ensure existing vendors can call list/update APIs without manual SQL.
update public.vendors
set portal_api_key = gen_random_uuid()
where portal_api_key is null;
