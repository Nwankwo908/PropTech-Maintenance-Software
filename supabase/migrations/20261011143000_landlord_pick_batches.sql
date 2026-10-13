-- Batched landlord decisions over SMS.
-- display_id is the landlord-facing ticket number (#101). LANDLORD_PICK remains
-- vendor_notify_error = 'Awaiting landlord vendor choice' — no parallel status.

create table if not exists public.landlord_ticket_counters (
  landlord_id uuid primary key references public.landlords (id) on delete cascade,
  next_display_id integer not null default 101
);

alter table public.maintenance_requests
  add column if not exists display_id integer;

alter table public.maintenance_requests
  add column if not exists snoozed_until timestamptz;

alter table public.maintenance_requests
  add column if not exists landlord_handled_at timestamptz;

alter table public.maintenance_requests
  add column if not exists skipped_at timestamptz;

create unique index if not exists maintenance_requests_landlord_display_id_uidx
  on public.maintenance_requests (landlord_id, display_id)
  where display_id is not null;

comment on column public.maintenance_requests.display_id is
  'Per-landlord ticket number shown as #101 in landlord SMS. Never reused.';
comment on column public.maintenance_requests.snoozed_until is
  'Landlord snoozed this pick until this time. Hidden from batches until then.';
comment on column public.maintenance_requests.landlord_handled_at is
  'Landlord chose to handle this request themselves.';
comment on column public.maintenance_requests.skipped_at is
  'Landlord skipped a proactive request. Reactive tenant requests cannot be skipped.';

-- Backfill in created_at order, starting at 101 per landlord.
do $$
declare
  r record;
  n integer;
begin
  for r in
    select id, landlord_id
    from public.maintenance_requests
    where display_id is null
      and landlord_id is not null
    order by landlord_id, created_at, id
  loop
    insert into public.landlord_ticket_counters (landlord_id, next_display_id)
    values (r.landlord_id, 101)
    on conflict (landlord_id) do nothing;

    update public.landlord_ticket_counters
    set next_display_id = next_display_id + 1
    where landlord_id = r.landlord_id
    returning next_display_id - 1 into n;

    update public.maintenance_requests
    set display_id = n
    where id = r.id
      and display_id is null;
  end loop;
end $$;

create or replace function public.assign_display_id_on_ticket_insert()
returns trigger
language plpgsql
as $$
declare
  v_id integer;
begin
  if new.display_id is not null or new.landlord_id is null then
    return new;
  end if;

  insert into public.landlord_ticket_counters (landlord_id, next_display_id)
  values (new.landlord_id, 101)
  on conflict (landlord_id) do nothing;

  update public.landlord_ticket_counters
  set next_display_id = next_display_id + 1
  where landlord_id = new.landlord_id
  returning next_display_id - 1 into v_id;

  new.display_id := v_id;
  return new;
end $$;

drop trigger if exists maintenance_requests_assign_display_id on public.maintenance_requests;
create trigger maintenance_requests_assign_display_id
  before insert on public.maintenance_requests
  for each row
  execute function public.assign_display_id_on_ticket_insert();

create table if not exists public.landlord_pick_batches (
  id uuid primary key default gen_random_uuid(),
  landlord_id uuid not null references public.landlords (id) on delete cascade,
  recipient_phone text not null,
  conversation_id uuid references public.sms_conversations (id) on delete set null,
  outbound_message_id uuid,
  created_at timestamptz not null default now(),
  status text not null default 'open'
    check (status in ('open', 'superseded', 'closed', 'queued')),
  send_after timestamptz,
  superseded_at timestamptz,
  yes_all_confirm_requested_at timestamptz
);

create index if not exists landlord_pick_batches_recipient_idx
  on public.landlord_pick_batches (landlord_id, recipient_phone, created_at desc);

comment on table public.landlord_pick_batches is
  'One outbound decision list for a landlord phone. queued = held because one was sent in the last 10 minutes.';

create table if not exists public.landlord_pick_batch_items (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.landlord_pick_batches (id) on delete cascade,
  ticket_id uuid not null references public.maintenance_requests (id) on delete cascade,
  display_id integer not null,
  snapshot jsonb not null,
  position integer not null,
  unique (batch_id, ticket_id),
  unique (batch_id, display_id)
);

create table if not exists public.landlord_decision_inbound_log (
  provider_message_sid text primary key,
  landlord_id uuid not null references public.landlords (id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.landlord_ticket_counters enable row level security;
alter table public.landlord_pick_batches enable row level security;
alter table public.landlord_pick_batch_items enable row level security;
alter table public.landlord_decision_inbound_log enable row level security;
