-- Alpha production SMS: Telnyx landlord_main active on Alpha; Twilio line stays on New Landlord pool.

update public.sms_providers
set active = false
where name = 'twilio';

insert into public.sms_providers (name, active, config)
values (
  'telnyx',
  true,
  '{"from_number": "+19734005760", "primary": true}'::jsonb
)
on conflict (name) do update
set
  active = true,
  config = excluded.config;

-- Release Twilio landlord_main on New Landlord (was incorrectly the live production line).
update public.sms_numbers
set status = 'released'
where phone_number = '+18775803356'
  and landlord_id = 'de300000-0000-4000-8000-000000000002'::uuid
  and purpose = 'landlord_main';

-- Activate Telnyx on Alpha (real production account).
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
  '+19734005760',
  'telnyx',
  'active',
  'landlord_main',
  '068daf53-07e4-4493-bd7f-6106e3c8c62f'::uuid,
  null,
  null
)
on conflict (phone_number) do update
set
  provider = 'telnyx',
  status = 'active',
  purpose = 'landlord_main',
  landlord_id = '068daf53-07e4-4493-bd7f-6106e3c8c62f'::uuid,
  release_auto_reply = null;
