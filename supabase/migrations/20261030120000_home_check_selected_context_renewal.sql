-- Preserve confirmed SMS check selection beyond the short photo lock, with compare-and-swap renewal.
CREATE OR REPLACE FUNCTION public.home_check_sms_capture_context(p_action text, p_landlord_id uuid, p_conversation_id uuid, p_check_id uuid DEFAULT NULL::uuid, p_slot text DEFAULT NULL::text, p_version uuid DEFAULT NULL::uuid, p_claim uuid DEFAULT NULL::uuid, p_media_path text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare c public.home_checks; s public.home_check_sms_capture_sessions; v public.sms_conversations; next_slot text;
begin
 select * into v from public.sms_conversations where id=p_conversation_id and landlord_id=p_landlord_id for update;
 if not found then raise exception 'Conversation scope mismatch' using errcode='42501'; end if;
 select * into c from public.home_checks where id=p_check_id and landlord_id=p_landlord_id for update;
 if not found or c.recipient_phone is distinct from v.external_phone_number or c.confirmed_at is not null
  or c.status not in ('collecting','completed') or c.expires_at<=now()
  or not exists(select 1 from public.sms_numbers n where n.id=v.sms_number_id and n.phone_number=c.ulo_number)
 then raise exception 'Home Check no longer belongs to this sender and line' using errcode='42501'; end if;
 select * into s from public.home_check_sms_capture_sessions where conversation_id=v.id for update;
 if p_action='bind' then
  -- A supplied version means automatic renewal of an explicitly selected check.
  -- Never overwrite a newer selection, reuse a filled slot, or resolve ambiguity silently.
  if p_version is not null then
   if s.check_id is distinct from c.id or s.version is distinct from p_version
    or s.expected_slot is distinct from p_slot or p_slot is null
    or exists(select 1 from public.home_check_photos p where p.check_id=c.id and p.slot=p_slot)
   then return jsonb_build_object('ok',false,'reason','stale'); end if;
   if exists(select 1 from public.home_checks h where h.landlord_id=c.landlord_id
    and h.recipient_phone=c.recipient_phone and h.ulo_number=c.ulo_number
    and h.id<>c.id and h.confirmed_at is null and h.status in ('collecting','completed') and h.expires_at>now())
   then return jsonb_build_object('ok',false,'reason','ambiguous'); end if;
  end if;
  if s.claim_id is not null and s.claim_expires_at>now() then return jsonb_build_object('ok',false,'reason','busy'); end if;
  if exists(select 1 from public.home_check_sms_capture_sessions x where x.check_id=c.id and x.conversation_id<>v.id and x.claim_id is not null and x.claim_expires_at>now()) then return jsonb_build_object('ok',false,'reason','busy'); end if;
  delete from public.home_check_sms_capture_sessions where check_id=c.id and conversation_id<>v.id;
  select slot into next_slot from unnest(array['water_heater_label','water_heater_whole','heating_label','heating_whole']) with ordinality t(slot,position)
   where not exists(select 1 from public.home_check_photos p where p.check_id=c.id and p.slot=t.slot) order by position limit 1;
  insert into public.home_check_sms_capture_sessions(conversation_id,landlord_id,check_id,expected_slot,expires_at)
   values(v.id,p_landlord_id,c.id,coalesce(p_slot,next_slot),least(c.expires_at,now()+interval '30 minutes'))
   on conflict(conversation_id) do update set check_id=excluded.check_id,expected_slot=excluded.expected_slot,
    version=gen_random_uuid(),expires_at=excluded.expires_at,claim_id=null,claim_expires_at=null returning * into s;
 elsif p_action='claim' then
  if not exists(select 1 from public.sms_messages m where m.conversation_id=v.id and m.landlord_id=c.landlord_id and m.direction='inbound' and m.from_number=c.recipient_phone and m.to_number=c.ulo_number and to_jsonb(m.media_urls) ? p_media_path) then raise exception 'Photo does not belong to this conversation' using errcode='42501'; end if;
  if s.check_id is distinct from c.id or s.version is distinct from p_version or s.expires_at<=now() or s.expected_slot is distinct from p_slot then return jsonb_build_object('ok',false,'reason','stale'); end if;
  if s.claim_id is not null then
   if s.claim_expires_at<=now() then update public.home_check_sms_capture_sessions set claim_id=null,claim_expires_at=null,version=gen_random_uuid() where conversation_id=v.id; end if;
   return jsonb_build_object('ok',false,'reason','busy');
  end if;
  update public.home_check_sms_capture_sessions set claim_id=gen_random_uuid(),claim_expires_at=now()+interval '90 seconds' where conversation_id=v.id returning * into s;
 elsif p_action='release' then
  update public.home_check_sms_capture_sessions set claim_id=null,claim_expires_at=null,version=gen_random_uuid()
   where conversation_id=v.id and claim_id=p_claim returning * into s;
 else raise exception 'Unknown capture action'; end if;
 return jsonb_build_object('ok',true,'checkId',s.check_id,'slot',s.expected_slot,'version',s.version,'claim',s.claim_id,'expiresAt',s.expires_at);
end $function$
;
