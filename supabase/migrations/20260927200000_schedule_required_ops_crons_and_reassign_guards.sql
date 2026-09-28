-- Required ops crons + auto-reassign stuck-state columns.
--
-- WO-5FA6: vendor-delayed-auto-reassign was deployed but never scheduled in
-- cron.job, so the 48h pending_accept_stale path never ran. This migration:
--   1. Registers every cron-dependent Edge Function in ulo_required_cron_jobs
--   2. Schedules each via pg_cron → ulo_invoke_edge_function
--   3. Exposes ulo_missing_required_cron_jobs() for startup / monitoring checks
--   4. Adds awaiting_landlord_choice_at / landlord_vendor_choice_resolved_at /
--      auto_reassign repeat counters so automation can cool down, dwell-escalate,
--      and detect identical outcome loops
--
-- Vault (same as ulo-ops-sms-crons):
--   project_url + ulo_ops_cron_bearer
-- Edge secrets must accept that bearer (ULO_OPS_CRON_SECRET / ADMIN_REASSIGN_SECRET / …).

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;

-- ---------------------------------------------------------------------------
-- Ticket columns for cool-down / dwell / loop detection
-- ---------------------------------------------------------------------------
alter table public.maintenance_requests
  add column if not exists awaiting_landlord_choice_at timestamptz;

alter table public.maintenance_requests
  add column if not exists landlord_vendor_choice_resolved_at timestamptz;

alter table public.maintenance_requests
  add column if not exists auto_reassign_last_outcome text;

alter table public.maintenance_requests
  add column if not exists auto_reassign_same_outcome_count integer
    not null default 0;

alter table public.maintenance_requests
  add column if not exists auto_reassign_same_outcome_since timestamptz;

comment on column public.maintenance_requests.awaiting_landlord_choice_at is
  'When vendor_notify_error was set to awaiting landlord vendor choice; dwell timer for escalate.';
comment on column public.maintenance_requests.landlord_vendor_choice_resolved_at is
  'When the landlord last answered (or cleared) a vendor choice ask; cool-down for reopen.';
comment on column public.maintenance_requests.auto_reassign_last_outcome is
  'Last auto_reassign outcome signature (outcome|trigger) for loop detection.';
comment on column public.maintenance_requests.auto_reassign_same_outcome_count is
  'Consecutive identical auto_reassign outcomes; alert / escalate when high.';
comment on column public.maintenance_requests.auto_reassign_same_outcome_since is
  'When the current identical-outcome streak started.';

-- Intentionally leave awaiting_landlord_choice_at null on legacy stuck rows.
-- Guard treats null timestamp + flag as dwell-exceeded so the next cron pass
-- escalates (WO-5FA6-style silent loops) instead of waiting another 48h.

-- ---------------------------------------------------------------------------
-- Required cron registry + missing-job check
-- ---------------------------------------------------------------------------
create table if not exists public.ulo_required_cron_jobs (
  jobname text primary key,
  edge_function text not null,
  schedule text not null,
  description text not null
);

comment on table public.ulo_required_cron_jobs is
  'Edge Functions that application logic treats as timed jobs; must have cron.job rows.';

revoke all on table public.ulo_required_cron_jobs from public;
grant select on table public.ulo_required_cron_jobs to authenticated, service_role;

insert into public.ulo_required_cron_jobs (jobname, edge_function, schedule, description)
values
  (
    'ulo-ops-sms-crons',
    'run-ops-sms-crons',
    '10 * * * *',
    'Hourly tenant activation silence/delivery retries and rent reminder cadence'
  ),
  (
    'ulo-vendor-delayed-auto-reassign',
    'vendor-delayed-auto-reassign',
    '25 * * * *',
    'Hourly SLA-expired rematch and 48h pending_accept_stale auto-reassign'
  ),
  (
    'ulo-workflow-escalations',
    'run-workflow-escalations',
    '40 * * * *',
    'Hourly workflow escalation (incl. vendor onboarding 48h silence nudges)'
  ),
  (
    'ulo-vendor-incident-protocols',
    'check-vendor-incident-protocols',
    '*/5 * * * *',
    'Every 5 minutes — vendor no-show T+120 / T+125 rematch'
  ),
  (
    'ulo-schedule-fsm-ttl',
    'check-schedule-fsm-ttl',
    '*/15 * * * *',
    'Every 15 minutes — expire stalled vendor schedule FSM threads'
  ),
  (
    'ulo-vendor-compliance-expiry',
    'check-vendor-compliance-expiry',
    '15 6 * * *',
    'Daily COI/license expiry warnings and auto-suspend'
  ),
  (
    'ulo-vendor-performance-standards',
    'check-vendor-performance-standards',
    '30 6 * * *',
    'Daily vendor performance standards coaching / review'
  ),
  (
    'ulo-lease-renewals',
    'check-lease-renewals',
    '0 7 * * *',
    'Daily lease renewal workflow starts'
  )
on conflict (jobname) do update
set
  edge_function = excluded.edge_function,
  schedule = excluded.schedule,
  description = excluded.description;

create or replace function public.ulo_missing_required_cron_jobs()
returns table (
  jobname text,
  edge_function text,
  schedule text,
  description text
)
language sql
stable
security definer
set search_path = public, cron
as $$
  select r.jobname, r.edge_function, r.schedule, r.description
  from public.ulo_required_cron_jobs r
  where not exists (
    select 1
    from cron.job j
    where j.jobname = r.jobname
      and coalesce(j.active, true)
  )
  order by r.jobname;
$$;

comment on function public.ulo_missing_required_cron_jobs() is
  'Required Edge cron jobs with no active cron.job row (deployed-but-unscheduled gap).';

revoke all on function public.ulo_missing_required_cron_jobs() from public;
grant execute on function public.ulo_missing_required_cron_jobs() to service_role;

-- ---------------------------------------------------------------------------
-- Schedule / refresh each required job
-- ---------------------------------------------------------------------------
create or replace function public.ulo_ensure_required_cron_jobs()
returns void
language plpgsql
security definer
set search_path = public, cron
as $$
declare
  rec record;
  existing_job_id bigint;
  cmd text;
begin
  for rec in
    select jobname, edge_function, schedule
    from public.ulo_required_cron_jobs
    order by jobname
  loop
    select j.jobid into existing_job_id
    from cron.job j
    where j.jobname = rec.jobname
    limit 1;

    if existing_job_id is not null then
      perform cron.unschedule(existing_job_id);
    end if;

    cmd := format(
      $cron$select public.ulo_invoke_edge_function(%L, '{}'::jsonb);$cron$,
      rec.edge_function
    );

    perform cron.schedule(rec.jobname, rec.schedule, cmd);
  end loop;
exception
  when undefined_table then
    raise notice 'pg_cron not available — schedule required ops crons manually';
  when undefined_function then
    raise notice 'ulo_invoke_edge_function missing — run schedule_ops_sms_crons migration first';
  when others then
    raise notice 'Could not ensure required cron jobs: %', SQLERRM;
end;
$$;

comment on function public.ulo_ensure_required_cron_jobs() is
  'Upsert pg_cron schedules for every row in ulo_required_cron_jobs.';

revoke all on function public.ulo_ensure_required_cron_jobs() from public;
grant execute on function public.ulo_ensure_required_cron_jobs() to postgres;

select public.ulo_ensure_required_cron_jobs();
