-- Delivery callbacks may arrive out of order. A lower rank never overwrites
-- a higher one. Twilio's delivered, undelivered, and failed are final and
-- share one rank, so the first of those statuses stands.

create or replace function public.sms_provider_status_rank(p_status text)
returns integer
language sql
immutable
as $$
  select case lower(coalesce(p_status, ''))
    when 'queued' then 1
    when 'sending' then 2
    when 'sent' then 3
    when 'delivered' then 4
    when 'undelivered' then 4
    when 'failed' then 4
    when 'read' then 5
    else 0
  end
$$;

create table if not exists public.sms_status_events (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.sms_messages (id) on delete cascade,
  from_status text,
  to_status text not null,
  created_at timestamptz not null default now(),
  constraint sms_status_events_message_status_unique unique (message_id, to_status)
);

alter table public.sms_status_events enable row level security;

create or replace function public.apply_sms_provider_status(
  p_provider text,
  p_provider_message_sid text,
  p_status text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  rec public.sms_messages%rowtype;
  v_updated integer;
  v_event uuid;
begin
  select *
    into rec
  from public.sms_messages
  where provider = p_provider
    and provider_message_sid = p_provider_message_sid
  for update;

  if not found then
    return jsonb_build_object('found', false);
  end if;

  if public.sms_provider_status_rank(rec.provider_status)
     >= public.sms_provider_status_rank(p_status) then
    return jsonb_build_object(
      'found', true,
      'applied', false,
      'stale', true,
      'event_created', false,
      'id', rec.id,
      'conversation_id', rec.conversation_id,
      'landlord_id', rec.landlord_id,
      'direction', rec.direction,
      'provider_status', rec.provider_status,
      'previous_status', rec.provider_status
    );
  end if;

  update public.sms_messages
  set provider_status = p_status
  where id = rec.id
    and public.sms_provider_status_rank(provider_status)
        < public.sms_provider_status_rank(p_status);

  get diagnostics v_updated = row_count;
  if v_updated <> 1 then
    return jsonb_build_object(
      'found', true,
      'applied', false,
      'stale', true,
      'event_created', false,
      'id', rec.id,
      'conversation_id', rec.conversation_id,
      'landlord_id', rec.landlord_id,
      'direction', rec.direction,
      'provider_status', rec.provider_status,
      'previous_status', rec.provider_status
    );
  end if;

  insert into public.sms_status_events (message_id, from_status, to_status)
  values (rec.id, rec.provider_status, p_status)
  on conflict (message_id, to_status) do nothing
  returning id into v_event;

  return jsonb_build_object(
    'found', true,
    'applied', true,
    'stale', false,
    'event_created', v_event is not null,
    'id', rec.id,
    'conversation_id', rec.conversation_id,
    'landlord_id', rec.landlord_id,
    'direction', rec.direction,
    'provider_status', p_status,
    'previous_status', rec.provider_status
  );
end;
$$;

revoke all on function public.apply_sms_provider_status(text, text, text) from public;
grant execute on function public.apply_sms_provider_status(text, text, text) to service_role;
revoke all on function public.sms_provider_status_rank(text) from public;
grant execute on function public.sms_provider_status_rank(text) to service_role;
