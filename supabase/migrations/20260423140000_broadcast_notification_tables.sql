-- Admin broadcast sends: parent row + per-recipient / per-channel delivery log.

create table if not exists public.broadcast_notifications (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  subject text not null,
  message text not null,
  audience text not null
    constraint broadcast_notifications_audience_check
      check (audience in ('all', 'building', 'units')),
  building text,
  units jsonb not null default '[]'::jsonb,
  channels text[] not null,
  status text not null default 'processing'
    constraint broadcast_notifications_status_check
      check (status in ('processing', 'completed', 'partial', 'failed')),
  payload jsonb not null default '{}'::jsonb
);

comment on table public.broadcast_notifications is
  'Admin-initiated broadcast messages (audience, channels, automation snapshot).';

create table if not exists public.broadcast_notification_log (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  broadcast_id uuid not null references public.broadcast_notifications (id) on delete cascade,
  recipient_user_id uuid references public.users (id) on delete set null,
  recipient_email text,
  channel text not null
    constraint broadcast_notification_log_channel_check
      check (channel in ('email', 'sms')),
  success boolean not null,
  error text,
  provider_message_id text
);

comment on table public.broadcast_notification_log is
  'One row per delivery attempt (email or SMS) for a broadcast.';

create index if not exists broadcast_notification_log_broadcast_id_idx
  on public.broadcast_notification_log (broadcast_id);

create index if not exists broadcast_notifications_created_at_idx
  on public.broadcast_notifications (created_at desc);

alter table public.broadcast_notifications enable row level security;
alter table public.broadcast_notification_log enable row level security;

drop policy if exists broadcast_notifications_select_authenticated on public.broadcast_notifications;
create policy broadcast_notifications_select_authenticated
  on public.broadcast_notifications
  for select
  to authenticated
  using (true);

drop policy if exists broadcast_notification_log_select_authenticated on public.broadcast_notification_log;
create policy broadcast_notification_log_select_authenticated
  on public.broadcast_notification_log
  for select
  to authenticated
  using (true);
