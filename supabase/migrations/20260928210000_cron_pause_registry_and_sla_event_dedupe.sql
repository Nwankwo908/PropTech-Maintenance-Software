-- Durable pause metadata for required cron jobs + preserve inactive on ensure.
-- Also: collapse duplicate maintenance.sla_expired_needs_vendor graph spam.
-- Also: vendor-availability probe timestamp for dwell (not landlord-choice null rule).

-- ---------------------------------------------------------------------------
-- Probe dwell timestamp (separate from awaiting_landlord_choice_at)
-- ---------------------------------------------------------------------------
alter table public.maintenance_requests
  add column if not exists awaiting_vendor_availability_at timestamptz;

comment on column public.maintenance_requests.awaiting_vendor_availability_at is
  'When vendor_notify_error was set to awaiting vendor availability probe; own dwell timer.';

-- ---------------------------------------------------------------------------
-- Pause / mode columns on ulo_required_cron_jobs
-- ---------------------------------------------------------------------------
alter table public.ulo_required_cron_jobs
  add column if not exists status text not null default 'live'
    check (status in ('live', 'paused', 'dry_run'));

alter table public.ulo_required_cron_jobs
  add column if not exists pause_reason text;

alter table public.ulo_required_cron_jobs
  add column if not exists pause_owner text;

alter table public.ulo_required_cron_jobs
  add column if not exists resume_by timestamptz;

alter table public.ulo_required_cron_jobs
  add column if not exists paused_at timestamptz;

comment on column public.ulo_required_cron_jobs.status is
  'live = must be active in cron.job; paused = intentional inactive; dry_run = scheduled but edge should send nothing.';
comment on column public.ulo_required_cron_jobs.pause_reason is
  'Why the job is paused (human-readable).';
comment on column public.ulo_required_cron_jobs.pause_owner is
  'Who paused it (person or system).';
comment on column public.ulo_required_cron_jobs.resume_by is
  'Target date to re-enable; gap monitor flags when past due while still paused.';

-- Record intentional pause for vendor-delayed-auto-reassign (SMS recipient / dedupe work).
update public.ulo_required_cron_jobs
set
  status = 'paused',
  pause_reason =
    'Paused pending landlord vs staff SMS split, sla_expired_needs_vendor event dedupe, and dry-run review of Demo pending_accept backlog. cron.alter_job active=false alone is not durable across ulo_ensure_required_cron_jobs.',
  pause_owner = 'ops:sms-recipient-followup',
  resume_by = (current_date + interval '7 days')::timestamptz,
  paused_at = now()
where jobname = 'ulo-vendor-delayed-auto-reassign';

-- Also mark other jobs we paused in the same ops review (preserve inactive).
update public.ulo_required_cron_jobs
set
  status = 'paused',
  pause_reason = coalesce(
    pause_reason,
    'Paused during SMS_ADMIN_NOTIFY_PHONES / quiet-hours / landlord-scoping review.'
  ),
  pause_owner = coalesce(pause_owner, 'ops:sms-recipient-followup'),
  resume_by = coalesce(resume_by, (current_date + interval '7 days')::timestamptz),
  paused_at = coalesce(paused_at, now())
where jobname in (
  'ulo-workflow-escalations',
  'ulo-lease-renewals',
  'ulo-vendor-incident-protocols',
  'ulo-vendor-compliance-expiry',
  'ulo-vendor-performance-standards'
)
and status = 'live';

-- Keep cron.job inactive for paused registry rows.
do $$
declare
  rec record;
begin
  for rec in
    select r.jobname, j.jobid
    from public.ulo_required_cron_jobs r
    join cron.job j on j.jobname = r.jobname
    where r.status = 'paused'
  loop
    perform cron.alter_job(rec.jobid, active := false);
  end loop;
exception
  when undefined_table then
    raise notice 'pg_cron not available — pause alter skipped';
  when others then
    raise notice 'Could not alter paused cron jobs: %', SQLERRM;
end;
$$;

-- ---------------------------------------------------------------------------
-- Gap monitor: missing = required live jobs with no active cron row.
-- Paused jobs are returned separately via ulo_paused_required_cron_jobs().
-- ---------------------------------------------------------------------------
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
  where coalesce(r.status, 'live') = 'live'
    and not exists (
      select 1
      from cron.job j
      where j.jobname = r.jobname
        and coalesce(j.active, true)
    )
  order by r.jobname;
$$;

