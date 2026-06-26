-- Fix demo vendor avg response time: anchor accept/decline events to ticket assignment,
-- not migration run time. Also prefer maintenance_requests.landlord_id in metrics view.

create or replace view public.vendor_operational_metrics
with (security_invoker = true)
as
with vendor_jobs as (
  select
    mre.assigned_vendor_id as vendor_id,
    coalesce(mr.landlord_id, mre.landlord_id) as landlord_id,
    mre.id as ticket_id,
    coalesce(mr.vendor_notified_at, mr.assigned_at, mr.created_at) as notified_at,
    mre.vendor_work_status,
    mre.unit_id,
    mre.issue_category
  from public.maintenance_request_enriched mre
  join public.maintenance_requests mr
    on mr.id = mre.id
  where mre.assigned_vendor_id is not null
    and coalesce(mr.landlord_id, mre.landlord_id) is not null
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
    ) filter (
      where vt.first_response_at is not null
        and vt.notified_at is not null
        and vt.first_response_at >= vt.notified_at
    ),
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
  'Vendor operational KPIs. avg_response_time is minutes from vendor notify/assign to first accept/decline.';

-- Recreate vendor_score_view (depends on vendor_operational_metrics columns)
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

do $$
declare
  demo_landlord uuid := 'de300000-0000-4000-8000-000000000001';
begin
  if not exists (select 1 from public.landlords where id = demo_landlord) then
    return;
  end if;

  update public.maintenance_requests mr
  set vendor_notified_at = coalesce(mr.vendor_notified_at, mr.assigned_at)
  where mr.landlord_id = demo_landlord
    and mr.assigned_vendor_id is not null
    and mr.assigned_at is not null;

  delete from public.vendor_status_events vse
  using public.maintenance_requests mr
  where vse.ticket_id = mr.id
    and mr.landlord_id = demo_landlord
    and mr.vendor_work_status = 'completed'
    and vse.source = 'portal';

  insert into public.vendor_status_events (ticket_id, created_at, from_status, to_status, source, vendor_id)
  select
    mr.id,
    mr.assigned_at + offs.step_offset,
    offs.from_status,
    offs.to_status,
    'portal',
    mr.assigned_vendor_id
  from public.maintenance_requests mr
  cross join lateral (
    values
      (interval '38 minutes', 'pending_accept', 'accepted'),
      (interval '2 hours 10 minutes', 'accepted', 'in_progress'),
      (interval '1 day 8 hours', 'in_progress', 'completed')
  ) as offs(step_offset, from_status, to_status)
  where mr.landlord_id = demo_landlord
    and mr.vendor_work_status = 'completed'
    and mr.assigned_at is not null
    and mr.assigned_vendor_id is not null
    and mr.id in (
      md5('ulo-demo-ticket-17')::uuid,
      md5('ulo-demo-ticket-18')::uuid,
      md5('ulo-demo-ticket-19')::uuid,
      md5('ulo-demo-ticket-20')::uuid,
      md5('ulo-demo-ticket-21')::uuid,
      md5('ulo-demo-ticket-22')::uuid,
      md5('ulo-demo-ticket-23')::uuid,
      md5('ulo-demo-ticket-24')::uuid,
      md5('ulo-demo-ticket-25')::uuid,
      md5('ulo-demo-ticket-26')::uuid
    );
end $$;
