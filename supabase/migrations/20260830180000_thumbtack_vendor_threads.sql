-- Thumbtack demand-side outreach threads (Find External Vendor → Message Vendor).
-- Writes go through Edge Functions (service role). Staff dashboards may read.

create table if not exists public.thumbtack_vendor_threads (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  ticket_id uuid not null references public.maintenance_requests (id) on delete cascade,
  landlord_id uuid not null,
  business_id text not null,
  vendor_name text not null,
  search_id text,
  category_id text,
  request_id text,
  negotiation_id text,
  status text not null default 'awaiting_response'
    constraint thumbtack_vendor_threads_status_check
    check (status in ('awaiting_response', 'vendor_replied', 'closed')),
  last_outbound_text text,
  last_outbound_at timestamptz,
  last_inbound_text text,
  last_inbound_at timestamptz,
  unique (ticket_id, business_id)
);

comment on table public.thumbtack_vendor_threads is
  'Thumbtack negotiation threads from Find External Vendor messaging; managed via Edge Functions.';

create index if not exists thumbtack_vendor_threads_ticket_id_idx
  on public.thumbtack_vendor_threads (ticket_id);
create index if not exists thumbtack_vendor_threads_negotiation_id_idx
  on public.thumbtack_vendor_threads (negotiation_id)
  where negotiation_id is not null;
create index if not exists thumbtack_vendor_threads_landlord_id_idx
  on public.thumbtack_vendor_threads (landlord_id);

create table if not exists public.thumbtack_vendor_messages (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  thread_id uuid not null references public.thumbtack_vendor_threads (id) on delete cascade,
  direction text not null
    constraint thumbtack_vendor_messages_direction_check
    check (direction in ('outbound', 'inbound')),
  body text not null,
  thumbtack_message_id text
);

comment on table public.thumbtack_vendor_messages is
  'Outbound landlord and inbound pro messages on a Thumbtack negotiation.';

create unique index if not exists thumbtack_vendor_messages_provider_id_uidx
  on public.thumbtack_vendor_messages (thumbtack_message_id)
  where thumbtack_message_id is not null;
create index if not exists thumbtack_vendor_messages_thread_id_idx
  on public.thumbtack_vendor_messages (thread_id, created_at);

alter table public.thumbtack_vendor_threads enable row level security;
alter table public.thumbtack_vendor_messages enable row level security;

drop policy if exists thumbtack_vendor_threads_select_staff on public.thumbtack_vendor_threads;
create policy thumbtack_vendor_threads_select_staff
  on public.thumbtack_vendor_threads
  for select
  to authenticated
  using (public.is_staff_admin());

drop policy if exists thumbtack_vendor_messages_select_staff on public.thumbtack_vendor_messages;
create policy thumbtack_vendor_messages_select_staff
  on public.thumbtack_vendor_messages
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.thumbtack_vendor_threads t
      where t.id = thumbtack_vendor_messages.thread_id
        and public.is_staff_admin()
    )
  );
