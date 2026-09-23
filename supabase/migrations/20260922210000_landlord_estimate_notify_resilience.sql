-- Durable landlord estimate-notify state (independent of SMS delivery success).
-- Attempts audit every SMS/email delivery try for retries + reconciliation.

create table if not exists public.landlord_estimate_notifications (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  estimate_id uuid not null
    references public.maintenance_estimates (id) on delete cascade,
  landlord_id uuid not null references public.landlords (id) on delete cascade,
  ticket_id uuid not null
    references public.maintenance_requests (id) on delete cascade,
  conversation_id uuid
    references public.sms_conversations (id) on delete set null,
  sms_body text,
  notify_status text not null default 'awaiting_decision'
    check (notify_status in (
      'awaiting_decision',
      'decided',
      'superseded',
      'stalled'
    )),
  sms_attempt_count integer not null default 0,
  email_attempt_count integer not null default 0,
  last_sms_attempt_at timestamptz,
  last_email_attempt_at timestamptz,
  last_sms_error text,
  staff_alerted_at timestamptz,
  reconciled_at timestamptz,
  constraint landlord_estimate_notifications_estimate_uidx unique (estimate_id)
);

create index if not exists landlord_estimate_notifications_pending_idx
  on public.landlord_estimate_notifications (landlord_id, notify_status, created_at)
  where notify_status = 'awaiting_decision';

create index if not exists landlord_estimate_notifications_stalled_idx
  on public.landlord_estimate_notifications (created_at)
  where notify_status = 'awaiting_decision';

comment on table public.landlord_estimate_notifications is
  'One row per estimate ask to the landlord — created before SMS/email delivery so APPROVE works even when send fails.';

create table if not exists public.landlord_estimate_notify_attempts (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  notification_id uuid not null
    references public.landlord_estimate_notifications (id) on delete cascade,
  estimate_id uuid not null
    references public.maintenance_estimates (id) on delete cascade,
  landlord_id uuid not null references public.landlords (id) on delete cascade,
  channel text not null check (channel in ('sms', 'email', 'thread_repair')),
  phone text,
  delivery_status text not null
    check (delivery_status in (
      'sent',
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

create index if not exists landlord_estimate_notify_attempts_notification_idx
  on public.landlord_estimate_notify_attempts (notification_id, created_at desc);

create index if not exists landlord_estimate_notify_attempts_estimate_idx
  on public.landlord_estimate_notify_attempts (estimate_id, created_at desc);

comment on table public.landlord_estimate_notify_attempts is
  'Audit of each landlord estimate SMS/email delivery attempt (status, error, SID, retry number).';

alter table public.landlord_estimate_notifications enable row level security;
alter table public.landlord_estimate_notify_attempts enable row level security;

drop policy if exists landlord_estimate_notifications_select_staff
  on public.landlord_estimate_notifications;
create policy landlord_estimate_notifications_select_staff
  on public.landlord_estimate_notifications
  for select
  to authenticated
  using (public.is_staff_admin());

drop policy if exists landlord_estimate_notify_attempts_select_staff
  on public.landlord_estimate_notify_attempts;
create policy landlord_estimate_notify_attempts_select_staff
  on public.landlord_estimate_notify_attempts
  for select
  to authenticated
  using (public.is_staff_admin());

grant select on public.landlord_estimate_notifications to authenticated;
grant select on public.landlord_estimate_notify_attempts to authenticated;
grant all on public.landlord_estimate_notifications to service_role;
grant all on public.landlord_estimate_notify_attempts to service_role;
