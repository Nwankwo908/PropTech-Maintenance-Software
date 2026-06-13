-- Property operations graph v3: link tasks, inspections, occupancy to the shared graph.
-- Move-in, move-out, and unit inspection are workflow templates — not separate products.

-- ---------------------------------------------------------------------------
-- 1. operations_tasks — reusable task entity (checklists, follow-ups, prep)
-- ---------------------------------------------------------------------------

create table if not exists public.operations_tasks (
  id uuid primary key default gen_random_uuid(),
  landlord_id uuid not null,
  task_type text not null,
  status text not null default 'open'
    constraint operations_tasks_status_check
      check (status in ('open', 'in_progress', 'completed', 'cancelled')),
  workflow_run_id uuid references public.workflow_runs (id) on delete set null,
  property_id uuid,
  unit_id uuid references public.units (id) on delete set null,
  resident_id uuid references public.users (id) on delete set null,
  occupancy_id uuid references public.occupancy (id) on delete set null,
  inspection_id uuid,
  vendor_id uuid references public.vendors (id) on delete set null,
  title text,
  due_at timestamptz,
  completed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.operations_tasks is
  'Cross-workflow operational tasks (move-in checklist, inspection prep, move-out turnover).';
comment on column public.operations_tasks.task_type is
  'Domain key, e.g. move_in_checklist, move_out_turnover, inspection_prep.';

create index if not exists operations_tasks_landlord_id_idx
  on public.operations_tasks (landlord_id);

create index if not exists operations_tasks_workflow_run_id_idx
  on public.operations_tasks (workflow_run_id)
  where workflow_run_id is not null;

create index if not exists operations_tasks_unit_id_idx
  on public.operations_tasks (unit_id)
  where unit_id is not null;

create index if not exists operations_tasks_status_idx
  on public.operations_tasks (status)
  where status in ('open', 'in_progress');

alter table public.operations_tasks enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'operations_tasks'
      and policyname = 'operations_tasks_select_staff'
  ) then
    create policy operations_tasks_select_staff
      on public.operations_tasks
      for select
      to authenticated
      using (public.is_staff_admin());
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. unit_inspections — scheduled inspections (move-in, move-out, periodic)
-- ---------------------------------------------------------------------------

create table if not exists public.unit_inspections (
  id uuid primary key default gen_random_uuid(),
  landlord_id uuid not null,
  inspection_type text not null
    constraint unit_inspections_type_check
      check (inspection_type in ('move_in', 'move_out', 'periodic', 'annual', 'common_area')),
  status text not null default 'scheduled'
    constraint unit_inspections_status_check
      check (status in ('scheduled', 'notice_sent', 'in_progress', 'completed', 'cancelled')),
  workflow_run_id uuid references public.workflow_runs (id) on delete set null,
  property_id uuid,
  unit_id uuid references public.units (id) on delete set null,
  resident_id uuid references public.users (id) on delete set null,
  occupancy_id uuid references public.occupancy (id) on delete set null,
  scheduled_at timestamptz,
  notice_sent_at timestamptz,
  completed_at timestamptz,
  inspector_name text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.unit_inspections is
  'Inspection records driven by unit_inspection workflow runs.';

create index if not exists unit_inspections_landlord_id_idx
  on public.unit_inspections (landlord_id);

create index if not exists unit_inspections_workflow_run_id_idx
  on public.unit_inspections (workflow_run_id)
  where workflow_run_id is not null;

create index if not exists unit_inspections_unit_scheduled_idx
  on public.unit_inspections (unit_id, scheduled_at desc)
  where unit_id is not null;

alter table public.unit_inspections enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'unit_inspections'
      and policyname = 'unit_inspections_select_staff'
  ) then
    create policy unit_inspections_select_staff
      on public.unit_inspections
      for select
      to authenticated
      using (public.is_staff_admin());
  end if;
end $$;

-- operations_tasks.inspection_id FK (after unit_inspections exists)
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'operations_tasks_inspection_id_fkey'
      and conrelid = 'public.operations_tasks'::regclass
  ) then
    alter table public.operations_tasks
      add constraint operations_tasks_inspection_id_fkey
      foreign key (inspection_id) references public.unit_inspections (id) on delete set null;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. operations_graph_events — entity link columns
-- ---------------------------------------------------------------------------

alter table public.operations_graph_events
  add column if not exists occupancy_id uuid references public.occupancy (id) on delete set null;

alter table public.operations_graph_events
  add column if not exists inspection_id uuid references public.unit_inspections (id) on delete set null;

alter table public.operations_graph_events
  add column if not exists task_id uuid references public.operations_tasks (id) on delete set null;

comment on column public.operations_graph_events.occupancy_id is
  'Links graph events to a tenancy period (move-in / move-out workflows).';
comment on column public.operations_graph_events.inspection_id is
  'Links graph events to a unit_inspections row.';
comment on column public.operations_graph_events.task_id is
  'Links graph events to an operations_tasks row.';

