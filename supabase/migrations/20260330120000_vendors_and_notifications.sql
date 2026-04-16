-- Vendors, ticket assignment, and vendor notify audit trail (service role / Edge Functions only).

create table if not exists public.vendors (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text not null,
  email text,
  phone text,
  notification_channel text not null default 'email'
    constraint vendors_notification_channel_check
      check (notification_channel in ('email', 'sms', 'both')),
  active boolean not null default true
);

comment on table public.vendors is 'Maintenance vendors notified on new tickets; managed via service role.';

alter table public.vendors enable row level security;

alter table public.maintenance_requests
  add column if not exists assigned_vendor_id uuid references public.vendors (id) on delete set null;

alter table public.maintenance_requests
  add column if not exists vendor_notified_at timestamptz;

alter table public.maintenance_requests
  add column if not exists vendor_notify_error text;

comment on column public.maintenance_requests.assigned_vendor_id is
  'Vendor auto-assigned when ticket is created (Edge Function).';

create table if not exists public.vendor_notification_log (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  ticket_id uuid not null references public.maintenance_requests (id) on delete cascade,
  vendor_id uuid not null references public.vendors (id) on delete cascade,
  channel text not null
    constraint vendor_notification_log_channel_check
      check (channel in ('email', 'sms')),
  provider_message_id text,
  error text
);

comment on table public.vendor_notification_log is
  'One row per delivery attempt (email/SMS) for vendor assignment notifications.';

create index if not exists vendor_notification_log_ticket_id_idx
  on public.vendor_notification_log (ticket_id);

alter table public.vendor_notification_log enable row level security;