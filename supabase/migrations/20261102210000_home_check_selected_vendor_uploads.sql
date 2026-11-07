-- A vendor's active visit outlives the short guided-photo session. Renew only
-- the existing explicitly selected session, under the same locks as collection.
create function public.collect_selected_home_check_vendor_photos(
 p_landlord_id uuid,p_conversation_id uuid,p_check_id uuid,p_capture_version uuid,p_paths text[])
returns jsonb language plpgsql security invoker set search_path=public as $$
declare c public.home_checks; v public.sms_conversations; s public.home_check_sms_capture_sessions;
begin
 select * into v from public.sms_conversations where id=p_conversation_id and landlord_id=p_landlord_id for update;
 if not found then raise exception 'Conversation scope mismatch' using errcode='42501'; end if;
 select * into c from public.home_checks where id=p_check_id and landlord_id=p_landlord_id for update;
 if not found or c.role<>'contractor' or c.status<>'collecting' or c.confirmed_at is not null or c.expires_at<=now()
  or c.recipient_phone is distinct from v.external_phone_number or c.visit->>'phase' is distinct from 'in_progress'
  or c.visit->>'photoPromptSentAt' is null
  or not exists(select 1 from public.sms_numbers n where n.id=v.sms_number_id and n.phone_number=c.ulo_number)
 then raise exception 'Vendor photo scope mismatch' using errcode='42501'; end if;
 select * into s from public.home_check_sms_capture_sessions where conversation_id=v.id and landlord_id=c.landlord_id for update;
 if not found or s.check_id is distinct from c.id or p_capture_version is null or s.version is distinct from p_capture_version
 then return jsonb_build_object('status','stale'); end if;
 -- A previously held single photo requires explicit recovery, not silent mixing.
 if v.intake_state->'home_check_photo_pending' is not null then return jsonb_build_object('status','review'); end if;
 if s.expires_at<=now() then
  if s.claim_id is not null and s.claim_expires_at>now() then return jsonb_build_object('status','processing'); end if;
  -- Keep the selection/version unchanged so simultaneous carrier deliveries use
  -- the same batch. Clearing an expired claim still fences its old photo writer.
  update public.home_check_sms_capture_sessions set expires_at=least(c.expires_at,now()+interval '30 minutes'),
   claim_id=null,claim_expires_at=null where conversation_id=v.id;
 end if;
 -- Existing collector checks every media path against inbound message provenance,
 -- deduplicates, and grants exactly one processing lease for the four-photo group.
 return public.collect_home_check_vendor_photos(p_landlord_id,p_conversation_id,p_check_id,p_paths);
end $$;
revoke all on function public.collect_selected_home_check_vendor_photos(uuid,uuid,uuid,uuid,text[]) from public,anon,authenticated;
grant execute on function public.collect_selected_home_check_vendor_photos(uuid,uuid,uuid,uuid,text[]) to service_role;
