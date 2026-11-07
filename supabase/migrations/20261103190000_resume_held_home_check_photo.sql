-- Explicit sender-requested resume; preserve the held original and other intake state.
create function public.resume_home_check_sms_photo(p_landlord_id uuid,p_conversation_id uuid,p_from text,p_to text)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare v public.sms_conversations;c public.home_checks;p jsonb;
begin
 select * into v from public.sms_conversations where id=p_conversation_id and landlord_id=p_landlord_id for update;
 if not found or v.external_phone_number is distinct from p_from then return null;end if;
 p:=v.intake_state->'home_check_photo_pending';
 if p is null or p->>'step' is distinct from 'kind' or p->>'path' is null then return null;end if;
 select * into c from public.home_checks where id::text=p->>'checkId' and landlord_id=p_landlord_id for update;
 if not found or c.recipient_phone is distinct from p_from or c.ulo_number is distinct from p_to
  or c.confirmed_at is not null or c.status<>'collecting' or c.expires_at<=now()
  or not exists(select 1 from public.sms_numbers n where n.id=v.sms_number_id and n.phone_number=p_to)
  or not exists(select 1 from public.home_check_sms_capture_sessions s where s.conversation_id=v.id and s.landlord_id=c.landlord_id and s.check_id=c.id)
  or exists(select 1 from public.home_check_sms_capture_sessions s where s.conversation_id=v.id and s.claim_id is not null and s.claim_expires_at>now())
  or not exists(select 1 from public.sms_messages m where m.landlord_id=c.landlord_id and m.conversation_id=v.id and m.direction='inbound' and m.from_number=p_from and m.to_number=p_to and to_jsonb(m.media_urls)?(p->>'path')) then return null;end if;
 update public.sms_conversations set intake_state=jsonb_set(intake_state,'{home_check_photo_pending}',p||jsonb_build_object('at',now())) where id=v.id;
 return jsonb_build_object('checkId',c.id,'expectedSlot',p->>'expectedSlot');
end $$;
revoke all on function public.resume_home_check_sms_photo(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.resume_home_check_sms_photo(uuid,uuid,text,text) to service_role;
