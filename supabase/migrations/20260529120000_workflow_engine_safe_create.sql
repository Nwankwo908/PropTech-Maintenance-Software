-- Safe, idempotent workflow engine bootstrap.
-- Creates tables/columns/indexes/policies only when missing; never drops data.
-- Seeds workflow_templates via upsert.

-- ---------------------------------------------------------------------------
-- 1. workflow_templates
-- ---------------------------------------------------------------------------

create table if not exists public.workflow_templates (
  id text primary key,
  name text not null,
  type text not null,
  description text not null default '',
  trigger_config jsonb not null default '{}'::jsonb,
  route_config jsonb not null default '{}'::jsonb,
  escalation_config jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

comment on table public.workflow_templates is
  'Registered workflow templates (maintenance, lease renewal, etc.).';
comment on column public.workflow_templates.trigger_config is
  'How runs start (cron windows, channels, entity filters).';
comment on column public.workflow_templates.route_config is
  'Classify, route, act, and log pipeline configuration.';
comment on column public.workflow_templates.escalation_config is
  'Escalation and timeout rules.';

-- Backfill columns when an older workflow_templates shape already exists.
alter table public.workflow_templates
  add column if not exists type text;
alter table public.workflow_templates
  add column if not exists description text not null default '';
alter table public.workflow_templates
  add column if not exists trigger_config jsonb not null default '{}'::jsonb;
alter table public.workflow_templates
  add column if not exists route_config jsonb not null default '{}'::jsonb;
alter table public.workflow_templates
  add column if not exists escalation_config jsonb not null default '{}'::jsonb;
alter table public.workflow_templates
  add column if not exists active boolean not null default true;
alter table public.workflow_templates
  add column if not exists created_at timestamptz not null default now();

update public.workflow_templates
set type = coalesce(nullif(trim(type), ''), 'other')
where type is null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'workflow_templates_type_check'
      and conrelid = 'public.workflow_templates'::regclass
  ) then
    alter table public.workflow_templates
      add constraint workflow_templates_type_check
      check (type in ('maintenance', 'leasing', 'identity', 'vendor', 'operations', 'other'));
  end if;
end $$;

create index if not exists workflow_templates_type_idx
  on public.workflow_templates (type);

create index if not exists workflow_templates_active_idx
  on public.workflow_templates (active)
  where active = true;

alter table public.workflow_templates enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'workflow_templates'
      and policyname = 'workflow_templates_select_staff'
  ) then
    create policy workflow_templates_select_staff
      on public.workflow_templates
      for select
      to authenticated
      using (public.is_staff_admin());
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. workflow_runs
-- ---------------------------------------------------------------------------

create table if not exists public.workflow_runs (
  id uuid primary key default gen_random_uuid(),
  template_id text not null references public.workflow_templates (id),
  status text not null default 'active',
  entity_type text,
  entity_id uuid,
  property_id uuid,
  unit_id uuid references public.units (id) on delete set null,
  resident_id uuid references public.users (id) on delete set null,
  current_step text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb
);

comment on table public.workflow_runs is
  'Workflow instances linked to property graph entities.';
comment on column public.workflow_runs.entity_type is
  'Polymorphic target: maintenance_request, sms_conversation, user, unit, etc.';
comment on column public.workflow_runs.entity_id is
  'UUID of the entity_type row.';
comment on column public.workflow_runs.metadata is
  'Template-specific run state.';

alter table public.workflow_runs
  add column if not exists entity_type text;
alter table public.workflow_runs
  add column if not exists entity_id uuid;
alter table public.workflow_runs
  add column if not exists property_id uuid;
alter table public.workflow_runs
  add column if not exists unit_id uuid;
alter table public.workflow_runs
  add column if not exists resident_id uuid;
alter table public.workflow_runs
  add column if not exists current_step text;
alter table public.workflow_runs
  add column if not exists started_at timestamptz not null default now();
alter table public.workflow_runs
  add column if not exists completed_at timestamptz;
