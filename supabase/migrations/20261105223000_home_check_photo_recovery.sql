-- Durable photo-pair work, fenced by the exact current pair. No user data backfill.
create table public.home_check_photo_jobs (
 id uuid primary key default gen_random_uuid(),
 landlord_id uuid not null references public.landlords(id),
 check_id uuid not null references public.home_checks(id) on delete cascade,
 system text not null check(system in ('water_heater','heating')),
 label_id uuid not null references public.property_inspection_photos(id),
 whole_id uuid not null references public.property_inspection_photos(id),
 state text not null check(state in ('processing','pending','done','failed','cancelled')),
 attempts integer not null default 1 check(attempts between 1 and 3),
 noticed_at timestamptz, next_at timestamptz not null default now(), token uuid, lease_until timestamptz,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(check_id,system,label_id,whole_id)
);
create index home_check_photo_jobs_due on public.home_check_photo_jobs(next_at) where state in ('processing','pending');
create table public.home_check_recovery_notices (
 id uuid primary key default gen_random_uuid(), check_id uuid not null references public.home_checks(id) on delete cascade,
 snapshot text not null, state text not null default 'sending' check(state in ('sending','sent','uncertain')),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(check_id,snapshot)
);
alter table public.home_check_photo_jobs enable row level security;
alter table public.home_check_recovery_notices enable row level security;
revoke all on public.home_check_photo_jobs,public.home_check_recovery_notices from anon,authenticated;
grant all on public.home_check_photo_jobs,public.home_check_recovery_notices to service_role;

create function public.home_check_pair_work(p_action text,p_check uuid,p_label uuid,p_whole uuid,p_token uuid default null,p_result jsonb default null)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare c public.home_checks; j public.home_check_photo_jobs; sys text; t uuid; good boolean;
begin
 select * into c from public.home_checks where id=p_check for update;
 if not found or c.confirmed_at is not null or c.status not in ('collecting','completed') or c.expires_at<=now() then return jsonb_build_object('ok',false,'reason','ended'); end if;
 select case when a.slot='water_heater_label' then 'water_heater' else 'heating' end into sys
 from public.home_check_photos a join public.home_check_photos b on b.check_id=a.check_id
 join public.property_inspection_photos x on x.id=a.inspection_photo_id and x.landlord_id=c.landlord_id and x.assessment_id=c.assessment_id
 join public.property_inspection_photos y on y.id=b.inspection_photo_id and y.landlord_id=c.landlord_id and y.assessment_id=c.assessment_id
 where a.check_id=c.id and a.inspection_photo_id=p_label and b.inspection_photo_id=p_whole
 and ((a.slot='water_heater_label' and b.slot='water_heater_whole') or (a.slot='heating_label' and b.slot='heating_whole'));
 if sys is null then return jsonb_build_object('ok',false,'reason','replaced'); end if;
 select * into j from public.home_check_photo_jobs where check_id=c.id and label_id=p_label and whole_id=p_whole and system=sys for update;
 if p_action='begin' then
  if j.id is not null and (j.state in ('done','failed','cancelled') or j.next_at>now() or (j.state='processing' and j.lease_until>now())) then return jsonb_build_object('ok',false,'reason',j.state); end if;
  if j.id is not null and j.attempts>=3 then
   update public.property_inspection_photos set status='error',ai_result=null,error_message='Automatic photo processing needs review.',updated_at=now() where id in (p_label,p_whole) and landlord_id=c.landlord_id;
   update public.home_check_photo_jobs set state='failed',token=null,lease_until=null,updated_at=now() where id=j.id;
   return jsonb_build_object('ok',false,'reason','exhausted');
  end if;
  t:=gen_random_uuid();
  if j.id is null then
   insert into public.home_check_photo_jobs(landlord_id,check_id,system,label_id,whole_id,state,token,lease_until)
   values(c.landlord_id,c.id,sys,p_label,p_whole,'processing',t,now()+interval '4 minutes') returning * into j;
  else
   update public.home_check_photo_jobs set state='processing',attempts=attempts+1,token=t,lease_until=now()+interval '4 minutes',updated_at=now() where id=j.id returning * into j;
  end if;
  update public.property_inspection_photos set status='analyzing',error_message=null,updated_at=now() where id in (p_label,p_whole) and landlord_id=c.landlord_id;
  return jsonb_build_object('ok',true,'id',j.id,'token',t,'attempt',j.attempts);
 elsif p_action='finish' then
  if j.id is null or j.state<>'processing' or j.token is distinct from p_token or j.lease_until<=now() then return jsonb_build_object('ok',false,'reason','stale'); end if;
  good:=p_result->>'status'='needs_review' and jsonb_typeof(p_result->'ai_result')='object';
  if good then
   update public.property_inspection_photos set status='needs_review',ai_result=p_result->'ai_result',
    provider=p_result->>'provider',serial_review=p_result->'serial_review',latency_ms=(p_result->>'latency_ms')::integer,
    error_message=null,updated_at=now() where id in (p_label,p_whole) and landlord_id=c.landlord_id;
   update public.home_check_photo_jobs set state='done',token=null,lease_until=null,updated_at=now() where id=j.id;
  else
   update public.property_inspection_photos set status='error',ai_result=null,error_message=case when j.attempts>=3 then 'Automatic photo processing needs review.' else 'Photo processing will retry automatically; the photos are retained.' end,updated_at=now() where id in (p_label,p_whole) and landlord_id=c.landlord_id;
   update public.home_check_photo_jobs set state=case when attempts>=3 then 'failed' else 'pending' end,
    next_at=now()+make_interval(secs=>30*power(2,attempts-1)::integer),token=null,lease_until=null,updated_at=now() where id=j.id;
  end if;
  return jsonb_build_object('ok',true,'success',good);
 end if;
 raise exception 'Invalid pair action';
