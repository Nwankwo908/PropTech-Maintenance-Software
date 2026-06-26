-- Primary Telnyx SMS number — assigned as active landlord_main (not pool-only).
-- Default landlord: Demo Property Management (demo@ulohome.io resident data).
-- Override: set local variable demo_landlord before running.

do $$
declare
  telnyx_number text := '+19734005760';
  demo_landlord uuid := 'de300000-0000-4000-8000-000000000001';
begin
  update public.sms_providers
  set active = false
  where name = 'twilio';

  insert into public.sms_providers (name, active, config)
  values (
    'telnyx',
    true,
    jsonb_build_object('from_number', telnyx_number, 'primary', true)
  )
  on conflict (name) do update
  set
    active = true,
    config = excluded.config;

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
    telnyx_number,
    'telnyx',
    'active',
    'landlord_main',
    demo_landlord,
    null,
    null
  )
  on conflict (phone_number) do update
  set
    provider = 'telnyx',
    status = 'active',
    purpose = 'landlord_main',
    landlord_id = demo_landlord;

  raise notice 'Telnyx number % assigned as landlord_main for %', telnyx_number, demo_landlord;
end $$;
