-- A conversation must select a check and step. Only service code may bind/claim.
create table public.home_check_sms_capture_sessions (
 conversation_id uuid primary key references public.sms_conversations(id) on delete cascade,
 landlord_id uuid not null references public.landlords(id) on delete cascade,
 check_id uuid not null unique references public.home_checks(id) on delete cascade,
 expected_slot text check(expected_slot in ('water_heater_label','water_heater_whole','heating_label','heating_whole')),
 version uuid not null default gen_random_uuid(),
 expires_at timestamptz not null,
 claim_id uuid,
 claim_expires_at timestamptz
);
alter table public.home_check_sms_capture_sessions enable row level security;
revoke all on public.home_check_sms_capture_sessions from anon,authenticated;
grant all on public.home_check_sms_capture_sessions to service_role;

create function public.home_check_sms_capture_context(p_action text,p_landlord_id uuid,p_conversation_id uuid,
 p_check_id uuid default null,p_slot text default null,p_version uuid default null,p_claim uuid default null,p_media_path text default null)
returns jsonb language plpgsql security invoker set search_path=public as $$
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
end $$;

-- Fence the actual attachment, not just the HTTP request. An expired/stale worker
-- cannot replace a newer photo after its claim was released or superseded.
create function public.record_home_check_sms_photo(p_check_id uuid,p_slot text,p_photo_id uuid,p_storage_path text,
 p_conversation_id uuid,p_claim uuid)
returns void language plpgsql security invoker set search_path=public as $$
declare s public.home_check_sms_capture_sessions; c public.home_checks; v public.sms_conversations; next_slot text;
begin
 select * into v from public.sms_conversations where id=p_conversation_id for update;
 select * into c from public.home_checks where id=p_check_id for update;
 select * into s from public.home_check_sms_capture_sessions where conversation_id=v.id for update;
 if s.check_id is distinct from c.id or s.landlord_id is distinct from c.landlord_id or v.landlord_id is distinct from c.landlord_id
  or s.claim_id is distinct from p_claim or p_claim is null or s.claim_expires_at<=now() or s.expires_at<=now()
  or s.expected_slot is distinct from p_slot or v.external_phone_number is distinct from c.recipient_phone
  or not exists(select 1 from public.sms_numbers n where n.id=v.sms_number_id and n.phone_number=c.ulo_number)
 then raise exception 'Photo context changed; nothing was attached' using errcode='42501'; end if;
 perform public.record_home_check_photo(c.id,p_slot,p_photo_id,p_storage_path,'photo_text');
 select slot into next_slot from unnest(array['water_heater_label','water_heater_whole','heating_label','heating_whole']) with ordinality t(slot,position)
  where not exists(select 1 from public.home_check_photos p where p.check_id=c.id and p.slot=t.slot) order by position limit 1;
 update public.home_check_sms_capture_sessions set expected_slot=next_slot,version=gen_random_uuid(),claim_id=null,claim_expires_at=null,
 expires_at=least(c.expires_at,now()+interval '30 minutes') where conversation_id=v.id;
end $$;
revoke all on function public.home_check_sms_capture_context(text,uuid,uuid,uuid,text,uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.record_home_check_sms_photo(uuid,text,uuid,text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.home_check_sms_capture_context(text,uuid,uuid,uuid,text,uuid,uuid,text) to service_role;
grant execute on function public.record_home_check_sms_photo(uuid,text,uuid,text,uuid,uuid) to service_role;

-- Preserve the first ambiguous photo. A second concurrent MMS cannot replace it.
create function public.hold_home_check_sms_photo(p_landlord_id uuid,p_conversation_id uuid,p_pending jsonb,p_expected_path text default null)
returns boolean language plpgsql security invoker set search_path=public as $$
declare v public.sms_conversations; existing jsonb;
begin
 select * into v from public.sms_conversations where id=p_conversation_id and landlord_id=p_landlord_id for update;
 if not found then raise exception 'Conversation scope mismatch' using errcode='42501'; end if;
 existing:=v.intake_state->'home_check_photo_pending';
 if p_pending is null then
  if existing->>'path'=p_expected_path then update public.sms_conversations set intake_state=intake_state-'home_check_photo_pending' where id=v.id; end if;
  return true;
 end if;
 if existing is not null and (existing->>'at')::timestamptz>now()-interval '30 minutes' and existing->>'path'<>p_pending->>'path' then return false; end if;
 if not exists(select 1 from public.sms_messages m where m.landlord_id=p_landlord_id and m.conversation_id=v.id and m.direction='inbound' and m.from_number=v.external_phone_number and to_jsonb(m.media_urls) ? (p_pending->>'path')) then raise exception 'Photo scope mismatch' using errcode='42501'; end if;
 update public.sms_conversations set intake_state=jsonb_set(coalesce(intake_state,'{}'),'{home_check_photo_pending}',p_pending||jsonb_build_object('at',now())) where id=v.id;
 return true;
end $$;
revoke all on function public.hold_home_check_sms_photo(uuid,uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.hold_home_check_sms_photo(uuid,uuid,jsonb,text) to service_role;

create function public.reset_home_check_sms_capture(p_landlord_id uuid,p_conversation_id uuid)
returns boolean language plpgsql security invoker set search_path=public as $$
declare v public.sms_conversations;
begin
 select * into v from public.sms_conversations where id=p_conversation_id and landlord_id=p_landlord_id for update;
 if not found then raise exception 'Conversation scope mismatch' using errcode='42501'; end if;
 if exists(select 1 from public.home_check_sms_capture_sessions where conversation_id=v.id and claim_id is not null and claim_expires_at>now()) then return false; end if;
 delete from public.home_check_sms_capture_sessions where conversation_id=v.id;
 update public.sms_conversations set intake_state=coalesce(intake_state,'{}')-'home_check_photo_pending' where id=v.id;
 return true;
end $$;
revoke all on function public.reset_home_check_sms_capture(uuid,uuid) from public,anon,authenticated;
grant execute on function public.reset_home_check_sms_capture(uuid,uuid) to service_role;
