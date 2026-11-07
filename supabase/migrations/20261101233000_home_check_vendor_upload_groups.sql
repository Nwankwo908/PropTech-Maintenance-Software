-- Carrier-split MMS must retain all four authenticated paths, without guessing slots.
create table public.home_check_vendor_upload_groups (
 check_id uuid primary key references public.home_checks(id) on delete cascade,
 landlord_id uuid not null references public.landlords(id) on delete cascade,
 conversation_id uuid not null references public.sms_conversations(id) on delete cascade,
 paths text[] not null default '{}',
 state text not null default 'collecting' check (state in ('collecting','processing','fallback')),
 claim uuid,
 claim_until timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 check(cardinality(paths)<=4)
);
alter table public.home_check_vendor_upload_groups enable row level security;
revoke all on public.home_check_vendor_upload_groups from anon, authenticated;
grant all on public.home_check_vendor_upload_groups to service_role;

create function public.collect_home_check_vendor_photos(p_landlord_id uuid,p_conversation_id uuid,p_check_id uuid,p_paths text[])
returns jsonb language plpgsql security invoker set search_path=public as $$
declare c public.home_checks; v public.sms_conversations; g public.home_check_vendor_upload_groups;
 merged text[]; added integer; token uuid;
begin
 -- Same lock order as capture claims: conversation, then check.
 select * into v from public.sms_conversations where id=p_conversation_id and landlord_id=p_landlord_id for update;
 if not found then raise exception 'Conversation scope mismatch' using errcode='42501'; end if;
 select * into c from public.home_checks where id=p_check_id and landlord_id=p_landlord_id for update;
 if not found or c.role<>'contractor' or c.status<>'collecting' or c.expires_at<=now()
  or c.recipient_phone is distinct from v.external_phone_number
  or c.visit->>'phase' is distinct from 'in_progress'
  or not exists(select 1 from public.sms_numbers n where n.id=v.sms_number_id and n.phone_number=c.ulo_number)
  or not exists(select 1 from public.home_check_sms_capture_sessions s where s.conversation_id=v.id and s.landlord_id=c.landlord_id and s.check_id=c.id and s.expires_at>now())
 then raise exception 'Vendor photo scope mismatch' using errcode='42501'; end if;
 if coalesce(cardinality(p_paths),0)<1 or cardinality(p_paths)>4 then raise exception 'Invalid photo count'; end if;
 if exists(select 1 from unnest(p_paths) p where p is null or p='' or p ~* '^https?:' or not exists(
  select 1 from public.sms_messages m where m.landlord_id=c.landlord_id and m.conversation_id=v.id
   and m.direction='inbound' and m.from_number=c.recipient_phone and m.to_number=c.ulo_number
   and m.created_at>=coalesce((c.visit->>'photoPromptSentAt')::timestamptz,c.created_at)
   and to_jsonb(m.media_urls) ? p))
 then raise exception 'Photo provenance mismatch' using errcode='42501'; end if;
 insert into public.home_check_vendor_upload_groups(check_id,landlord_id,conversation_id) values(c.id,c.landlord_id,v.id) on conflict do nothing;
 select * into g from public.home_check_vendor_upload_groups where check_id=c.id for update;
 if g.landlord_id<>c.landlord_id or g.conversation_id<>v.id then raise exception 'Upload group scope mismatch' using errcode='42501'; end if;
 if g.state='fallback' then return jsonb_build_object('status','review'); end if;
 if g.state='processing' and g.claim_until>now() then return jsonb_build_object('status','processing'); end if;
 select array_agg(distinct p order by p) into merged from unnest(g.paths||p_paths) p;
 if cardinality(merged)>4 then return jsonb_build_object('status','review'); end if;
 added:=cardinality(merged)-cardinality(g.paths);
 if cardinality(merged)=4 then
  token:=gen_random_uuid();
  update public.home_check_vendor_upload_groups set paths=merged,state='processing',claim=token,claim_until=now()+interval '10 minutes',updated_at=now() where check_id=c.id;
  return jsonb_build_object('status','ready','paths',merged,'claim',token);
 end if;
 if added=0 then return jsonb_build_object('status','duplicate'); end if;
 update public.home_check_vendor_upload_groups set paths=merged,updated_at=now() where check_id=c.id;
 return jsonb_build_object('status','collecting','count',cardinality(merged),'first',cardinality(g.paths)=0);
end $$;

create function public.finish_home_check_vendor_photos(p_landlord_id uuid,p_conversation_id uuid,p_check_id uuid,p_claim uuid)
returns boolean language plpgsql security invoker set search_path=public as $$
begin
 -- Keep paths for audit/dedup. Any necessary retakes use the guided flow.
 update public.home_check_vendor_upload_groups set state='fallback',claim=null,claim_until=null,updated_at=now()
 where check_id=p_check_id and landlord_id=p_landlord_id and conversation_id=p_conversation_id and claim=p_claim and p_claim is not null;
 return found;
end $$;
revoke all on function public.collect_home_check_vendor_photos(uuid,uuid,uuid,text[]) from public,anon,authenticated;
revoke all on function public.finish_home_check_vendor_photos(uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.collect_home_check_vendor_photos(uuid,uuid,uuid,text[]) to service_role;
grant execute on function public.finish_home_check_vendor_photos(uuid,uuid,uuid,uuid) to service_role;