alter table public.workflow_runs
  add column if not exists metadata jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'workflow_runs_status_check'
      and conrelid = 'public.workflow_runs'::regclass
  ) then
    alter table public.workflow_runs
      add constraint workflow_runs_status_check
      check (status in ('active', 'completed', 'escalated', 'cancelled'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'workflow_runs_entity_pair_check'
      and conrelid = 'public.workflow_runs'::regclass
  ) then
    alter table public.workflow_runs
      add constraint workflow_runs_entity_pair_check
      check (
        (entity_type is null and entity_id is null)
        or (entity_type is not null and entity_id is not null)
      );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'workflow_runs_unit_id_fkey'
      and conrelid = 'public.workflow_runs'::regclass
  ) then
    alter table public.workflow_runs
      add constraint workflow_runs_unit_id_fkey
      foreign key (unit_id) references public.units (id) on delete set null;
  end if;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'workflow_runs_resident_id_fkey'
      and conrelid = 'public.workflow_runs'::regclass
  ) then
    alter table public.workflow_runs
      add constraint workflow_runs_resident_id_fkey
      foreign key (resident_id) references public.users (id) on delete set null;
  end if;
exception
  when duplicate_object then null;
end $$;

create index if not exists workflow_runs_template_id_idx
  on public.workflow_runs (template_id);

create index if not exists workflow_runs_status_idx
  on public.workflow_runs (status)
  where status = 'active';

create index if not exists workflow_runs_entity_idx
  on public.workflow_runs (entity_type, entity_id)
  where entity_type is not null;

create index if not exists workflow_runs_resident_id_idx
  on public.workflow_runs (resident_id)
  where resident_id is not null;

create index if not exists workflow_runs_unit_id_idx
  on public.workflow_runs (unit_id)
  where unit_id is not null;

create index if not exists workflow_runs_started_at_idx
  on public.workflow_runs (started_at desc);

alter table public.workflow_runs enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'workflow_runs'
      and policyname = 'workflow_runs_select_staff'
  ) then
    create policy workflow_runs_select_staff
      on public.workflow_runs
      for select
      to authenticated
      using (public.is_staff_admin());
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. workflow_events
-- ---------------------------------------------------------------------------

create table if not exists public.workflow_events (
  id uuid primary key default gen_random_uuid(),
  workflow_run_id uuid not null references public.workflow_runs (id) on delete cascade,
  event_type text not null,
  step text,
  actor_type text,
  actor_id uuid,
  message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

comment on table public.workflow_events is
  'Append-only workflow pipeline and domain events for a single run.';

alter table public.workflow_events
  add column if not exists step text;
alter table public.workflow_events
  add column if not exists actor_type text;
alter table public.workflow_events
  add column if not exists actor_id uuid;
alter table public.workflow_events
  add column if not exists message text;
alter table public.workflow_events
  add column if not exists metadata jsonb not null default '{}'::jsonb;
alter table public.workflow_events
  add column if not exists created_at timestamptz not null default now();

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'workflow_events_actor_type_check'
      and conrelid = 'public.workflow_events'::regclass
  ) then
    alter table public.workflow_events
      add constraint workflow_events_actor_type_check
      check (
        actor_type is null
        or actor_type in ('resident', 'vendor', 'landlord', 'system')
      );
  end if;
end $$;

create index if not exists workflow_events_workflow_run_id_idx
  on public.workflow_events (workflow_run_id);

create index if not exists workflow_events_event_type_idx
  on public.workflow_events (event_type);

create index if not exists workflow_events_created_at_idx
  on public.workflow_events (created_at desc);

create index if not exists workflow_events_run_created_idx
  on public.workflow_events (workflow_run_id, created_at desc);

alter table public.workflow_events enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'workflow_events'
      and policyname = 'workflow_events_select_staff'
  ) then
    create policy workflow_events_select_staff
      on public.workflow_events
      for select
      to authenticated
      using (public.is_staff_admin());
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Link SMS conversations + operations graph
-- ---------------------------------------------------------------------------

alter table public.sms_conversations
  add column if not exists workflow_run_id uuid;

alter table public.sms_conversations
  add column if not exists workflow_template_id text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'sms_conversations_workflow_run_id_fkey'
  ) then
    alter table public.sms_conversations
      add constraint sms_conversations_workflow_run_id_fkey
      foreign key (workflow_run_id) references public.workflow_runs (id) on delete set null;
  end if;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'sms_conversations_workflow_template_id_fkey'
  ) then
    alter table public.sms_conversations
      add constraint sms_conversations_workflow_template_id_fkey
      foreign key (workflow_template_id) references public.workflow_templates (id);
  end if;
exception
  when duplicate_object then null;
end $$;

comment on column public.sms_conversations.workflow_run_id is
  'Active workflow run driving this conversation.';

alter table public.operations_graph_events
  add column if not exists workflow_run_id uuid;

