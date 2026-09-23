-- Soft terminate / archive for maintenance work orders.
-- Never hard-delete tickets that had an assigned vendor; keep permanent audit trail.

-- Allow archived as a terminal vendor_work_status.
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
        'cancelled',
        'archived'
      )
    );

alter table public.maintenance_requests
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_by text,
  add column if not exists cancellation_reason text,
  add column if not exists previous_vendor_id uuid
    references public.vendors (id) on delete set null,
  add column if not exists previous_vendor_work_status text;

comment on column public.maintenance_requests.cancelled_at is
  'When the work order was cancelled or archived via terminateWorkOrder.';
comment on column public.maintenance_requests.cancelled_by is
  'Actor that terminated the WO (resident_sms, landlord, system, …).';
comment on column public.maintenance_requests.cancellation_reason is
  'Plain-language reason stored for audit + vendor notify.';
comment on column public.maintenance_requests.previous_vendor_id is
  'Vendor assigned at terminate time (kept after assigned_vendor_id is cleared).';
comment on column public.maintenance_requests.previous_vendor_work_status is
  'vendor_work_status immediately before terminate.';

-- One durable termination record per terminal cancel/archive (idempotent).
-- Release-on-reassign rows are separate (mode = release) and may repeat.
create table if not exists public.work_order_terminations (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  ticket_id uuid not null
    references public.maintenance_requests (id) on delete restrict,
  landlord_id uuid not null references public.landlords (id) on delete cascade,
  mode text not null check (mode in ('cancel', 'archive', 'release')),
  source text not null,
  actor_type text,
  actor_id text,
  reason text,
  previous_vendor_id uuid references public.vendors (id) on delete set null,
  previous_vendor_work_status text,
  conversation_id uuid references public.sms_conversations (id) on delete set null,
  sms_body text,
  email_subject text,
  notify_status text not null default 'pending'
    check (notify_status in (
      'pending',
      'notified',
      'failed',
      'skipped',
      'not_required'
    )),
  sms_attempt_count integer not null default 0,
  email_attempt_count integer not null default 0,
  last_sms_attempt_at timestamptz,
  last_email_attempt_at timestamptz,
  last_sms_error text,
  staff_alerted_at timestamptz,
  landlord_payment_warning_sent_at timestamptz,
  -- For cancel/archive: at most one terminal row per ticket.
  terminal_key text generated always as (
    case when mode in ('cancel', 'archive') then ticket_id::text else null end
  ) stored
);

create unique index if not exists work_order_terminations_terminal_uidx
  on public.work_order_terminations (terminal_key)
  where terminal_key is not null;

create index if not exists work_order_terminations_pending_notify_idx
  on public.work_order_terminations (notify_status, sms_attempt_count, created_at)
  where notify_status in ('pending', 'failed');

create index if not exists work_order_terminations_ticket_idx
  on public.work_order_terminations (ticket_id, created_at desc);

comment on table public.work_order_terminations is
  'Durable terminate/release record created before vendor notify delivery.';

create table if not exists public.work_order_terminate_notify_attempts (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  termination_id uuid not null
    references public.work_order_terminations (id) on delete cascade,
  ticket_id uuid not null
    references public.maintenance_requests (id) on delete restrict,
  landlord_id uuid not null references public.landlords (id) on delete cascade,
  channel text not null check (channel in ('sms', 'email')),
  phone text,
  email text,
  delivery_status text not null
    check (delivery_status in (
      'sent',
      'delivered',
      'failed',
      'skipped',
      'no_response'
    )),
  failure_reason text,
  provider_message_sid text,
  attempt_number integer not null default 1
    check (attempt_number >= 1 and attempt_number <= 20),
  conversation_id uuid
);

create index if not exists work_order_terminate_notify_attempts_term_idx
  on public.work_order_terminate_notify_attempts (termination_id, created_at desc);

comment on table public.work_order_terminate_notify_attempts is
  'Audit of each vendor terminate SMS/email delivery attempt.';

alter table public.work_order_terminations enable row level security;
alter table public.work_order_terminate_notify_attempts enable row level security;

drop policy if exists work_order_terminations_select_staff
  on public.work_order_terminations;
create policy work_order_terminations_select_staff
  on public.work_order_terminations
  for select to authenticated
  using (public.is_staff_admin());

drop policy if exists work_order_terminate_notify_attempts_select_staff
  on public.work_order_terminate_notify_attempts;
create policy work_order_terminate_notify_attempts_select_staff
  on public.work_order_terminate_notify_attempts
  for select to authenticated
  using (public.is_staff_admin());

grant select on public.work_order_terminations to authenticated;
grant select on public.work_order_terminate_notify_attempts to authenticated;
grant all on public.work_order_terminations to service_role;
grant all on public.work_order_terminate_notify_attempts to service_role;

-- Block hard deletes of maintenance_requests that are/were assigned to a vendor.
-- Application code must use terminateWorkOrder (cancel/archive) instead.
create or replace function public.prevent_hard_delete_assigned_work_orders()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if OLD.assigned_vendor_id is not null
     or OLD.previous_vendor_id is not null
  then
    raise exception
      'HARD_DELETE_FORBIDDEN: work order % cannot be hard-deleted while a vendor is/was assigned — use terminateWorkOrder (cancel/archive)',
      OLD.id
      using errcode = 'P0001';
  end if;
  return OLD;
end;
$$;

drop trigger if exists trg_prevent_hard_delete_assigned_work_orders
  on public.maintenance_requests;
create trigger trg_prevent_hard_delete_assigned_work_orders
  before delete on public.maintenance_requests
  for each row
  execute function public.prevent_hard_delete_assigned_work_orders();

comment on function public.prevent_hard_delete_assigned_work_orders() is
  'Blocks hard-delete of maintenance requests that have (or had) vendor involvement; terminateWorkOrder must soft-close them.';
