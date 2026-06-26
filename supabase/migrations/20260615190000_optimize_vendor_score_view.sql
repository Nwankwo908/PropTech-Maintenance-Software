-- Speed up vendor score loading: avoid maintenance_request_enriched + correlated
-- rework EXISTS (was causing statement timeouts on the Vendors page).

create index if not exists maintenance_requests_landlord_vendor_idx
  on public.maintenance_requests (landlord_id, assigned_vendor_id)
  where assigned_vendor_id is not null;

create index if not exists maintenance_requests_landlord_unit_category_idx
  on public.maintenance_requests (landlord_id, unit, issue_category);

create index if not exists vendor_status_events_ticket_status_time_idx
  on public.vendor_status_events (ticket_id, to_status, created_at);

-- Landlord-scoped metrics (filter early; no enriched view).
create or replace function public.vendor_operational_metrics_for_landlord(p_landlord_id uuid)
returns table (
  vendor_id uuid,
  landlord_id uuid,
  accepted_jobs bigint,
  completed_jobs bigint,
  completion_rate numeric,
  avg_response_time numeric,
  rework_rate numeric,
  rework_window_days int
)
language sql
stable
security invoker
set search_path = public
as $$
  with settings as (
    select public.vendor_rework_window_days(p_landlord_id) as rework_days
  ),
  vendor_jobs as (
    select
      mr.assigned_vendor_id as vendor_id,
      mr.landlord_id,
      mr.id as ticket_id,
      coalesce(mr.vendor_notified_at, mr.assigned_at, mr.created_at) as notified_at,
      mr.vendor_work_status,
      mr.unit,
      mr.issue_category
    from public.maintenance_requests mr
    where mr.landlord_id = p_landlord_id
      and mr.assigned_vendor_id is not null
  ),
  ticket_timing as (
    select
      vse.ticket_id,
      bool_or(vse.to_status = 'accepted') as was_accepted,
      min(vse.created_at) filter (where vse.to_status in ('accepted', 'declined')) as first_response_at,
      min(vse.created_at) filter (where vse.to_status = 'completed') as completed_at
    from public.vendor_status_events vse
    where vse.ticket_id in (select vj.ticket_id from vendor_jobs vj)
    group by vse.ticket_id
  ),
  vendor_timing as (
    select
      vj.vendor_id,
      vj.landlord_id,
      vj.ticket_id,
      vj.notified_at,
      vj.vendor_work_status,
      vj.unit,
      vj.issue_category,
      coalesce(tt.was_accepted, false) as was_accepted,
      tt.first_response_at,
      tt.completed_at
    from vendor_jobs vj
    left join ticket_timing tt on tt.ticket_id = vj.ticket_id
  ),
  rework_flags as (
    select distinct
      base.vendor_id,
      base.ticket_id
    from vendor_timing base
    inner join public.maintenance_requests follow
      on follow.landlord_id = base.landlord_id
     and follow.unit = base.unit
     and coalesce(follow.issue_category, '') = coalesce(base.issue_category, '')
     and follow.id <> base.ticket_id
    cross join settings s
    where base.vendor_work_status = 'completed'
      and base.completed_at is not null
      and follow.created_at > base.completed_at
      and follow.created_at <= base.completed_at + make_interval(days => s.rework_days)
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
        / nullif(count(distinct vt.ticket_id) filter (where vt.was_accepted), 0),
      4
    ) as completion_rate,
    round(
      avg(
        extract(epoch from (vt.first_response_at - vt.notified_at)) / 60.0
      ) filter (
        where vt.first_response_at is not null
          and vt.notified_at is not null
          and vt.first_response_at >= vt.notified_at
      ),
      2
    ) as avg_response_time,
    round(
      count(distinct rf.ticket_id)::numeric
        / nullif(
          count(distinct vt.ticket_id) filter (
            where vt.vendor_work_status = 'completed'
          ),
          0
        ),
      4
    ) as rework_rate,
    (select rework_days from settings)::int as rework_window_days
  from vendor_timing vt
  left join rework_flags rf
    on rf.vendor_id = vt.vendor_id
   and rf.ticket_id = vt.ticket_id
  group by vt.vendor_id, vt.landlord_id;
$$;

