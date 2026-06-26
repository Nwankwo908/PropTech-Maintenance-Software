-- Vendor resident feedback + composite vendor score (operational metrics + reviews).
-- Rework window defaults to 30 days (override via vendor_scoring_settings per landlord).

-- Align vendor_status_events timestamp column with intelligence views (hosted may differ).
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'vendor_status_events'
      and column_name = 'at'
  ) then
    alter table public.vendor_status_events rename column at to created_at;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Configurable rework window (per landlord; falls back to 30 days)
-- ---------------------------------------------------------------------------

create table if not exists public.vendor_scoring_settings (
  landlord_id uuid primary key,
  rework_window_days int not null default 30
    constraint vendor_scoring_settings_rework_window_days_check
      check (rework_window_days between 1 and 365),
  updated_at timestamptz not null default now()
);

comment on table public.vendor_scoring_settings is
  'Per-landlord vendor score tuning. rework_window_days controls rework/reopen detection.';

alter table public.vendor_scoring_settings enable row level security;

create policy vendor_scoring_settings_select_staff
  on public.vendor_scoring_settings
  for select
  to authenticated
  using (public.is_staff_admin());

create policy vendor_scoring_settings_write_staff
  on public.vendor_scoring_settings
  for all
  to authenticated
  using (public.is_staff_admin())
  with check (public.is_staff_admin());

create or replace function public.vendor_rework_window_days(p_landlord_id uuid)
returns int
language sql
stable
as $$
  select coalesce(
    (
      select s.rework_window_days
      from public.vendor_scoring_settings s
      where s.landlord_id = p_landlord_id
    ),
    30
  );
$$;

comment on function public.vendor_rework_window_days(uuid) is
  'Rework detection window in days for vendor score (default 30).';

-- ---------------------------------------------------------------------------
-- Resident feedback (post-completion SMS survey)
-- ---------------------------------------------------------------------------

create table if not exists public.vendor_feedback (
  id uuid primary key default gen_random_uuid(),
  landlord_id uuid not null,
  vendor_id uuid not null references public.vendors (id) on delete cascade,
  maintenance_request_id uuid not null references public.maintenance_requests (id) on delete cascade,
  resident_id uuid references public.users (id) on delete set null,
  rating smallint
    constraint vendor_feedback_rating_check
      check (rating is null or rating between 1 and 5),
  comment text,
  submitted_at timestamptz not null default now(),
  constraint vendor_feedback_maintenance_request_id_key unique (maintenance_request_id)
);

comment on table public.vendor_feedback is
  'Resident satisfaction after completed maintenance (1–5 + optional comment).';

create index if not exists vendor_feedback_vendor_id_idx
  on public.vendor_feedback (vendor_id);

create index if not exists vendor_feedback_landlord_id_idx
  on public.vendor_feedback (landlord_id);

alter table public.vendor_feedback enable row level security;

create policy vendor_feedback_select_staff
  on public.vendor_feedback
  for select
  to authenticated
  using (public.is_staff_admin());

-- ---------------------------------------------------------------------------
-- Active SMS feedback conversation state (rating → optional comment follow-up)
-- ---------------------------------------------------------------------------

