-- Complete photo clarification atomically; confirmed equipment records are immutable here.
create function public.resolve_completed_home_check_photo(
 p_landlord_id uuid,p_conversation_id uuid,p_check_id uuid,p_vendor_id uuid,
 p_message_id uuid,p_phone text,p_line text,p_choice text,p_ticket_id uuid default null)
returns boolean language plpgsql security invoker set search_path=public as $$
declare v public.sms_conversations; c public.home_checks; s public.home_check_sms_capture_sessions;
 m public.sms_messages; j public.maintenance_requests; pending jsonb; paths text[];
begin
 select * into v from public.sms_conversations where id=p_conversation_id and landlord_id=p_landlord_id for update;
 if not found or v.external_phone_number is distinct from p_phone then return false; end if;
 pending:=v.intake_state->'home_check_completed_photo';
 if pending->>'checkId' is distinct from p_check_id::text or pending->>'messageId' is distinct from p_message_id::text
  or coalesce(pending->>'phase','') not in ('choice','job') or coalesce((pending->>'expiresAt')::timestamptz,'epoch')<=now() then return false; end if;
 select * into c from public.home_checks where id=p_check_id and landlord_id=p_landlord_id for update;
 if not found or c.role<>'contractor' or c.status<>'confirmed' or c.confirmed_at is null
  or c.confirmed_at<now()-interval '7 days' or c.vendor_id is distinct from p_vendor_id
  or c.recipient_phone is distinct from p_phone or c.ulo_number is distinct from p_line
  or not exists(select 1 from public.sms_numbers n where n.id=v.sms_number_id and n.phone_number=p_line) then return false; end if;
 select * into s from public.home_check_sms_capture_sessions where conversation_id=v.id and landlord_id=c.landlord_id for update;
 if not found or s.check_id is distinct from c.id then return false; end if;
 if exists(select 1 from public.home_checks where landlord_id=c.landlord_id and recipient_phone=p_phone
  and ulo_number=p_line and role='contractor' and status in ('collecting','completed') and confirmed_at is null and expires_at>now()) then return false; end if;
 select * into m from public.sms_messages where id=p_message_id and conversation_id=v.id and landlord_id=c.landlord_id
  and direction='inbound' and from_number=p_phone and to_number=p_line;
 if not found or coalesce(cardinality(m.media_urls),0)<1 or exists(select 1 from unnest(m.media_urls) path where path is null or btrim(path)='' or path ~ '://') then return false; end if;
 if p_choice='correction' then
  insert into public.home_check_events(id,check_id,role,event_type,metadata)
   values(md5('home-check-correction:'||m.id::text)::uuid,c.id,'contractor','correction_photo_received',
    jsonb_build_object('message_id',m.id,'photo_count',cardinality(m.media_urls),'review_required',true)) on conflict(id) do nothing;
 elsif p_choice='job' and pending->>'phase'='job' and p_ticket_id is not null then
  select * into j from public.maintenance_requests where id=p_ticket_id and landlord_id=c.landlord_id for update;
  if not found or j.assigned_vendor_id is distinct from p_vendor_id or j.completed_at is not null
   or coalesce(j.vendor_work_status,'') not in ('pending_accept','accepted','in_progress','unassigned') then return false; end if;
  select array_agg(distinct path order by path) into paths from unnest(coalesce(j.photo_paths,'{}'::text[])||m.media_urls) path;
  update public.maintenance_requests set photo_paths=paths where id=j.id and landlord_id=c.landlord_id;
 else return false;
 end if;
 update public.sms_conversations set intake_state=intake_state-'home_check_completed_photo' where id=v.id and landlord_id=c.landlord_id;
 return true;
end $$;
revoke all on function public.resolve_completed_home_check_photo(uuid,uuid,uuid,uuid,uuid,text,text,text,uuid) from public,anon,authenticated;
grant execute on function public.resolve_completed_home_check_photo(uuid,uuid,uuid,uuid,uuid,text,text,text,uuid) to service_role;
