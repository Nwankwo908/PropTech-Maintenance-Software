alter table public.maintenance_requests
  add column if not exists resident_notification_channel text not null default 'both'
    constraint maintenance_requests_resident_notification_channel_check
      check (resident_notification_channel in ('email', 'sms', 'both'));

comment on column public.maintenance_requests.resident_notification_channel is
  'How to reach the submitter for lifecycle updates: email, sms, or both.';
