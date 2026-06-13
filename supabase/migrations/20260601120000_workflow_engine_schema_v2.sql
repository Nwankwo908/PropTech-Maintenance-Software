-- Property operations workflow engine schema v2.
-- Adds first-class run columns (landlord_id, trigger_type, workflow_type, current_stage,
-- created_at, updated_at) and a reusable ledger_events table for rent + future billing flows.
-- Idempotent: safe to re-run; never drops data.

-- ---------------------------------------------------------------------------
-- 1. workflow_runs — canonical run columns
-- ---------------------------------------------------------------------------

alter table public.workflow_runs
  add column if not exists landlord_id uuid;

alter table public.workflow_runs
  add column if not exists trigger_type text;

alter table public.workflow_runs
  add column if not exists workflow_type text;

alter table public.workflow_runs
  add column if not exists current_stage text;

alter table public.workflow_runs
  add column if not exists created_at timestamptz not null default now();

alter table public.workflow_runs
  add column if not exists updated_at timestamptz not null default now();

comment on column public.workflow_runs.landlord_id is
  'Tenant scope for the workflow run (matches DEFAULT_LANDLORD_ID / sms_numbers.landlord_id).';
comment on column public.workflow_runs.trigger_type is
  'How the run started: sms_inbound, cron, dashboard, webhook, vendor_portal, automation.';
comment on column public.workflow_runs.workflow_type is
  'Workflow template key (mirrors template_id), e.g. rent_collection, lease_renewal.';
comment on column public.workflow_runs.current_stage is
  'Pipeline stage (trigger|classify|route|act|escalate|log) or domain step (awaiting_response, etc.).';

-- Backfill from existing columns / metadata.
update public.workflow_runs
set
  landlord_id = coalesce(
    landlord_id,
    nullif(trim(metadata->>'landlord_id'), '')::uuid
  ),
  trigger_type = coalesce(
    nullif(trim(trigger_type), ''),
    nullif(trim(metadata->>'trigger_type'), '')
  ),
  workflow_type = coalesce(
    nullif(trim(workflow_type), ''),
    nullif(trim(template_id), '')
  ),
  current_stage = coalesce(
    nullif(trim(current_stage), ''),
    nullif(trim(current_step), '')
  ),
  created_at = coalesce(created_at, started_at, now()),
  updated_at = coalesce(updated_at, completed_at, started_at, now())
where
  landlord_id is null
  or trigger_type is null
  or workflow_type is null
  or current_stage is null
  or created_at is null
  or updated_at is null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'workflow_runs_trigger_type_check'
      and conrelid = 'public.workflow_runs'::regclass
  ) then
    alter table public.workflow_runs
      add constraint workflow_runs_trigger_type_check
      check (
        trigger_type is null
        or trigger_type in (
          'sms_inbound', 'cron', 'dashboard', 'webhook', 'vendor_portal', 'automation'
        )
      );
  end if;
end $$;

create index if not exists workflow_runs_landlord_id_idx
  on public.workflow_runs (landlord_id)
  where landlord_id is not null;

create index if not exists workflow_runs_workflow_type_idx
  on public.workflow_runs (workflow_type);

create index if not exists workflow_runs_trigger_type_idx
  on public.workflow_runs (trigger_type)
  where trigger_type is not null;

create index if not exists workflow_runs_landlord_status_idx
  on public.workflow_runs (landlord_id, status)
  where landlord_id is not null;

create index if not exists workflow_runs_created_at_idx
  on public.workflow_runs (created_at desc);

create index if not exists workflow_runs_updated_at_idx
  on public.workflow_runs (updated_at desc);

create or replace function public.set_workflow_runs_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists workflow_runs_set_updated_at on public.workflow_runs;

create trigger workflow_runs_set_updated_at
  before update on public.workflow_runs
  for each row
  execute function public.set_workflow_runs_updated_at();

-- Keep current_step in sync when only current_stage is written (compat view for legacy readers).
create or replace function public.sync_workflow_run_step_columns()
returns trigger
language plpgsql
as $$
begin
  if new.current_stage is distinct from old.current_stage
     and (new.current_step is null or new.current_step = old.current_step) then
    new.current_step = new.current_stage;
  elsif new.current_step is distinct from old.current_step
        and (new.current_stage is null or new.current_stage = old.current_stage) then
    new.current_stage = new.current_step;
  end if;
  return new;
end;
$$;

drop trigger if exists workflow_runs_sync_step_columns on public.workflow_runs;

create trigger workflow_runs_sync_step_columns
  before insert or update on public.workflow_runs
  for each row
  execute function public.sync_workflow_run_step_columns();

-- ---------------------------------------------------------------------------
-- 2. workflow_templates — updated_at
-- ---------------------------------------------------------------------------

