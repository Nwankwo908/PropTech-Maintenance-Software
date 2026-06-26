-- Preventive maintenance pipeline: unit_assets → preventive_maintenance_tasks → workflow_runs.
-- PM Compliance % and task list both read from preventive_maintenance_tasks (via dashboard view).

-- ---------------------------------------------------------------------------
-- Workflow template: preventive_maintenance
-- Property Asset → Task Created → Workflow → Assigned → Completed → Compliance
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
values (
  'preventive_maintenance',
  'Preventive Maintenance',
  'operations',
  'Scheduled preventive work from property assets: task creation, vendor assignment, completion, and compliance tracking.',
  jsonb_build_object(
    'workflow_key', 'preventive_maintenance',
    'type', 'preventive_task_due',
    'primary_trigger', 'automation',
    'triggers', jsonb_build_array('automation', 'dashboard', 'cron'),
    'entity_types', jsonb_build_array('preventive_maintenance_task', 'unit_asset')
  ),
  jsonb_build_object(
    'workflow_key', 'preventive_maintenance',
    'handler', 'preventive_maintenance',
    'domain', 'operations',
    'pipeline', jsonb_build_array('trigger', 'classify', 'route', 'act', 'escalate', 'log'),
    'required_steps', jsonb_build_array(
      jsonb_build_object('key', 'task_created', 'stage', 'trigger', 'order', 1, 'label', 'Preventive task created'),
      jsonb_build_object('key', 'classify_task', 'stage', 'classify', 'order', 2, 'label', 'Classify task type'),
      jsonb_build_object('key', 'assign_vendor', 'stage', 'route', 'order', 3, 'label', 'Assign vendor or internal staff'),
      jsonb_build_object('key', 'complete_task', 'stage', 'act', 'order', 4, 'label', 'Mark task completed'),
      jsonb_build_object('key', 'update_compliance', 'stage', 'log', 'order', 5, 'label', 'Update PM compliance')
    )
  ),
  jsonb_build_object(
    'overdue_days', 1,
    'notify', jsonb_build_array('landlord')
  ),
  true
)
on conflict (id) do update
  set
    name = excluded.name,
    type = excluded.type,
    description = excluded.description,
    trigger_config = excluded.trigger_config,
    route_config = excluded.route_config,
    escalation_config = excluded.escalation_config,
    active = excluded.active;

-- ---------------------------------------------------------------------------
-- preventive_maintenance_tasks — source of truth for PM compliance
-- ---------------------------------------------------------------------------

create table if not exists public.preventive_maintenance_tasks (
  id uuid primary key default gen_random_uuid(),
  landlord_id uuid not null references public.landlords (id) on delete cascade,
  unit_asset_id uuid references public.unit_assets (id) on delete set null,
  workflow_run_id uuid references public.workflow_runs (id) on delete set null,
  title text not null,
  task_kind text not null default 'appliance'
    check (task_kind in ('appliance', 'inspection', 'service')),
  due_at timestamptz not null,
  status text not null default 'scheduled'
    check (status in ('scheduled', 'assigned', 'completed', 'cancelled')),
  assigned_vendor_id uuid references public.vendors (id) on delete set null,
  assigned_at timestamptz,
  completed_at timestamptz,
  unit_label text,
  building text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.preventive_maintenance_tasks is
  'Preventive maintenance tasks linked to property assets and workflow runs; drives PM compliance metrics.';
comment on column public.preventive_maintenance_tasks.unit_asset_id is
  'Originating property asset (AI detection, inspection, or manual registry).';
comment on column public.preventive_maintenance_tasks.workflow_run_id is
  'Workflow run created when the preventive task enters the operations pipeline.';

create index if not exists preventive_maintenance_tasks_landlord_id_idx
  on public.preventive_maintenance_tasks (landlord_id);

create index if not exists preventive_maintenance_tasks_landlord_due_idx
  on public.preventive_maintenance_tasks (landlord_id, due_at);

create index if not exists preventive_maintenance_tasks_landlord_status_idx
  on public.preventive_maintenance_tasks (landlord_id, status);

create index if not exists preventive_maintenance_tasks_workflow_run_id_idx
  on public.preventive_maintenance_tasks (workflow_run_id)
  where workflow_run_id is not null;

alter table public.preventive_maintenance_tasks enable row level security;

create policy preventive_maintenance_tasks_select_authenticated
  on public.preventive_maintenance_tasks
  for select
  to authenticated
  using (true);

-- ---------------------------------------------------------------------------
-- Dashboard view: task list + asset context (single read path for Analytics)
-- ---------------------------------------------------------------------------

create or replace view public.pm_compliance_dashboard_view
with (security_invoker = true)
as
select
  pmt.id as task_id,
  pmt.landlord_id,
  pmt.title,
  pmt.task_kind,
  pmt.due_at,
  pmt.status as task_status,
  pmt.completed_at,
  pmt.assigned_at,
  pmt.assigned_vendor_id,
  pmt.workflow_run_id,
  pmt.unit_asset_id,
  coalesce(
    nullif(trim(pmt.building), ''),
    nullif(trim(ua.building), '')
  ) as building,
  coalesce(
    nullif(trim(pmt.unit_label), ''),
    nullif(trim(ua.unit_label), '')
  ) as unit_label,
  ua.estimated_age_years,
  ua.useful_life_years,
  ua.failure_risk_pct,
  ua.failure_prediction_window,
  ua.replacement_recommended,
  ua.estimated_replacement_cost,
  wr.status as workflow_status,
  wr.current_step as workflow_step
from public.preventive_maintenance_tasks pmt
left join public.unit_assets ua on ua.id = pmt.unit_asset_id
left join public.workflow_runs wr on wr.id = pmt.workflow_run_id
where pmt.status <> 'cancelled';

comment on view public.pm_compliance_dashboard_view is
  'PM compliance task list with asset and workflow context for Analytics dashboard.';
