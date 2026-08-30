-- Limited Alpha 1 outbound/inbound SMS uses the Twilio DID.
-- Full Alpha keeps Telnyx (+19734005760). phone_number is unique, so this
-- transfers +18775803356 from whichever landlord currently owns it.

update public.sms_numbers
set status = 'released'
where landlord_id = 'de300000-0000-4000-8000-000000000003'::uuid
  and purpose = 'landlord_main'
  and phone_number <> '+18775803356';

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
  'de300000-0000-4000-8000-000000000003'::uuid,
  null,
  null
)
on conflict (phone_number) do update
set
  provider = 'twilio',
  status = 'active',
  purpose = 'landlord_main',
  landlord_id = 'de300000-0000-4000-8000-000000000003'::uuid,
  release_auto_reply = null;