create table if not exists public.vendor_feedback_requests (
  id uuid primary key default gen_random_uuid(),
  landlord_id uuid not null,
  vendor_id uuid not null references public.vendors (id) on delete cascade,
  maintenance_request_id uuid not null references public.maintenance_requests (id) on delete cascade,
  resident_id uuid references public.users (id) on delete set null,
  conversation_id uuid references public.sms_conversations (id) on delete set null,
  feedback_id uuid references public.vendor_feedback (id) on delete set null,
  phase text not null default 'rating'
    constraint vendor_feedback_requests_phase_check
      check (phase in ('rating', 'comment')),
  status text not null default 'open'
    constraint vendor_feedback_requests_status_check
      check (status in ('open', 'completed', 'expired')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days'),
  completed_at timestamptz,
  constraint vendor_feedback_requests_maintenance_request_id_key unique (maintenance_request_id)
);

comment on table public.vendor_feedback_requests is
  'Tracks in-flight resident SMS vendor-rating conversations.';

create index if not exists vendor_feedback_requests_open_idx
  on public.vendor_feedback_requests (landlord_id, status, phase)
  where status = 'open';

create index if not exists vendor_feedback_requests_conversation_idx
  on public.vendor_feedback_requests (conversation_id)
  where conversation_id is not null;

alter table public.vendor_feedback_requests enable row level security;

create policy vendor_feedback_requests_select_staff
  on public.vendor_feedback_requests
  for select
  to authenticated
  using (public.is_staff_admin());

-- ---------------------------------------------------------------------------
-- Operational metrics per vendor (completion, response, rework)
-- ---------------------------------------------------------------------------

create or replace view public.vendor_operational_metrics
with (security_invoker = true)
as
with vendor_jobs as (
  select
    mre.assigned_vendor_id as vendor_id,
    mre.landlord_id,
    mre.id as ticket_id,
    coalesce(mr.vendor_notified_at, mre.assigned_at, mre.created_at) as notified_at,
    mre.vendor_work_status,
    mre.unit_id,
    mre.issue_category
  from public.maintenance_request_enriched mre
  join public.maintenance_requests mr
    on mr.id = mre.id
  where mre.assigned_vendor_id is not null
    and mre.landlord_id is not null
),
vendor_timing as (
  select
    vj.vendor_id,
    vj.landlord_id,
    vj.ticket_id,
    vj.notified_at,
    vj.vendor_work_status,
    vj.unit_id,
    vj.issue_category,
    bool_or(vse.to_status = 'accepted') as was_accepted,
    bool_or(vse.to_status = 'declined') as was_declined,
    min(vse.created_at) filter (where vse.to_status in ('accepted', 'declined')) as first_response_at,
    min(vse.created_at) filter (where vse.to_status = 'completed') as completed_at
  from vendor_jobs vj
  left join public.vendor_status_events vse
    on vse.ticket_id = vj.ticket_id
  group by
    vj.vendor_id,
    vj.landlord_id,
    vj.ticket_id,
    vj.notified_at,
    vj.vendor_work_status,
    vj.unit_id,
    vj.issue_category
),
rework_flags as (
  select
    vt.vendor_id,
    vt.landlord_id,
    vt.ticket_id,
    exists (
      select 1
      from public.maintenance_request_enriched follow
      where vt.vendor_work_status = 'completed'
        and vt.completed_at is not null
        and follow.id <> vt.ticket_id
        and follow.unit_id is not null
        and follow.unit_id = vt.unit_id
        and coalesce(follow.issue_category, '') = coalesce(vt.issue_category, '')
        and follow.created_at > vt.completed_at
        and follow.created_at <= vt.completed_at
          + make_interval(
            days => public.vendor_rework_window_days(vt.landlord_id)
          )
    ) as is_rework
  from vendor_timing vt
)
select
  vt.vendor_id,
  vt.landlord_id,
  count(distinct vt.ticket_id) filter (where vt.was_accepted)::bigint as accepted_jobs,
  count(distinct vt.ticket_id) filter (
    where vt.vendor_work_status = 'completed'
  )::bigint as completed_jobs,
  round(
    count(distinct vt.ticket_id) filter (
      where vt.vendor_work_status = 'completed'
    )::numeric
      / nullif(
        count(distinct vt.ticket_id) filter (where vt.was_accepted),
        0
      ),
    4
  ) as completion_rate,
  round(
    avg(
      extract(epoch from (vt.first_response_at - vt.notified_at)) / 60.0
    ) filter (where vt.first_response_at is not null),
    2
  ) as avg_response_time,
  round(
    count(distinct rf.ticket_id) filter (where rf.is_rework)::numeric
      / nullif(
        count(distinct vt.ticket_id) filter (
          where vt.vendor_work_status = 'completed'
        ),
        0
      ),
    4
  ) as rework_rate,
  public.vendor_rework_window_days(vt.landlord_id) as rework_window_days
from vendor_timing vt
left join rework_flags rf
  on rf.vendor_id = vt.vendor_id
 and rf.ticket_id = vt.ticket_id
group by vt.vendor_id, vt.landlord_id;

comment on view public.vendor_operational_metrics is
  'Vendor operational KPIs: completion_rate and rework_rate are 0–1 fractions; avg_response_time is minutes.';

-- ---------------------------------------------------------------------------
-- Composite vendor score (0–5) for dashboards + future assignment ranking
-- ---------------------------------------------------------------------------

create or replace view public.vendor_score_view
with (security_invoker = true)
as
with feedback_agg as (
  select
    vf.vendor_id,
    vf.landlord_id,
    count(*) filter (where vf.rating is not null)::bigint as review_count,
    round(avg(vf.rating) filter (where vf.rating is not null), 2) as resident_satisfaction
  from public.vendor_feedback vf
  group by vf.vendor_id, vf.landlord_id
),
component_scores as (
  select
    v.id as vendor_id,
    v.landlord_id,
    coalesce(fa.review_count, 0)::bigint as review_count,
    fa.resident_satisfaction,
    om.accepted_jobs,
    om.completed_jobs,
    om.completion_rate,
    om.avg_response_time,
    om.rework_rate,
    om.rework_window_days,
    case
      when om.avg_response_time is null then null
      when om.avg_response_time <= 15 then 5.0
      when om.avg_response_time <= 60 then 4.0
      when om.avg_response_time <= 240 then 3.0
      when om.avg_response_time <= 1440 then 2.0
      else 1.0
    end as response_speed_score,
    case
      when om.completion_rate is null then null
      else least(5.0, greatest(0.0, om.completion_rate * 5.0))
    end as completion_score,
    case
      when om.rework_rate is null then null
      else least(5.0, greatest(0.0, (1.0 - om.rework_rate) * 5.0))
    end as rework_score
  from public.vendors v
  left join feedback_agg fa
    on fa.vendor_id = v.id
   and fa.landlord_id = v.landlord_id
  left join public.vendor_operational_metrics om
    on om.vendor_id = v.id
   and om.landlord_id = v.landlord_id
)
select
  cs.*,
  round(
    (
      case when cs.review_count > 0 then 0.40 * cs.resident_satisfaction else 0 end
      + case when cs.completion_score is not null then 0.25 * cs.completion_score else 0 end
      + case when cs.response_speed_score is not null then 0.20 * cs.response_speed_score else 0 end
      + case when cs.rework_score is not null then 0.15 * cs.rework_score else 0 end
    )
    / nullif(
      (case when cs.review_count > 0 then 0.40 else 0 end)
      + (case when cs.completion_score is not null then 0.25 else 0 end)
      + (case when cs.response_speed_score is not null then 0.20 else 0 end)
      + (case when cs.rework_score is not null then 0.15 else 0 end),
      0
    ),
    1
  ) as vendor_score
from component_scores cs;

comment on view public.vendor_score_view is
  'Composite vendor score 0–5: 40% resident feedback, 25% completion, 20% response speed, 15% rework. '
  'Weights renormalize when feedback or operational signals are missing.';

grant select on public.vendor_operational_metrics to authenticated;
grant select on public.vendor_score_view to authenticated;
grant select on public.vendor_operational_metrics to service_role;
grant select on public.vendor_score_view to service_role;
