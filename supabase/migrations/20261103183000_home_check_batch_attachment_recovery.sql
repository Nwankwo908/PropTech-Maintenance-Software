-- Retain three confidently matched views and replace only the unmatched view.
-- Service-only, current processing claim and explicit sender/line selection required.
create function public.prepare_home_check_vendor_batch_attachment(
 p_landlord_id uuid,p_conversation_id uuid,p_check_id uuid,p_claim uuid,p_capture_version uuid)
returns boolean language plpgsql security invoker set search_path=public as $$
declare c public.home_checks; v public.sms_conversations; s public.home_check_sms_capture_sessions; g public.home_check_vendor_upload_groups;
begin
 select * into v from public.sms_conversations where id=p_conversation_id and landlord_id=p_landlord_id for update;
 if not found then raise exception 'Conversation scope mismatch' using errcode='42501'; end if;
 select * into c from public.home_checks where id=p_check_id and landlord_id=p_landlord_id for update;
 if not found or c.role<>'contractor' or c.status<>'collecting' or c.confirmed_at is not null or c.expires_at<=now()
  or c.recipient_phone is distinct from v.external_phone_number or c.visit->>'phase' is distinct from 'in_progress' or c.visit->>'photoPromptSentAt' is null
  or not exists(select 1 from public.sms_numbers n where n.id=v.sms_number_id and n.phone_number=c.ulo_number)
 then raise exception 'Vendor photo scope mismatch' using errcode='42501'; end if;
 select * into s from public.home_check_sms_capture_sessions where conversation_id=v.id and landlord_id=c.landlord_id for update;
 if not found or s.check_id is distinct from c.id or p_capture_version is null or s.version is distinct from p_capture_version or s.claim_id is not null then return false; end if;
 select * into g from public.home_check_vendor_upload_groups where check_id=c.id and landlord_id=c.landlord_id and conversation_id=v.id for update;
 if not found or g.state<>'processing' or g.claim is distinct from p_claim or p_claim is null or g.claim_until is null or g.claim_until<=now() then return false; end if;
 if exists(select 1 from public.home_check_photos where check_id=c.id) or v.intake_state->'home_check_photo_pending' is not null then return false; end if;
 if cardinality(g.paths)<>4 then return false; end if;
 update public.home_check_sms_capture_sessions set expected_slot='water_heater_label',
  version=gen_random_uuid(),expires_at=least(c.expires_at,now()+interval '30 minutes'),claim_id=null,claim_expires_at=null
 where conversation_id=v.id;
 return true;
end $$;
revoke all on function public.prepare_home_check_vendor_batch_attachment(uuid,uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.prepare_home_check_vendor_batch_attachment(uuid,uuid,uuid,uuid,uuid) to service_role;
