-- Retry locks for resident, vendor, and broadcast delivery logs.
-- New columns only. Existing rows keep delivery_status null until a retry sets it.

alter table public.resident_notification_log
  add column if not exists delivery_status text,
  add column if not exists retry_count integer not null default 0,
  add column if not exists last_retry_at timestamptz;

alter table public.vendor_notification_log
  add column if not exists delivery_status text,
  add column if not exists retry_count integer not null default 0,
  add column if not exists last_retry_at timestamptz;

alter table public.broadcast_notification_log
  add column if not exists delivery_status text,
  add column if not exists retry_count integer not null default 0,
  add column if not exists last_retry_at timestamptz;

alter table public.resident_notification_log
  drop constraint if exists resident_notification_log_delivery_status_check;
alter table public.resident_notification_log
  add constraint resident_notification_log_delivery_status_check
  check (
    delivery_status is null
    or delivery_status in ('queued', 'sending', 'sent', 'delivered', 'undelivered', 'failed', 'read')
  );

alter table public.vendor_notification_log
  drop constraint if exists vendor_notification_log_delivery_status_check;
alter table public.vendor_notification_log
  add constraint vendor_notification_log_delivery_status_check
  check (
    delivery_status is null
    or delivery_status in ('queued', 'sending', 'sent', 'delivered', 'undelivered', 'failed', 'read')
  );

alter table public.broadcast_notification_log
  drop constraint if exists broadcast_notification_log_delivery_status_check;
alter table public.broadcast_notification_log
  add constraint broadcast_notification_log_delivery_status_check
  check (
    delivery_status is null
    or delivery_status in ('queued', 'sending', 'sent', 'delivered', 'undelivered', 'failed', 'read')
  );

create table if not exists public.delivery_retry_attempts (
  id uuid primary key default gen_random_uuid(),
  landlord_id uuid not null,
  source text not null,
  log_id uuid not null,
  retry_count integer not null,
  idempotency_key text not null unique,
  result jsonb,
  created_at timestamptz not null default now(),
  constraint delivery_retry_attempts_source_check
    check (source in ('resident', 'vendor', 'broadcast'))
);

create index if not exists delivery_retry_attempts_landlord_created_idx
  on public.delivery_retry_attempts (landlord_id, created_at desc);

alter table public.delivery_retry_attempts enable row level security;

