-- Optional SMS for resident lifecycle notifications (email always when address present).
alter table public.maintenance_requests
  add column if not exists resident_phone text;

comment on column public.maintenance_requests.resident_phone is
  'Optional E.164 or local phone for SMS updates to the submitter.';

create table if not exists public.resident_notification_log (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  ticket_id uuid not null references public.maintenance_requests (id) on delete cascade,
  event_type text not null
    constraint resident_notification_log_event_check
      check (
        event_type in (
          'ticket_submitted',
          'vendor_assigned',
          'repair_in_progress',
          'repair_completed'
        )
      ),
  channel text not null
    constraint resident_notification_log_channel_check
      check (channel in ('email', 'sms')),
  provider_message_id text,
  error text
);

comment on table public.resident_notification_log is
  'Delivery attempts for resident maintenance updates (Resend / Twilio).';

create index if not exists resident_notification_log_ticket_id_idx
  on public.resident_notification_log (ticket_id);

create index if not exists resident_notification_log_ticket_event_idx
  on public.resident_notification_log (ticket_id, event_type);

alter table public.resident_notification_log enable row level security;
