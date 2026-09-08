-- Limited Alpha 2 outbound/inbound SMS uses the Telnyx DID.
-- Limited Alpha 1 keeps Twilio (+18775803356). phone_number is unique, so this
-- transfers +19734005760 from whichever landlord currently owns it (retired Full Alpha).

update public.sms_numbers
set status = 'released'
where landlord_id = 'de300000-0000-4000-8000-000000000004'::uuid
  and purpose = 'landlord_main'
  and phone_number <> '+19734005760';

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
  'de300000-0000-4000-8000-000000000004'::uuid,
  null,
  null
)
on conflict (phone_number) do update
set
  provider = 'telnyx',
  status = 'active',
  purpose = 'landlord_main',
  landlord_id = 'de300000-0000-4000-8000-000000000004'::uuid,
  release_auto_reply = null;
