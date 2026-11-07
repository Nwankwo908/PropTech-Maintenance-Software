-- Durable same-ticket reopen audit (completed/cancelled → open).
-- Separate from KPI rework (new same-unit ticket). Forward-only; no backfill.
-- Helper + trigger both call record_maintenance_work_order_reopen so concurrent
-- writes collapse to one row per reopen (10s dedupe window).

create table if not exists public.maintenance_work_order_reopens (
  id uuid primary key default gen_random_uuid(),
  landlord_id uuid not null references public.landlords (id) on delete cascade,
  maintenance_request_id uuid not null
    references public.maintenance_requests (id) on delete cascade,
  vendor_id uuid references public.vendors (id) on delete set null,
  reopened_at timestamptz not null default now(),
  previous_status text not null,
  new_status text not null,
  triggered_by text not null
    constraint maintenance_work_order_reopens_triggered_by_check
      check (triggered_by in ('tenant_sms', 'landlord', 'admin', 'system')),
  trigger_ref text
);

comment on table public.maintenance_work_order_reopens is
  'Same-ticket reopen when vendor_work_status leaves completed/cancelled for an open status. Not used for KPI rework scoring.';

create index if not exists maintenance_work_order_reopens_vendor_reopened_idx
  on public.maintenance_work_order_reopens (vendor_id, reopened_at desc)
  where vendor_id is not null;

create index if not exists maintenance_work_order_reopens_ticket_reopened_idx
  on public.maintenance_work_order_reopens (maintenance_request_id, reopened_at desc);

create index if not exists maintenance_work_order_reopens_landlord_reopened_idx
  on public.maintenance_work_order_reopens (landlord_id, reopened_at desc);

alter table public.maintenance_work_order_reopens enable row level security;

drop policy if exists maintenance_work_order_reopens_select_staff
  on public.maintenance_work_order_reopens;
create policy maintenance_work_order_reopens_select_staff
  on public.maintenance_work_order_reopens
  for select
  to authenticated
  using (public.is_staff_admin());

-- Idempotent insert: one row per ticket+from+to within 10 seconds (helper + trigger).
create or replace function public.record_maintenance_work_order_reopen(
  p_landlord_id uuid,
  p_maintenance_request_id uuid,
  p_vendor_id uuid,
  p_previous_status text,
  p_new_status text,
  p_triggered_by text,
  p_trigger_ref text default null
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  existing_id uuid;
  inserted_id uuid;
  prev text := lower(trim(coalesce(p_previous_status, '')));
  next_status text := lower(trim(coalesce(p_new_status, '')));
  actor text := lower(trim(coalesce(p_triggered_by, 'system')));
begin
  if prev not in ('completed', 'cancelled') then
    return null;
  end if;
  if next_status in ('', 'completed', 'cancelled') then
    return null;
  end if;
  if actor not in ('tenant_sms', 'landlord', 'admin', 'system') then
    actor := 'system';
  end if;

  -- Serialize helper + trigger (and any concurrent writers) on this ticket.
  perform pg_advisory_xact_lock(hashtextextended(p_maintenance_request_id::text, 0));

  select r.id into existing_id
  from public.maintenance_work_order_reopens r
  where r.maintenance_request_id = p_maintenance_request_id
    and lower(r.previous_status) = prev
    and lower(r.new_status) = next_status
    and r.reopened_at > now() - interval '10 seconds'
  order by r.reopened_at desc
  limit 1
  for update;

  if existing_id is not null then
    -- Prefer a more specific actor over the trigger's 'system' placeholder.
    if actor <> 'system' then
      update public.maintenance_work_order_reopens
      set
        triggered_by = actor,
        trigger_ref = coalesce(p_trigger_ref, trigger_ref),
        vendor_id = coalesce(p_vendor_id, vendor_id)
      where id = existing_id
        and triggered_by = 'system';
    end if;
    return existing_id;
  end if;

  insert into public.maintenance_work_order_reopens (
    landlord_id,
    maintenance_request_id,
    vendor_id,
    previous_status,
    new_status,
    triggered_by,
    trigger_ref
  ) values (
    p_landlord_id,
    p_maintenance_request_id,
    p_vendor_id,
    prev,
    next_status,
    actor,
    p_trigger_ref
  )
  returning id into inserted_id;

  return inserted_id;
end;
$$;

revoke all on function public.record_maintenance_work_order_reopen(uuid, uuid, uuid, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.record_maintenance_work_order_reopen(uuid, uuid, uuid, text, text, text, text)
  to service_role;

create or replace function public.trg_maintenance_request_reopen()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  old_status text := lower(trim(coalesce(old.vendor_work_status, '')));
  new_status text := lower(trim(coalesce(new.vendor_work_status, '')));
begin
  if old_status is not distinct from new_status then
    return new;
  end if;
  if old_status not in ('completed', 'cancelled') then
    return new;
  end if;
  if new_status in ('', 'completed', 'cancelled') then
    return new;
  end if;

  perform public.record_maintenance_work_order_reopen(
    new.landlord_id,
    new.id,
    new.assigned_vendor_id,
    old_status,
    new_status,
    'system',
    'trigger:maintenance_requests.vendor_work_status'
  );
  return new;
end;
$$;

drop trigger if exists trg_maintenance_request_reopen on public.maintenance_requests;
create trigger trg_maintenance_request_reopen
  after update of vendor_work_status on public.maintenance_requests
  for each row
  execute function public.trg_maintenance_request_reopen();
