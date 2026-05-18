-- Scheduled broadcasts: fire time + statuses (scheduled → processing → sent|partial|failed).

alter table public.broadcast_notifications
  add column if not exists scheduled_for timestamptz;

alter table public.broadcast_notifications
  add column if not exists claimed_at timestamptz;

comment on column public.broadcast_notifications.scheduled_for is
  'When status is scheduled, send at or after this time (UTC). Null for immediate sends.';

comment on column public.broadcast_notifications.claimed_at is
  'Set when a worker moves the row from scheduled to processing (avoids duplicate cron claims).';

alter table public.broadcast_notifications
  drop constraint if exists broadcast_notifications_status_check;

alter table public.broadcast_notifications
  add constraint broadcast_notifications_status_check
  check (
    status in (
      'processing',
      'completed',
      'partial',
      'failed',
      'scheduled',
      'sent'
    )
  );

create index if not exists broadcast_notifications_scheduled_due_idx
  on public.broadcast_notifications (scheduled_for asc)
  where status = 'scheduled';
