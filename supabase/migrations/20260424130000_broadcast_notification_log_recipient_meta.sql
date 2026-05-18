-- Optional recipient metadata for broadcast_notification_log (e.g. summary rows from Edge Functions).
alter table public.broadcast_notification_log
  add column if not exists recipient_type text,
  add column if not exists recipient_id uuid;

comment on column public.broadcast_notification_log.recipient_type is
  'Optional: resident | vendor, etc. Per-recipient rows use recipient_user_id.';
comment on column public.broadcast_notification_log.recipient_id is
  'Optional future link to a non-user recipient entity.';
