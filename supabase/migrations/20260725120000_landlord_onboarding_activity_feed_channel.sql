-- Allow landlords to choose Ulo Activity Feed as an alert channel during onboarding.
alter table public.landlord_onboarding
  drop constraint if exists landlord_onboarding_notification_channel_check;

alter table public.landlord_onboarding
  add constraint landlord_onboarding_notification_channel_check
  check (notification_channel in ('sms', 'email', 'activity_feed', 'both'));

comment on column public.landlord_onboarding.notification_channel is
  'Landlord alert channels: sms, email, activity_feed, or both (SMS + email + Activity Feed).';
