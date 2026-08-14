-- Alpha production SMS: Twilio landlord_main on Alpha; Telnyx line released from Alpha.
-- Reverses 20260731240300_alpha_sms_primary.sql — Alpha uses the real Twilio number again.

update public.sms_providers
set active = false
where name = 'telnyx';

insert into public.sms_providers (name, active, config)
values (
  'twilio',
  true,
  '{"from_number": "+18775803356", "primary": true}'::jsonb
)
on conflict (name) do update
set
  active = true,
  config = excluded.config;

-- Release Telnyx landlord_main on Alpha.
update public.sms_numbers
set status = 'released'
where phone_number = '+19734005760'
  and landlord_id = '068daf53-07e4-4493-bd7f-6106e3c8c62f'::uuid
  and purpose = 'landlord_main';

-- Retire any other active landlord_main lines on Alpha before assigning Twilio.
update public.sms_numbers
set status = 'released'
where landlord_id = '068daf53-07e4-4493-bd7f-6106e3c8c62f'::uuid
  and purpose = 'landlord_main'
  and phone_number <> '+18775803356';

-- Activate Twilio on Alpha (transfers +18775803356 from New Landlord if present).
insert into public.sms_numbers (
  phone_number,
  provider,
  status,
  purpose,
  landlord_id,
  provider_number_sid,
  provider_messaging_service_sid
)
values (
  '+18775803356',
  'twilio',
  'active',
  'landlord_main',
  '068daf53-07e4-4493-bd7f-6106e3c8c62f'::uuid,
  null,
  null
)
on conflict (phone_number) do update
set
  provider = 'twilio',
  status = 'active',
  purpose = 'landlord_main',
  landlord_id = '068daf53-07e4-4493-bd7f-6106e3c8c62f'::uuid,
  release_auto_reply = null;
