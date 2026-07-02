-- Primary Telnyx SMS number — assigned as active landlord_main for Ulo Operations.
-- Default landlord: Ulo Operations (staff default tenant).

do $$
declare
  telnyx_number text := '+19734005760';
  ulo_operations uuid := '068daf53-07e4-4493-bd7f-6106e3c8c62f';
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
    ulo_operations,
    null,
    null
  )
  on conflict (phone_number) do update
  set
    provider = 'telnyx',
    status = 'active',
    purpose = 'landlord_main',
    landlord_id = ulo_operations;

  raise notice 'Telnyx number % assigned as landlord_main for Ulo Operations %', telnyx_number, ulo_operations;
end $$;