comment on function public.vendor_operational_metrics_for_landlord(uuid) is
  'Fast landlord-scoped vendor KPIs for admin dashboards (avoids enriched view).';

-- Single RPC for the Vendors page (one round trip, landlord filter first).
create or replace function public.get_vendor_scores_for_landlord(p_landlord_id uuid)
returns table (
  vendor_id uuid,
  landlord_id uuid,
  vendor_score numeric,
  review_count bigint,
  resident_satisfaction numeric,
  accepted_jobs bigint,
  completed_jobs bigint,
  completion_rate numeric,
  avg_response_time numeric,
  rework_rate numeric,
  response_speed_score numeric,
  completion_score numeric,
  rework_score numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  with feedback_agg as (
    select
      vf.vendor_id,
      count(*) filter (where vf.rating is not null)::bigint as review_count,
      round(avg(vf.rating) filter (where vf.rating is not null), 2) as resident_satisfaction
    from public.vendor_feedback vf
    where vf.landlord_id = p_landlord_id
    group by vf.vendor_id
  ),
  ops as (
    select * from public.vendor_operational_metrics_for_landlord(p_landlord_id)
  ),
  scored as (
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
    left join feedback_agg fa on fa.vendor_id = v.id
    left join ops om
      on om.vendor_id = v.id
     and om.landlord_id = v.landlord_id
    where v.landlord_id = p_landlord_id
  )
  select
    s.vendor_id,
    s.landlord_id,
    round(
      (
        case when s.review_count > 0 then 0.40 * s.resident_satisfaction else 0 end
        + case when s.completion_score is not null then 0.25 * s.completion_score else 0 end
        + case when s.response_speed_score is not null then 0.20 * s.response_speed_score else 0 end
        + case when s.rework_score is not null then 0.15 * s.rework_score else 0 end
      )
      / nullif(
        (case when s.review_count > 0 then 0.40 else 0 end)
        + (case when s.completion_score is not null then 0.25 else 0 end)
        + (case when s.response_speed_score is not null then 0.20 else 0 end)
        + (case when s.rework_score is not null then 0.15 else 0 end),
        0
      ),
      1
    ) as vendor_score,
    s.review_count,
    s.resident_satisfaction,
    s.accepted_jobs,
    s.completed_jobs,
    s.completion_rate,
    s.avg_response_time,
    s.rework_rate,
    s.response_speed_score,
    s.completion_score,
    s.rework_score
  from scored s;
$$;

comment on function public.get_vendor_scores_for_landlord(uuid) is
  'Composite vendor scores for admin Vendors page; landlord-scoped and timeout-safe.';

grant execute on function public.vendor_operational_metrics_for_landlord(uuid) to authenticated;
grant execute on function public.vendor_operational_metrics_for_landlord(uuid) to service_role;
grant execute on function public.get_vendor_scores_for_landlord(uuid) to authenticated;
grant execute on function public.get_vendor_scores_for_landlord(uuid) to service_role;

drop view if exists public.vendor_score_view;
drop view if exists public.vendor_operational_metrics;

-- Analytics views (prefer get_vendor_scores_for_landlord RPC in admin UI).
create or replace view public.vendor_score_view
with (security_invoker = true)
as
select
  g.vendor_id,
  g.landlord_id,
  g.vendor_score,
  g.review_count,
  g.resident_satisfaction as resident_satisfaction,
  g.accepted_jobs,
  g.completed_jobs,
  g.completion_rate,
  g.avg_response_time,
  g.rework_rate,
  public.vendor_rework_window_days(g.landlord_id) as rework_window_days,
  g.response_speed_score,
  g.completion_score,
  g.rework_score
from public.vendors v
cross join lateral public.get_vendor_scores_for_landlord(v.landlord_id) g
where g.vendor_id = v.id;

create or replace view public.vendor_operational_metrics
with (security_invoker = true)
as
select
  m.vendor_id,
  m.landlord_id,
  m.accepted_jobs,
  m.completed_jobs,
  m.completion_rate,
  m.avg_response_time,
  m.rework_rate,
  m.rework_window_days
from public.vendors v
cross join lateral public.vendor_operational_metrics_for_landlord(v.landlord_id) m
where m.vendor_id = v.id;