end $$;

create function public.claim_home_check_photo_retry(p_landlord uuid default null)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare j public.home_check_photo_jobs; r jsonb;
begin
 -- Lock order is always check then job, matching the upload path.
 for j in select * from public.home_check_photo_jobs where (p_landlord is null or landlord_id=p_landlord)
  and ((state='pending' and next_at<=now()) or (state='processing' and lease_until<=now())) order by next_at limit 20 loop
  r:=public.home_check_pair_work('begin',j.check_id,j.label_id,j.whole_id);
  if (r->>'ok')::boolean then return to_jsonb(j)||r; end if;
  if r->>'reason' in ('ended','replaced') then update public.home_check_photo_jobs set state='cancelled',token=null,lease_until=null,updated_at=now() where id=j.id and state in ('pending','processing'); end if;
 end loop;
 return null;
end $$;

create function public.reserve_home_check_recovery_notice(p_check uuid)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare c public.home_checks; signature text; n uuid; terminal boolean;
begin
 select * into c from public.home_checks where id=p_check for update;
 if not found then return null; end if;
 if c.confirmed_at is not null or c.expires_at<=now() or c.status not in ('collecting','completed') then update public.home_check_photo_jobs set noticed_at=now() where check_id=c.id and state in ('done','failed','cancelled');return null; end if;
 if not exists(select 1 from public.home_check_photo_jobs j where j.check_id=c.id and (j.attempts>1 or j.state='failed') and j.state in ('done','failed')
  and exists(select 1 from public.home_check_photos p where p.check_id=c.id and p.inspection_photo_id=j.label_id)
  and exists(select 1 from public.home_check_photos p where p.check_id=c.id and p.inspection_photo_id=j.whole_id)) then return null; end if;
 if exists(select 1 from public.home_check_photo_jobs j where j.check_id=c.id and j.state in ('pending','processing')
  and exists(select 1 from public.home_check_photos p where p.check_id=c.id and p.inspection_photo_id=j.label_id)
  and exists(select 1 from public.home_check_photos p where p.check_id=c.id and p.inspection_photo_id=j.whole_id)) then return null; end if;
 select md5(string_agg(p.slot||':'||p.inspection_photo_id::text,',' order by p.slot)),bool_or(i.status='error') into signature,terminal
 from public.home_check_photos p join public.property_inspection_photos i on i.id=p.inspection_photo_id and i.landlord_id=c.landlord_id where p.check_id=c.id;
 insert into public.home_check_recovery_notices(check_id,snapshot) values(c.id,signature) on conflict do nothing returning id into n;
 update public.home_check_photo_jobs set noticed_at=now() where check_id=c.id and state in ('done','failed','cancelled');
 if n is null then return null; end if;
 return jsonb_build_object('id',n,'check_id',c.id,'landlord_id',c.landlord_id,'failed',coalesce(terminal,false));
end $$;

revoke all on function public.home_check_pair_work(text,uuid,uuid,uuid,uuid,jsonb),public.claim_home_check_photo_retry(uuid),public.reserve_home_check_recovery_notice(uuid) from public,anon,authenticated;
grant execute on function public.home_check_pair_work(text,uuid,uuid,uuid,uuid,jsonb),public.claim_home_check_photo_retry(uuid),public.reserve_home_check_recovery_notice(uuid) to service_role;
