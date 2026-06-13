-- Canonical property operations graph: append-only events linking landlord scope,
-- property graph entities, workflow runs, and domain payloads.
-- Complements legacy operations_graph_events (dual-write during migration).
-- Idempotent: safe to re-run.

-- ---------------------------------------------------------------------------
-- 1. property_operations_graph
-- ---------------------------------------------------------------------------

create table if not exists public.property_operations_graph (
  id uuid primary key default gen_random_uuid(),
  landlord_id uuid not null,
  property_id uuid,
  unit_id uuid,
  resident_id uuid,
  vendor_id uuid,
  workflow_run_id uuid,
  event_type text not null,
  event_source text not null,
  event_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

comment on table public.property_operations_graph is
  'Append-only property operations graph. Connects landlords, properties, units, residents, vendors, and workflow runs across maintenance, rent collection, move-in, move-out, and inspection workflows.';
comment on column public.property_operations_graph.property_id is
  'Synthetic or future properties.id; use derive_property_id(landlord_id, building) until properties table exists.';
comment on column public.property_operations_graph.event_type is
  'Namespaced domain event, e.g. maintenance.ticket_created, rent.reminder_sent, move_in.checklist_sent, move_out.unit_vacated, inspection.notice_sent, workflow.classify.';
comment on column public.property_operations_graph.event_source is
  'Channel that produced the event (sms, dashboard, vendor_portal, edge_function, automation).';
comment on column public.property_operations_graph.event_payload is
  'Domain-specific JSON: actor, message, workflow_template_id, maintenance_request_id, inspection_id, task_id, etc.';

-- Backfill columns when an older shape already exists.
alter table public.property_operations_graph
  add column if not exists landlord_id uuid;
alter table public.property_operations_graph
  add column if not exists property_id uuid;
alter table public.property_operations_graph
  add column if not exists unit_id uuid;
alter table public.property_operations_graph
  add column if not exists resident_id uuid;
alter table public.property_operations_graph
  add column if not exists vendor_id uuid;
alter table public.property_operations_graph
  add column if not exists workflow_run_id uuid;
alter table public.property_operations_graph
  add column if not exists event_type text;
alter table public.property_operations_graph
  add column if not exists event_source text;
alter table public.property_operations_graph
  add column if not exists event_payload jsonb not null default '{}'::jsonb;
alter table public.property_operations_graph
  add column if not exists created_at timestamptz not null default now();

alter table public.property_operations_graph
  alter column event_payload set default '{}'::jsonb;

update public.property_operations_graph
set event_payload = '{}'::jsonb
where event_payload is null;

update public.property_operations_graph
set created_at = now()
where created_at is null;

alter table public.property_operations_graph
  alter column landlord_id set not null,
  alter column event_type set not null,
  alter column event_source set not null,
  alter column event_payload set not null,
  alter column created_at set not null,
  alter column created_at set default now();

-- event_source: matches operations_graph_events.source values.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'property_operations_graph_event_source_check'
      and conrelid = 'public.property_operations_graph'::regclass
  ) then
    alter table public.property_operations_graph
      add constraint property_operations_graph_event_source_check
      check (
        event_source in (
          'sms', 'dashboard', 'vendor_portal', 'edge_function', 'automation'
        )
      );
  end if;
end $$;

-- event_type: domain namespaces for supported workflows (+ workflow.* pipeline stages).
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'property_operations_graph_event_type_check'
      and conrelid = 'public.property_operations_graph'::regclass
  ) then
    alter table public.property_operations_graph
      add constraint property_operations_graph_event_type_check
      check (
        event_type ~ '^(maintenance|rent|move_in|move_out|inspection|workflow)\.'
      );
  end if;
end $$;

-- Foreign keys (nullable — graph events may be partial at write time).
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'property_operations_graph_unit_id_fkey'
      and conrelid = 'public.property_operations_graph'::regclass
  ) then
    alter table public.property_operations_graph
      add constraint property_operations_graph_unit_id_fkey
      foreign key (unit_id) references public.units (id) on delete set null;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'property_operations_graph_resident_id_fkey'
      and conrelid = 'public.property_operations_graph'::regclass
  ) then
    alter table public.property_operations_graph
      add constraint property_operations_graph_resident_id_fkey
      foreign key (resident_id) references public.users (id) on delete set null;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'property_operations_graph_vendor_id_fkey'
      and conrelid = 'public.property_operations_graph'::regclass
  ) then
    alter table public.property_operations_graph
      add constraint property_operations_graph_vendor_id_fkey
      foreign key (vendor_id) references public.vendors (id) on delete set null;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'property_operations_graph_workflow_run_id_fkey'
      and conrelid = 'public.property_operations_graph'::regclass
  ) then
    alter table public.property_operations_graph
      add constraint property_operations_graph_workflow_run_id_fkey
      foreign key (workflow_run_id) references public.workflow_runs (id) on delete set null;
  end if;
exception
  when duplicate_object then null;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Indexes
-- ---------------------------------------------------------------------------

create index if not exists property_operations_graph_landlord_id_idx
  on public.property_operations_graph (landlord_id);

create index if not exists property_operations_graph_landlord_created_idx
  on public.property_operations_graph (landlord_id, created_at desc);

