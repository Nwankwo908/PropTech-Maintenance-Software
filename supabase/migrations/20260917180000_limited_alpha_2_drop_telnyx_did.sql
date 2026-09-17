-- Limited Alpha 2 must not own or send from the retired Telnyx DID (973) 400-5760.

update public.sms_numbers
set
  status = 'released',
  landlord_id = null
where landlord_id = 'de300000-0000-4000-8000-000000000004'::uuid
  and (
    lower(coalesce(provider, '')) = 'telnyx'
    or regexp_replace(coalesce(phone_number, ''), '\D', '', 'g') in ('19734005760', '9734005760')
  );

update public.sms_numbers
set status = 'released'
where status in ('active', 'released_pending')
  and regexp_replace(coalesce(phone_number, ''), '\D', '', 'g') in ('19734005760', '9734005760');

update public.landlord_onboarding
set
  ulo_phone_number = '+18775803356',
  updated_at = timezone('utc', now())
where landlord_id = 'de300000-0000-4000-8000-000000000004'::uuid
  and regexp_replace(coalesce(ulo_phone_number, ''), '\D', '', 'g') in ('19734005760', '9734005760');
