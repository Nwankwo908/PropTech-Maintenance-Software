-- Move the account's real Twilio number (+18775803356) from Ulo Operations
-- (DEFAULT_LANDLORD_ID 068daf53…) to the New Landlord onboarding account
-- (EMPTY_LANDLORD_ID de300000-…-0002) so onboarding SMS originates from a valid
-- Twilio caller ID for that account. A phone_number can belong to only one
-- landlord (sms_numbers.phone_number is unique), so this transfers ownership.

do $$
declare
  new_landlord constant uuid := 'de300000-0000-4000-8000-000000000002';
begin
  -- Retire the New Landlord's existing (placeholder / invalid) landlord_main line(s).
  update public.sms_numbers
  set status = 'released'
  where purpose = 'landlord_main'
    and landlord_id = new_landlord
    and phone_number <> '+18775803356';

  -- Transfer the real Twilio number to the New Landlord account as its active line.
  update public.sms_numbers
  set landlord_id = new_landlord,
      purpose = 'landlord_main',
      status = 'active'
  where phone_number = '+18775803356';

  raise notice 'Twilio number +18775803356 moved to New Landlord (%).', new_landlord;
end $$;