-- Matches commitRetryClaim in retryFailedDelivery.ts.
-- One conditional UPDATE so two overlapping requests cannot both claim.
create or replace function public.claim_delivery_retry(
  p_source text,
  p_log_id uuid,
  p_landlord_id uuid,
  p_opted_out boolean
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_created timestamptz;
  v_count integer;
  v_last timestamptz;
  v_landlord uuid;
  v_recent integer;
  v_next integer;
  v_key text;
  v_existing jsonb;
  v_updated integer;
begin
  if p_source is null or p_source not in ('resident', 'vendor', 'broadcast') then
    return jsonb_build_object('kind', 'deny', 'status', 400, 'reason', 'invalid_source');
  end if;

  if p_source = 'resident' then
    select landlord_id, created_at, retry_count, last_retry_at, delivery_status
      into v_landlord, v_created, v_count, v_last, v_status
    from public.resident_notification_log
    where id = p_log_id
    for update;
  elsif p_source = 'vendor' then
    select landlord_id, created_at, retry_count, last_retry_at, delivery_status
      into v_landlord, v_created, v_count, v_last, v_status
    from public.vendor_notification_log
    where id = p_log_id
    for update;
  else
    select landlord_id, created_at, retry_count, last_retry_at, delivery_status
      into v_landlord, v_created, v_count, v_last, v_status
    from public.broadcast_notification_log
    where id = p_log_id
    for update;
  end if;

  if not found or v_landlord is distinct from p_landlord_id then
    return jsonb_build_object('kind', 'deny', 'status', 404, 'reason', 'not_found');
  end if;

  if coalesce(p_opted_out, false) then
    return jsonb_build_object('kind', 'deny', 'status', 409, 'reason', 'opted_out');
  end if;

  if coalesce(v_status, '') not in ('failed', 'undelivered') then
    return jsonb_build_object('kind', 'deny', 'status', 409, 'reason', 'not_failed');
  end if;

  if v_created < now() - interval '7 days' then
    return jsonb_build_object('kind', 'deny', 'status', 409, 'reason', 'expired');
  end if;

  if coalesce(v_count, 0) >= 3 then
    return jsonb_build_object('kind', 'deny', 'status', 429, 'reason', 'retry_limit');
  end if;

  if coalesce(v_count, 0) > 0
     and v_last is not null
     and v_last > now() - interval '5 minutes' then
    select result into v_existing
    from public.delivery_retry_attempts
    where idempotency_key = p_log_id::text || ':' || v_count::text
      and result is not null;
    if v_existing is not null then
      return jsonb_build_object('kind', 'replay', 'body', v_existing);
    end if;
    return jsonb_build_object('kind', 'deny', 'status', 429, 'reason', 'retry_gap');
  end if;

  select count(*) into v_recent
  from public.delivery_retry_attempts
  where landlord_id = p_landlord_id
    and created_at > now() - interval '1 hour';

  if coalesce(v_recent, 0) >= 30 then
    return jsonb_build_object('kind', 'deny', 'status', 429, 'reason', 'rate_limit');
  end if;

  v_next := coalesce(v_count, 0) + 1;
  v_key := p_log_id::text || ':' || v_next::text;

  if p_source = 'resident' then
    update public.resident_notification_log
    set retry_count = retry_count + 1,
        last_retry_at = now()
    where id = p_log_id
      and landlord_id = p_landlord_id
      and retry_count = v_count
      and retry_count < 3
      and (last_retry_at is null or last_retry_at < now() - interval '5 minutes')
      and delivery_status in ('failed', 'undelivered')
      and created_at > now() - interval '7 days';
  elsif p_source = 'vendor' then
    update public.vendor_notification_log
    set retry_count = retry_count + 1,
        last_retry_at = now()
    where id = p_log_id
      and landlord_id = p_landlord_id
      and retry_count = v_count
      and retry_count < 3
      and (last_retry_at is null or last_retry_at < now() - interval '5 minutes')
      and delivery_status in ('failed', 'undelivered')
      and created_at > now() - interval '7 days';
  else
    update public.broadcast_notification_log
    set retry_count = retry_count + 1,
        last_retry_at = now()
    where id = p_log_id
      and landlord_id = p_landlord_id
      and retry_count = v_count
      and retry_count < 3
      and (last_retry_at is null or last_retry_at < now() - interval '5 minutes')
      and delivery_status in ('failed', 'undelivered')
      and created_at > now() - interval '7 days';
  end if;

  get diagnostics v_updated = row_count;
  if v_updated <> 1 then
    return jsonb_build_object('kind', 'deny', 'status', 429, 'reason', 'conflict');
  end if;

  insert into public.delivery_retry_attempts (
    landlord_id, source, log_id, retry_count, idempotency_key
  ) values (
    p_landlord_id, p_source, p_log_id, v_next, v_key
  )
  on conflict (idempotency_key) do nothing;

  return jsonb_build_object(
    'kind', 'send',
    'retryCount', v_next,
    'idempotencyKey', v_key
  );
end;
$$;

create or replace function public.complete_delivery_retry(
  p_key text,
  p_result jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.delivery_retry_attempts
  set result = p_result
  where idempotency_key = p_key
    and result is null;
end;
$$;

revoke all on function public.claim_delivery_retry(text, uuid, uuid, boolean) from public;
revoke all on function public.complete_delivery_retry(text, jsonb) from public;
grant execute on function public.claim_delivery_retry(text, uuid, uuid, boolean) to service_role;
grant execute on function public.complete_delivery_retry(text, jsonb) to service_role;
