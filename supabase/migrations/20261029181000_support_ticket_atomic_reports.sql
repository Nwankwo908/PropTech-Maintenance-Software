-- One transaction serializes reports by account+signature; only service code can call.
alter table public.support_tickets add column if not exists notify_claim uuid;
alter table public.support_tickets add column if not exists notify_delivery_key text;
alter table public.support_tickets add column if not exists notify_claimed_at timestamptz;
create or replace function public.report_product_support_ticket(
 p_landlord_id uuid, p_summary text, p_signature text, p_transcript text,
 p_resolution text default null, p_admin_user_id uuid default null, p_conversation_id uuid default null
) returns jsonb language plpgsql security invoker set search_path = public as $$
declare t public.support_tickets; was_created boolean; claim uuid;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_landlord_id::text || ':' || p_signature, 0));
 select * into t from public.support_tickets where landlord_id=p_landlord_id
  and dedup_signature=p_signature and status='open' for update;
 was_created := not found;
 if was_created then
  insert into public.support_tickets(landlord_id,summary,dedup_signature,transcript_excerpt,
   attempted_resolution,admin_user_id,conversation_id)
  values(p_landlord_id,p_summary,p_signature,p_transcript,p_resolution,p_admin_user_id,p_conversation_id)
  returning * into t;
 else
  update public.support_tickets set repeat_count=repeat_count+1,last_seen_at=now(),updated_at=now(),
   summary=p_summary,transcript_excerpt=p_transcript,attempted_resolution=p_resolution,
   admin_user_id=p_admin_user_id,conversation_id=p_conversation_id where id=t.id returning * into t;
 end if;
 insert into public.support_ticket_signature_signals(dedup_signature,total_sightings,distinct_landlord_count)
 values(p_signature,1,(select count(distinct landlord_id) from public.support_tickets where dedup_signature=p_signature))
 on conflict(dedup_signature) do update set total_sightings=support_ticket_signature_signals.total_sightings+1,
 distinct_landlord_count=(select count(distinct landlord_id) from public.support_tickets where dedup_signature=p_signature),
 last_seen_at=now(),updated_at=now();
 if (was_created or t.notify_status in ('failed','skipped') or t.repeat_count%3=0 or
      (t.notify_status='pending' and (t.notify_claimed_at is null or t.notify_claimed_at < now()-interval '30 seconds')))
  and (t.notify_claim is null or t.notify_claimed_at < now()-interval '30 seconds') then
  claim := gen_random_uuid();
  update public.support_tickets set notify_claim=claim,notify_claimed_at=now(),notify_delivery_key=case when t.notify_status='sent' then gen_random_uuid()::text else coalesce(t.notify_delivery_key,gen_random_uuid()::text) end,notify_status='pending',notify_error=null where id=t.id returning * into t;
 end if;
 return jsonb_build_object('id',t.id,'created',was_created,'repeat_count',t.repeat_count,
  'notify_status',case when claim is not null then 'pending' else t.notify_status end,'notify_claim',claim,'notify_delivery_key',t.notify_delivery_key);
end $$;
revoke all on function public.report_product_support_ticket(uuid,text,text,text,text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.report_product_support_ticket(uuid,text,text,text,text,uuid,uuid) to service_role;
