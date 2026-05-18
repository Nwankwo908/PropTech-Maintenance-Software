-- Optional vendor display name for resident notification log rows (admin / history UI).

alter table public.resident_notification_log
  add column if not exists vendor_name text;

comment on column public.resident_notification_log.vendor_name is
  'Vendor display name when the notification concerns an assigned vendor (e.g. vendor_assigned, repair_in_progress).';
