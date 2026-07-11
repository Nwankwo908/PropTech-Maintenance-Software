-- Fix Marco Alvarez late-rent Communication inbox thread.
-- Converts the demo ai_copilot late-rent row into a resident SMS thread and
-- points orphaned payment-plan messages (if any) at that conversation.
--
-- Safe to re-run. Demo landlord: de300000-0000-4000-8000-000000000001

do $$
declare
  demo_landlord uuid := 'de300000-0000-4000-8000-000000000001';
  r_alvarez uuid := md5('ulo-demo-res-marco-alvarez')::uuid;
  c_marco uuid := md5('ulo-demo-conv-ai-maple-rent')::uuid;
  marco_phone text := '+15555620005';
  orphan_id uuid;
begin
  -- Prefer the seeded Maple late-rent conversation id when present.
  update public.sms_conversations
  set
    conversation_type = 'resident_intake',
    status = 'open',
    external_phone_number = marco_phone,
    resident_id = r_alvarez,
    updated_at = greatest(updated_at, now())
  where landlord_id = demo_landlord
    and id = c_marco;

  -- Also convert any other Marco ai_copilot / landlord_update threads.
  update public.sms_conversations
  set
    conversation_type = 'resident_intake',
    status = 'open',
    external_phone_number = marco_phone,
    resident_id = r_alvarez,
    updated_at = greatest(updated_at, now())
  where landlord_id = demo_landlord
    and resident_id = r_alvarez
    and conversation_type in ('ai_copilot', 'landlord_update');

  -- Merge newer orphan resident threads (payment-plan-only) into the main Marco thread.
  for orphan_id in
    select c.id
    from public.sms_conversations c
    where c.landlord_id = demo_landlord
      and c.resident_id = r_alvarez
      and c.id <> c_marco
      and c.vendor_id is null
      and c.conversation_type = 'resident_intake'
      and exists (
        select 1
        from public.sms_messages m
        where m.conversation_id = c.id
          and m.body ~* 'payment plan|installment'
      )
  loop
    update public.sms_messages
    set conversation_id = c_marco
    where conversation_id = orphan_id;

    delete from public.sms_conversations
    where id = orphan_id;

    update public.sms_conversations
    set updated_at = now(), status = 'open'
    where id = c_marco;
  end loop;
end $$;
