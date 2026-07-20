-- Environment data fix: the landlord_main outbound SMS line was pointing at a
-- non-Twilio number (+19734005760), so Twilio rejected outbound sends with
-- error 21659 ("'From' ... is not a Twilio phone number"). The account's real
-- Twilio number (+18775803356) already exists as a separate sms_numbers row, so
-- we reuse that row as the active landlord_main and retire the bad row.
-- Guarded by the known values so this is a no-op in environments without them.

do $$
declare
  v_landlord uuid;
  v_bad_id uuid;
  v_good_id uuid;
begin
  select id, landlord_id
    into v_bad_id, v_landlord
  from public.sms_numbers
  where purpose = 'landlord_main'
    and phone_number = '+19734005760'
  order by created_at desc
  limit 1;

  select id
    into v_good_id
  from public.sms_numbers
  where phone_number = '+18775803356'
  limit 1;

  if v_good_id is not null then
    -- Promote the existing +18775803356 row to the active landlord_main line.
    update public.sms_numbers
    set purpose = 'landlord_main',
        provider = 'twilio',
        status = 'active',
        landlord_id = coalesce(v_landlord, landlord_id)
    where id = v_good_id;

    -- Retire the misconfigured row so it is no longer resolved as the sender.
    if v_bad_id is not null and v_bad_id <> v_good_id then
      update public.sms_numbers
      set status = 'released'
      where id = v_bad_id;
    end if;

    raise notice 'landlord_main repointed to +18775803356 (row %, landlord %)',
      v_good_id, v_landlord;
  elsif v_bad_id is not null then
    -- Fallback: no existing +18775803356 row, so rename the bad row in place.
    update public.sms_numbers
    set phone_number = '+18775803356',
        provider = 'twilio',
        provider_number_sid = null
    where id = v_bad_id;

    raise notice 'renamed landlord_main row % to +18775803356', v_bad_id;
  else
    raise notice 'no matching landlord_main sms_numbers row found — no-op';
  end if;
end $$;