alter table public.workflow_templates
  add column if not exists updated_at timestamptz not null default now();

update public.workflow_templates
set updated_at = coalesce(updated_at, created_at, now())
where updated_at is null;

create or replace function public.set_workflow_templates_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists workflow_templates_set_updated_at on public.workflow_templates;

create trigger workflow_templates_set_updated_at
  before update on public.workflow_templates
  for each row
  execute function public.set_workflow_templates_updated_at();

-- ---------------------------------------------------------------------------
-- 3. workflow_events — optional pipeline stage + landlord scope
-- ---------------------------------------------------------------------------

alter table public.workflow_events
  add column if not exists stage text;

alter table public.workflow_events
  add column if not exists landlord_id uuid;

alter table public.workflow_events
  add column if not exists workflow_type text;

comment on column public.workflow_events.stage is
  'Pipeline stage when event_type is workflow.{stage}.';

update public.workflow_events e
set
  stage = coalesce(
    e.stage,
    case
      when e.event_type like 'workflow.%' then substring(e.event_type from 10)
      else null
    end
  ),
  landlord_id = coalesce(
    e.landlord_id,
    nullif(trim(r.metadata->>'landlord_id'), '')::uuid
  ),
  workflow_type = coalesce(
    e.workflow_type,
    r.workflow_type,
    r.template_id
  )
from public.workflow_runs r
where e.workflow_run_id = r.id
  and (
    e.stage is null
    or e.landlord_id is null
    or e.workflow_type is null
  );

create index if not exists workflow_events_landlord_id_idx
  on public.workflow_events (landlord_id)
  where landlord_id is not null;

create index if not exists workflow_events_workflow_type_idx
  on public.workflow_events (workflow_type)
  where workflow_type is not null;

-- ---------------------------------------------------------------------------
-- 4. ledger_events — reusable property operations ledger (rent, fees, credits)
-- ---------------------------------------------------------------------------

create table if not exists public.ledger_events (
  id uuid primary key default gen_random_uuid(),
  landlord_id uuid not null,
  workflow_run_id uuid references public.workflow_runs (id) on delete set null,
  workflow_type text,
  resident_id uuid references public.users (id) on delete set null,
  unit_id uuid references public.units (id) on delete set null,
  property_id uuid,
  event_type text not null,
  direction text not null default 'debit',
  amount numeric(12, 2),
  currency text not null default 'USD',
  billing_period text,
  description text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

comment on table public.ledger_events is
  'Append-only property operations ledger (rent due, payments, adjustments). Links to workflow runs when applicable.';
comment on column public.ledger_events.event_type is
  'Domain event: rent_due, rent_payment_reported, rent_payment_confirmed, fee, credit, adjustment, etc.';
comment on column public.ledger_events.direction is
  'debit increases amount owed; credit reduces amount owed.';
comment on column public.ledger_events.billing_period is
  'Billing period key (YYYY-MM) for recurring charges.';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'ledger_events_direction_check'
      and conrelid = 'public.ledger_events'::regclass
  ) then
    alter table public.ledger_events
      add constraint ledger_events_direction_check
      check (direction in ('debit', 'credit'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'ledger_events_amount_nonneg_check'
      and conrelid = 'public.ledger_events'::regclass
  ) then
    alter table public.ledger_events
      add constraint ledger_events_amount_nonneg_check
      check (amount is null or amount >= 0);
  end if;
exception
  when others then null;
end $$;

create index if not exists ledger_events_landlord_id_idx
  on public.ledger_events (landlord_id);

create index if not exists ledger_events_workflow_run_id_idx
  on public.ledger_events (workflow_run_id)
  where workflow_run_id is not null;

create index if not exists ledger_events_resident_id_idx
  on public.ledger_events (resident_id)
  where resident_id is not null;

create index if not exists ledger_events_unit_id_idx
  on public.ledger_events (unit_id)
  where unit_id is not null;

create index if not exists ledger_events_event_type_idx
  on public.ledger_events (event_type);

create index if not exists ledger_events_billing_period_idx
  on public.ledger_events (billing_period)
  where billing_period is not null;

create index if not exists ledger_events_created_at_idx
  on public.ledger_events (created_at desc);

create index if not exists ledger_events_landlord_period_idx
  on public.ledger_events (landlord_id, billing_period)
  where billing_period is not null;

alter table public.ledger_events enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'ledger_events'
      and policyname = 'ledger_events_select_staff'
  ) then
    create policy ledger_events_select_staff
      on public.ledger_events
      for select
      to authenticated
      using (public.is_staff_admin());
  end if;
end $$;

-- Realtime for admin dashboards (optional; no-op if publication missing).
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1
       from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'ledger_events'
     )
  then
    execute 'alter publication supabase_realtime add table public.ledger_events';
  end if;
end $$;
