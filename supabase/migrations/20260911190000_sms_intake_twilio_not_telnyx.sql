-- Do not keep the retired Telnyx DID as the resident SMS intake number.

update public.sms_numbers
set status = 'released'
where status in ('active', 'released_pending')
  and (
    provider = 'telnyx'
    or regexp_replace(coalesce(phone_number, ''), '\D', '', 'g') in ('19734005760', '9734005760')
  );

update public.landlord_onboarding
set
  ulo_phone_number = '+18775803356',
  updated_at = timezone('utc', now())
where regexp_replace(coalesce(ulo_phone_number, ''), '\D', '', 'g') in ('19734005760', '9734005760');