create index if not exists operations_graph_events_occupancy_id_idx
  on public.operations_graph_events (occupancy_id)
  where occupancy_id is not null;

create index if not exists operations_graph_events_inspection_id_idx
  on public.operations_graph_events (inspection_id)
  where inspection_id is not null;

create index if not exists operations_graph_events_task_id_idx
  on public.operations_graph_events (task_id)
  where task_id is not null;

-- ---------------------------------------------------------------------------
-- 4. Workflow templates (config blueprints — handlers live in engine/templates/)
-- ---------------------------------------------------------------------------

insert into public.workflow_templates (
  id,
  name,
  type,
  description,
  trigger_config,
  route_config,
  escalation_config,
  active
)
values
  (
    'move_in',
    'Move In',
    'leasing',
    'Tenant move-in lifecycle: activate unit, register resident, send checklist, confirm keys/utilities.',
    jsonb_build_object(
      'type', 'unit_activation',
      'triggers', jsonb_build_array('dashboard', 'automation'),
      'description', 'Unit activated with new tenant occupancy'
    ),
    jsonb_build_object(
      'handler', 'move_in',
      'domain', 'leasing',
      'classify', jsonb_build_object(
        'workflow', 'move_in',
        'label', 'Classify as move-in for new occupancy'
      ),
      'route', jsonb_build_object(
        'action', 'send_move_in_checklist',
        'channels', jsonb_build_array('sms', 'email'),
        'label', 'Send move-in checklist and welcome outreach'
      ),
      'act', jsonb_build_object(
        'action', 'complete_move_in_tasks',
        'label', 'Track checklist completion and unit readiness'
      ),
      'log', jsonb_build_object(
        'action', 'append_graph_and_tasks',
        'tables', jsonb_build_array('operations_graph_events', 'operations_tasks', 'workflow_events')
      )
    ),
    jsonb_build_object(
      'no_response_days', 5,
      'action', 'notify_landlord',
      'label', 'Incomplete move-in checklist → notify property manager'
    ),
    true
  ),
  (
    'move_out',
    'Move Out',
    'leasing',
    'Tenant move-out lifecycle: notice, turnover tasks, vacancy, deposit workflow.',
    jsonb_build_object(
      'type', 'occupancy_end',
      'triggers', jsonb_build_array('dashboard', 'sms_inbound', 'cron', 'automation'),
      'description', 'Resident vacates or lease ends; unit marked vacant'
    ),
    jsonb_build_object(
      'handler', 'move_out',
      'domain', 'leasing',
      'classify', jsonb_build_object(
        'workflow', 'move_out',
        'label', 'Classify as move-out / vacancy turnover'
      ),
      'route', jsonb_build_object(
        'action', 'send_move_out_instructions',
        'channels', jsonb_build_array('sms', 'email'),
        'label', 'Send move-out instructions and inspection scheduling'
      ),
      'act', jsonb_build_object(
        'action', 'complete_turnover',
        'label', 'Mark unit vacant, end occupancy, schedule move-out inspection'
      ),
      'log', jsonb_build_object(
        'action', 'append_graph_and_tasks',
        'tables', jsonb_build_array('operations_graph_events', 'operations_tasks', 'workflow_events')
      )
    ),
    jsonb_build_object(
      'no_response_days', 7,
      'action', 'escalate_turnover',
      'label', 'Overdue move-out → escalate to property manager'
    ),
    true
  ),
  (
    'unit_inspection',
    'Unit Inspection',
    'operations',
    'Inspection notices and follow-through: schedule, notify resident, record outcome.',
    jsonb_build_object(
      'type', 'inspection_scheduled',
      'triggers', jsonb_build_array('dashboard', 'cron', 'automation'),
      'description', 'Scheduled or ad-hoc unit / common-area inspection'
    ),
    jsonb_build_object(
      'handler', 'unit_inspection',
      'domain', 'operations',
      'classify', jsonb_build_object(
        'workflow', 'unit_inspection',
        'label', 'Classify inspection type (move_in, move_out, periodic, annual)'
      ),
      'route', jsonb_build_object(
        'action', 'send_inspection_notice',
        'channels', jsonb_build_array('sms', 'email'),
        'label', 'Send legally required inspection notice to affected units'
      ),
      'act', jsonb_build_object(
        'action', 'record_inspection_outcome',
        'label', 'Capture inspection results and follow-up tasks'
      ),
      'log', jsonb_build_object(
        'action', 'append_graph_and_inspections',
        'tables', jsonb_build_array('operations_graph_events', 'unit_inspections', 'workflow_events')
      )
    ),
    jsonb_build_object(
      'notice_hours_before', 72,
      'no_show_days', 3,
      'action', 'reschedule_or_escalate',
      'label', 'Missed inspection window → reschedule or notify admin'
    ),
    true
  )
on conflict (id) do update set
  name = excluded.name,
  type = excluded.type,
  description = excluded.description,
  trigger_config = excluded.trigger_config,
  route_config = excluded.route_config,
  escalation_config = excluded.escalation_config,
  active = excluded.active;