create index if not exists property_operations_graph_property_id_idx
  on public.property_operations_graph (property_id)
  where property_id is not null;

create index if not exists property_operations_graph_unit_id_idx
  on public.property_operations_graph (unit_id)
  where unit_id is not null;

create index if not exists property_operations_graph_resident_id_idx
  on public.property_operations_graph (resident_id)
  where resident_id is not null;

create index if not exists property_operations_graph_vendor_id_idx
  on public.property_operations_graph (vendor_id)
  where vendor_id is not null;

create index if not exists property_operations_graph_workflow_run_id_idx
  on public.property_operations_graph (workflow_run_id)
  where workflow_run_id is not null;

create index if not exists property_operations_graph_event_type_idx
  on public.property_operations_graph (event_type);

create index if not exists property_operations_graph_event_source_idx
  on public.property_operations_graph (event_source);

create index if not exists property_operations_graph_created_at_idx
  on public.property_operations_graph (created_at desc);

-- Domain prefix index for maintenance / rent / move_in / move_out / inspection filters.
create index if not exists property_operations_graph_domain_idx
  on public.property_operations_graph (split_part(event_type, '.', 1));

-- ---------------------------------------------------------------------------
-- 3. Row level security
-- ---------------------------------------------------------------------------

alter table public.property_operations_graph enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'property_operations_graph'
      and policyname = 'property_operations_graph_select_staff'
  ) then
    create policy property_operations_graph_select_staff
      on public.property_operations_graph
      for select
      to authenticated
      using (public.is_staff_admin());
  end if;
end $$;

-- Inserts/updates: Edge Function / service role only (no anon/authenticated write policies).

-- ---------------------------------------------------------------------------
-- 4. Helpers — domain extraction + payload accessors
-- ---------------------------------------------------------------------------

create or replace function public.property_operations_graph_domain(p_event_type text)
returns text
language sql
immutable
as $$
  select split_part(coalesce(trim(p_event_type), ''), '.', 1);
$$;

comment on function public.property_operations_graph_domain(text) is
  'Returns workflow domain prefix from event_type (maintenance, rent, move_in, move_out, inspection, workflow).';

create or replace function public.property_operations_graph_payload_text(
  p_payload jsonb,
  p_key text
)
returns text
language sql
immutable
as $$
  select nullif(trim(p_payload ->> p_key), '');
$$;

comment on function public.property_operations_graph_payload_text(jsonb, text) is
  'Read a string key from event_payload (e.g. maintenance_request_id, workflow_template_id).';

-- ---------------------------------------------------------------------------
-- 5. Staff view — enriched graph rows for dashboards
-- ---------------------------------------------------------------------------

create or replace view public.property_operations_graph_enriched
with (security_invoker = true)
as
select
  pog.id,
  pog.landlord_id,
  pog.property_id,
  pog.unit_id,
  pog.resident_id,
  pog.vendor_id,
  pog.workflow_run_id,
  pog.event_type,
  public.property_operations_graph_domain(pog.event_type) as workflow_domain,
  pog.event_source,
  pog.event_payload,
  pog.created_at,
  wr.template_id as workflow_template_id,
  wr.status as workflow_run_status,
  u.unit_label,
  u.building,
  r.full_name as resident_name,
  v.name as vendor_name
from public.property_operations_graph pog
left join public.workflow_runs wr on wr.id = pog.workflow_run_id
left join public.units u on u.id = pog.unit_id
left join public.users r on r.id = pog.resident_id
left join public.vendors v on v.id = pog.vendor_id;

comment on view public.property_operations_graph_enriched is
  'Property operations graph with workflow run, unit, resident, and vendor labels for admin dashboards.';

-- ---------------------------------------------------------------------------
-- 6. Realtime (admin dashboards)
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1
       from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'property_operations_graph'
     )
  then
    execute 'alter publication supabase_realtime add table public.property_operations_graph';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 7. Legacy compatibility — optional read bridge from operations_graph_events
-- ---------------------------------------------------------------------------

create or replace view public.operations_graph_events_legacy_bridge
with (security_invoker = true)
as
select
  oge.id,
  oge.landlord_id,
  oge.property_id,
  oge.unit_id,
  oge.resident_id,
  oge.vendor_id,
  oge.workflow_run_id,
  oge.event_type,
  oge.source as event_source,
  jsonb_strip_nulls(
    jsonb_build_object(
      'actor_type', oge.actor_type,
      'actor_id', oge.actor_id,
      'maintenance_request_id', oge.maintenance_request_id,
      'conversation_id', oge.conversation_id,
      'message_id', oge.message_id,
      'workflow_template_id', oge.workflow_template_id,
      'occupancy_id', oge.occupancy_id,
      'inspection_id', oge.inspection_id,
      'task_id', oge.task_id,
      'legacy_metadata', oge.metadata
    )
  ) as event_payload,
  oge.created_at
from public.operations_graph_events oge
where oge.event_type ~ '^(maintenance|rent|move_in|move_out|inspection|workflow)\.';

comment on view public.operations_graph_events_legacy_bridge is
  'Maps legacy operations_graph_events rows into property_operations_graph column shape for unified reads.';
