-- Retire Telnyx. Twilio is the only live SMS provider.
-- Historical sms_messages / sms_numbers rows may still say provider = 'telnyx'.

update public.sms_providers
set active = false
where name = 'telnyx';

update public.sms_providers
set
  active = true,
  config = coalesce(config, '{}'::jsonb) || jsonb_build_object('primary', true)
where name = 'twilio';

update public.sms_numbers
set status = 'released'
where provider = 'telnyx'
  and status in ('active', 'released_pending');