alter table public.operations_graph_events
  add column if not exists workflow_template_id text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'operations_graph_events_workflow_run_id_fkey'
  ) then
    alter table public.operations_graph_events
      add constraint operations_graph_events_workflow_run_id_fkey
      foreign key (workflow_run_id) references public.workflow_runs (id) on delete set null;
  end if;
exception
  when duplicate_object then null;
end $$;

create index if not exists operations_graph_events_workflow_run_id_idx
  on public.operations_graph_events (workflow_run_id)
  where workflow_run_id is not null;

create index if not exists operations_graph_events_workflow_template_id_idx
  on public.operations_graph_events (workflow_template_id)
  where workflow_template_id is not null;

-- ---------------------------------------------------------------------------
-- 5. Seed / upsert workflow templates
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
    'maintenance_request',
    'Maintenance Request',
    'maintenance',
    'End-to-end maintenance: resident submission, AI classification, vendor assignment, job lifecycle, escalation, and audit log.',
    jsonb_build_object(
      'type', 'resident_submission',
      'triggers', jsonb_build_array('dashboard', 'sms_inbound', 'webhook'),
      'channels', jsonb_build_array('web_form', 'sms'),
      'description', 'Resident submits maintenance issue'
    ),
    jsonb_build_object(
      'handler', 'maintenance_request',
      'domain', 'maintenance',
      'classify', jsonb_build_object(
        'workflow', 'maintenance',
        'label', 'AI categorizes issue as plumbing, electrical, appliance, general, etc.',
        'provider', 'classify_issue_sla',
        'fallback', 'rule_based_intake',
        'categories', jsonb_build_array(
          'plumbing', 'electrical', 'appliance', 'HVAC', 'leak', 'pest', 'lock', 'general', 'other'
        )
      ),
      'route', jsonb_build_object(
        'action', 'assign_vendor',
        'handler', 'assignVendorAndNotify',
        'matcher', 'issue_category',
        'label', 'Assign to best vendor'
      ),
      'act', jsonb_build_object(
        'action', 'vendor_lifecycle',
        'label', 'Vendor accepts, updates status, completes job',
        'statuses', jsonb_build_array(
          'unassigned', 'pending_accept', 'accepted', 'in_progress', 'completed', 'declined'
        ),
        'handlers', jsonb_build_array(
          'vendor_workflow', 'vendor-respond', 'vendor-update-job-status'
        )
      ),
      'log', jsonb_build_object(
        'action', 'store_status_and_notifications',
        'label', 'Store all status changes and notifications in workflow_events',
        'tables', jsonb_build_array(
          'workflow_events', 'vendor_status_events', 'resident_notification_log', 'operations_graph_events'
        )
      )
    ),
    jsonb_build_object(
      'on_vendor_decline', jsonb_build_object(
        'action', 'auto_reassign',
        'handler', 'tryAutoReassignAfterDecline',
        'label', 'Vendor declines → reassign to next vendor'
      ),
      'on_sla_expired', jsonb_build_object(
        'action', 'notify_admin',
        'field', 'due_at',
        'label', 'SLA expires → notify admin'
      ),
      'on_vendor_no_response_hours', 48,
      'on_vendor_no_response', jsonb_build_object(
        'action', 'reassign',
        'handler', 'vendor-delayed-auto-reassign',
        'label', 'No vendor response → reassign'
      ),
      'label', 'If vendor declines or SLA expires, notify admin or reassign'
    ),
    true
  ),
  (
    'maintenance_intake',
    'Maintenance Request',
    'maintenance',
    'SMS/web intake step for maintenance_request workflow (collects issue before ticket creation).',
    jsonb_build_object(
      'type', 'resident_submission',
      'triggers', jsonb_build_array('sms_inbound', 'dashboard', 'webhook'),
      'channels', jsonb_build_array('sms', 'web_form'),
      'parent_template', 'maintenance_request',
      'description', 'Resident submits maintenance issue'
    ),
    jsonb_build_object(
      'handler', 'maintenance_intake',
      'parent_template', 'maintenance_request',
      'domain', 'maintenance',
      'classify', jsonb_build_object(
        'workflow', 'maintenance',
        'label', 'AI categorizes issue as plumbing, electrical, appliance, general, etc.',
        'provider', 'classify_issue_sla',
        'fallback', 'rule_based_intake',
        'categories', jsonb_build_array(
          'plumbing', 'electrical', 'appliance', 'HVAC', 'leak', 'pest', 'lock', 'general', 'other'
        )
      ),
      'route', jsonb_build_object(
        'action', 'collect_intake',
        'handler', 'processResidentMaintenanceIntake',
        'label', 'Collect issue details via SMS wizard'
      ),
      'act', jsonb_build_object(
        'action', 'submit_ticket',
        'handler', 'submitSmsMaintenanceRequest',
        'label', 'Create ticket and start vendor lifecycle'
      ),
      'log', jsonb_build_object(
        'action', 'store_status_and_notifications',
        'label', 'Store all status changes and notifications in workflow_events',
        'tables', jsonb_build_array(
          'workflow_events', 'vendor_status_events', 'resident_notification_log', 'operations_graph_events'
        )
      )
    ),
    jsonb_build_object(
      'on_vendor_decline', jsonb_build_object(
        'action', 'auto_reassign',
        'handler', 'tryAutoReassignAfterDecline'
      ),
      'on_sla_expired', jsonb_build_object(
        'action', 'notify_admin',
        'field', 'due_at'
      ),
      'on_vendor_no_response_hours', 48,
      'on_vendor_no_response', jsonb_build_object(
        'action', 'reassign',
        'handler', 'vendor-delayed-auto-reassign'
      ),
      'label', 'If vendor declines or SLA expires, notify admin or reassign'
    ),
    true
  ),
  (
    'lease_renewal',
    'Lease Renewal',
    'leasing',
    'Proactive lease renewal: offer before expiry, collect signature, escalate if no response.',
    jsonb_build_object(
      'type', 'lease_expiry',
      'days_before_expiry', 60,
      'triggers', jsonb_build_array('cron'),
      'description', 'Lease expires in 60 days'
    ),
    jsonb_build_object(
      'handler', 'lease_renewal',
      'domain', 'leasing',
      'classify', jsonb_build_object(
        'workflow', 'renewal',
        'label', 'Renewal workflow'
      ),
      'route', jsonb_build_object(
        'action', 'send_renewal_offer',
        'channels', jsonb_build_array('sms', 'email'),
        'label', 'Send renewal offer to tenant'
      ),
      'act', jsonb_build_object(
        'action', 'collect_signature',
        'label', 'Collect signature'
      ),
      'log', jsonb_build_object(
        'action', 'store_renewal_outcome',
        'label', 'Store renewal outcome'
      )
    ),
    jsonb_build_object(
      'no_response_days', 7,
      'action', 'notify_landlord',
      'label', 'No response after 7 days → notify landlord'
    ),
    true
  ),
  (
    'vendor_job_response',
    'Vendor job response',
    'vendor',
    'Vendor accept/decline on assigned maintenance jobs.',
    jsonb_build_object(
      'type', 'vendor_reply',
      'triggers', jsonb_build_array('sms_inbound', 'vendor_portal', 'webhook')
    ),
    jsonb_build_object(
      'handler', 'vendor_job_response',
      'domain', 'maintenance',
      'classify', jsonb_build_object('workflow', 'vendor_response'),
      'route', jsonb_build_object(
        'action', 'parse_vendor_reply',
        'handler', 'applyVendorStatusTransition'
      ),
      'act', jsonb_build_object(
        'action', 'update_job_status',
        'statuses', jsonb_build_array('pending_accept', 'accepted', 'declined', 'in_progress', 'completed')
      ),
      'log', jsonb_build_object(
        'action', 'store_status_and_notifications',
        'tables', jsonb_build_array('workflow_events', 'vendor_status_events', 'operations_graph_events')
      )
    ),
    '{}'::jsonb,
    true
  ),
  (
    'identity_onboarding',
    'Identity onboarding',
    'identity',
    'Unknown sender unit matching and identity linking.',
    jsonb_build_object(
      'type', 'unknown_sender',
      'triggers', jsonb_build_array('sms_inbound')
    ),
    jsonb_build_object(
      'handler', 'identity_onboarding',
      'domain', 'identity',
      'route', jsonb_build_object(
        'action', 'resolve_unit_and_identity',
        'handler', 'resolvePhoneIdentity'
      ),
      'log', jsonb_build_object(
        'action', 'store_status_and_notifications',
        'tables', jsonb_build_array('workflow_events', 'operations_graph_events')
      )
    ),
    '{}'::jsonb,
    true
  ),
  (
    'landlord_command',
    'Landlord command',
    'operations',
    'Landlord SMS commands (future intents).',
    jsonb_build_object(
      'type', 'landlord_sms',
      'triggers', jsonb_build_array('sms_inbound')
    ),
    jsonb_build_object(
      'handler', 'landlord_command',
      'domain', 'operations'
    ),
    '{}'::jsonb,
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
