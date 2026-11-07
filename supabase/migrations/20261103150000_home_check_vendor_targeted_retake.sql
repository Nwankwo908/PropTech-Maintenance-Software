-- Retain three confidently matched views and replace only the unmatched view.
-- Service-only, current processing claim and explicit sender/line selection required.
create function public.prepare_home_check_vendor_photo_retake(
 p_landlord_id uuid,p_conversation_id uuid,p_check_id uuid,p_claim uuid,p_capture_version uuid,p_keep_paths text[],p_missing_slot text)
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
 if cardinality(p_keep_paths) is distinct from 3 or (select count(distinct p) from unnest(p_keep_paths) p)<>3
  or cardinality(g.paths)<>4 or not p_keep_paths<@g.paths
  or p_missing_slot is null or p_missing_slot not in ('water_heater_label','water_heater_whole','heating_label','heating_whole') then return false; end if;
 update public.home_check_vendor_upload_groups set paths=p_keep_paths,state='collecting',claim=null,claim_until=null,updated_at=now() where check_id=c.id;
 update public.home_check_sms_capture_sessions set expected_slot=p_missing_slot,version=gen_random_uuid(),expires_at=least(c.expires_at,now()+interval '30 minutes'),claim_id=null,claim_expires_at=null where conversation_id=v.id;
 return true;
end $$;
revoke all on function public.prepare_home_check_vendor_photo_retake(uuid,uuid,uuid,uuid,uuid,text[],text) from public,anon,authenticated;
grant execute on function public.prepare_home_check_vendor_photo_retake(uuid,uuid,uuid,uuid,uuid,text[],text) to service_role;

alter table public.home_check_vendor_upload_groups add column if not exists retry_count integer not null default 0;
alter table public.home_check_vendor_upload_groups add column if not exists last_retry_at timestamptz;
create function public.retry_home_check_vendor_photos(p_landlord_id uuid,p_conversation_id uuid,p_check_id uuid,p_capture_version uuid)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare c public.home_checks; v public.sms_conversations; s public.home_check_sms_capture_sessions; g public.home_check_vendor_upload_groups; token uuid;
begin
 select * into v from public.sms_conversations where id=p_conversation_id and landlord_id=p_landlord_id for update;
 if not found then raise exception 'Conversation scope mismatch' using errcode='42501'; end if;
 select * into c from public.home_checks where id=p_check_id and landlord_id=p_landlord_id for update;
 if not found or c.role<>'contractor' or c.status<>'collecting' or c.confirmed_at is not null or c.expires_at<=now()
  or c.recipient_phone is distinct from v.external_phone_number or c.visit->>'phase' is distinct from 'in_progress' or c.visit->>'photoPromptSentAt' is null
  or not exists(select 1 from public.sms_numbers n where n.id=v.sms_number_id and n.phone_number=c.ulo_number)
 then raise exception 'Vendor photo scope mismatch' using errcode='42501'; end if;
 select * into s from public.home_check_sms_capture_sessions where conversation_id=v.id and landlord_id=c.landlord_id for update;
 if not found or s.check_id is distinct from c.id or p_capture_version is null or s.version is distinct from p_capture_version then return jsonb_build_object('status','stale'); end if;
 if s.claim_id is not null and s.claim_expires_at>now() then return jsonb_build_object('status','processing'); end if;
 if exists(select 1 from public.home_check_photos where check_id=c.id) or v.intake_state->'home_check_photo_pending' is not null then return jsonb_build_object('status','review'); end if;
 select * into g from public.home_check_vendor_upload_groups where check_id=c.id and landlord_id=c.landlord_id and conversation_id=v.id for update;
 if not found then return jsonb_build_object('status','unavailable'); end if;
 if g.state='processing' and g.claim_until>now() then return jsonb_build_object('status','processing'); end if;
 if cardinality(g.paths)<>4 then return jsonb_build_object('status','awaiting_photo','count',cardinality(g.paths),'slot',s.expected_slot); end if;
 if g.retry_count>=3 or g.last_retry_at>now()-interval '1 minute' then return jsonb_build_object('status','rate_limited'); end if;
 if exists(select 1 from unnest(g.paths) p where not exists(select 1 from public.sms_messages m where m.landlord_id=c.landlord_id and m.conversation_id=v.id and m.direction='inbound' and m.from_number=c.recipient_phone and m.to_number=c.ulo_number and to_jsonb(m.media_urls) ? p)) then raise exception 'Photo provenance mismatch' using errcode='42501'; end if;
 token:=gen_random_uuid();
 update public.home_check_vendor_upload_groups set state='processing',claim=token,claim_until=now()+interval '10 minutes',retry_count=retry_count+1,last_retry_at=now(),updated_at=now() where check_id=c.id;
 update public.home_check_sms_capture_sessions set expires_at=least(c.expires_at,now()+interval '30 minutes'),claim_id=null,claim_expires_at=null where conversation_id=v.id;
 return jsonb_build_object('status','ready','paths',g.paths,'claim',token);
end $$;
revoke all on function public.retry_home_check_vendor_photos(uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.retry_home_check_vendor_photos(uuid,uuid,uuid,uuid) to service_role;