create or replace function public.ulo_paused_required_cron_jobs()
returns table (
  jobname text,
  edge_function text,
  schedule text,
  description text,
  pause_reason text,
  pause_owner text,
  resume_by timestamptz,
  paused_at timestamptz,
  resume_overdue boolean
)
language sql
stable
security definer
set search_path = public, cron
as $$
  select
    r.jobname,
    r.edge_function,
    r.schedule,
    r.description,
    r.pause_reason,
    r.pause_owner,
    r.resume_by,
    r.paused_at,
    (r.resume_by is not null and r.resume_by < now()) as resume_overdue
  from public.ulo_required_cron_jobs r
  where r.status = 'paused'
  order by r.jobname;
$$;

comment on function public.ulo_paused_required_cron_jobs() is
  'Intentionally paused required cron jobs; resume_overdue when past resume_by.';

revoke all on function public.ulo_paused_required_cron_jobs() from public;
grant execute on function public.ulo_paused_required_cron_jobs() to service_role;

-- ---------------------------------------------------------------------------
-- Ensure: preserve paused jobs as inactive; never recreate them as active.
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
  existing_active boolean;
  cmd text;
begin
  for rec in
    select jobname, edge_function, schedule, coalesce(status, 'live') as status
    from public.ulo_required_cron_jobs
    order by jobname
  loop
    select j.jobid, coalesce(j.active, true)
      into existing_job_id, existing_active
    from cron.job j
    where j.jobname = rec.jobname
    limit 1;

    cmd := format(
      $cron$select public.ulo_invoke_edge_function(%L, '{}'::jsonb);$cron$,
      rec.edge_function
    );

    if rec.status = 'paused' then
      -- Keep a cron.job row for visibility, but force inactive.
      if existing_job_id is not null then
        perform cron.alter_job(existing_job_id, schedule := rec.schedule, command := cmd, active := false);
      else
        perform cron.schedule(rec.jobname, rec.schedule, cmd);
        select j.jobid into existing_job_id
        from cron.job j
        where j.jobname = rec.jobname
        limit 1;
        if existing_job_id is not null then
          perform cron.alter_job(existing_job_id, active := false);
        end if;
      end if;
      continue;
    end if;

    -- live / dry_run: ensure active schedule (dry_run handled in edge via body/registry).
    if existing_job_id is not null then
      perform cron.unschedule(existing_job_id);
    end if;
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
  'Schedules required Edge crons. Preserves status=paused rows as inactive (does not re-enable).';

-- ---------------------------------------------------------------------------
-- Dedupe columns on operations_graph_events for repeat automation outcomes
-- ---------------------------------------------------------------------------
alter table public.operations_graph_events
  add column if not exists repeat_count integer not null default 1;

alter table public.operations_graph_events
  add column if not exists last_seen_at timestamptz;

comment on column public.operations_graph_events.repeat_count is
  'How many identical automation outcomes this row represents (sla_expired_needs_vendor dedupe).';
comment on column public.operations_graph_events.last_seen_at is
  'Most recent identical outcome; created_at stays first_seen.';

-- Collapse existing duplicate sla_expired_needs_vendor (+ sibling) rows per ticket.
with ranked as (
  select
    id,
    maintenance_request_id,
    event_type,
    created_at,
    row_number() over (
      partition by maintenance_request_id, event_type
      order by created_at asc, id asc
    ) as rn,
    count(*) over (
      partition by maintenance_request_id, event_type
    ) as total,
    max(created_at) over (
      partition by maintenance_request_id, event_type
    ) as last_seen
  from public.operations_graph_events
  where event_type in (
    'maintenance.sla_expired_needs_vendor',
    'maintenance.vendor_declined_needs_vendor',
    'maintenance.landlord_choice_unanswered',
    'maintenance.auto_reassign_loop_detected'
  )
  and maintenance_request_id is not null
),
keepers as (
  select id, total, last_seen
  from ranked
  where rn = 1 and total > 1
),
dupes as (
  select id
  from ranked
  where rn > 1
)
update public.operations_graph_events e
set
  repeat_count = k.total,
  last_seen_at = k.last_seen,
  metadata = coalesce(e.metadata, '{}'::jsonb) || jsonb_build_object(
    'repeat_count', k.total,
    'last_seen_at', k.last_seen,
    'deduped_from_duplicates', true
  )
from keepers k
where e.id = k.id;

delete from public.operations_graph_events e
using (
  select id
  from (
    select
      id,
      row_number() over (
        partition by maintenance_request_id, event_type
        order by created_at asc, id asc
      ) as rn
    from public.operations_graph_events
    where event_type in (
      'maintenance.sla_expired_needs_vendor',
      'maintenance.vendor_declined_needs_vendor',
      'maintenance.landlord_choice_unanswered',
      'maintenance.auto_reassign_loop_detected'
    )
    and maintenance_request_id is not null
  ) x
  where rn > 1
) d
where e.id = d.id;
