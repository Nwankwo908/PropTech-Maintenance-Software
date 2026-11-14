-- Staff analytics: one metrics layer for Ulo platform staff.
--
-- Every staff-facing number is defined once here. The "Ulo Ops" dashboard and
-- Ask Ulo's staff questions both read public.get_staff_metrics(), which reads
-- these views, so the two can never disagree.
--
-- Shape:
--   analytics.*            fact views (one row per landlord / work order / message …)
--                          that hold the metric definitions as columns.
--   get_staff_metrics()    the only entry point. Platform staff only, aggregates only.
--
-- Privacy: the views expose ids, timestamps, statuses and amounts, never names,
-- phone numbers, emails, message bodies or addresses. The analytics schema is
-- not granted to anon/authenticated, so only get_staff_metrics() can read it.
--
-- Load: every query is bounded by the requested window or a small snapshot.
-- When volume grows, move these views to a warehouse with the same definitions.

create schema if not exists analytics;
revoke all on schema analytics from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on schema analytics from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on schema analytics from authenticated';
  end if;
end $$;

comment on schema analytics is
  'Staff metrics layer. Read only through public.get_staff_metrics(). No PII columns.';

-- ---------------------------------------------------------------------------
-- 1. Landlord accounts (growth + onboarding funnel)
-- ---------------------------------------------------------------------------
create or replace view analytics.landlord_accounts as
select
  l.id as landlord_id,
  coalesce(l.is_demo, false) as is_demo,
  l.created_at,
  nullif(trim(l.acquisition_source), '') as acquisition_source,
  coalesce(lo.onboarding_status, 'not_started') as onboarding_status,
  lo.completed_at as onboarding_completed_at,
  coalesce(p.property_count, 0) as property_count,
  coalesce(u.unit_count, 0) as unit_count,
  coalesce(r.resident_count, 0) as resident_count,
  coalesce(r.activated_resident_count, 0) as activated_resident_count,
  w.first_work_order_at,
  w.last_work_order_at
from public.landlords l
left join public.landlord_onboarding lo on lo.landlord_id = l.id
left join lateral (
  select count(*)::int as property_count
  from public.properties p where p.landlord_id = l.id
) p on true
left join lateral (
  select count(*)::int as unit_count
  from public.units u where u.landlord_id = l.id
) u on true
left join lateral (
  select
    count(*)::int as resident_count,
    count(*) filter (where us.activation_status = 'activated')::int as activated_resident_count
  from public.users us
  where us.landlord_id = l.id
    and us.archived_at is null
    and coalesce(us.role, 'resident') in ('resident', 'tenant')
) r on true
left join lateral (
  select min(mr.created_at) as first_work_order_at, max(mr.created_at) as last_work_order_at
  from public.maintenance_requests mr
  where mr.landlord_id = l.id and coalesce(mr.observation_only, false) = false
) w on true;

comment on view analytics.landlord_accounts is
  'One row per landlord account. Residents = non-archived users with role resident/tenant. '
  'Activated = activation_status = activated. Work orders exclude observation-only Home Check rows.';

-- ---------------------------------------------------------------------------
-- 2. Work orders (maintenance operations)
-- ---------------------------------------------------------------------------
create or replace view analytics.work_orders as
with base as (
  select
    mr.id as work_order_id,
    mr.landlord_id,
    coalesce(l.is_demo, false) as is_demo,
    mr.created_at,
    mr.assigned_at,
    mr.completed_at,
    mr.cancelled_at,
    mr.due_at,
    mr.vendor_work_status as status,
    mr.assigned_vendor_id as vendor_id,
    coalesce(
      nullif(lower(trim(mr.category)), ''),
      nullif(lower(trim(mr.issue_category)), ''),
      'other'
    ) as trade,
    (
      mr.context_urgency = 'emergency'
      or coalesce(lower(trim(mr.severity)), '') = 'urgent'
      or coalesce(lower(trim(mr.priority)), '') in ('urgent', 'emergency', 'high')
    ) as is_emergency,
    (
      mr.vendor_work_status in ('completed', 'cancelled', 'archived')
      or mr.cancelled_at is not null
    ) as is_closed,
    mr.stall_follow_up_sent_at,
    coalesce(mr.auto_reassign_needs_admin_entries, 0) as needs_admin_entries,
    case when mr.spend_status = 'recognized' then mr.recognized_spend_amount end as recognized_spend,
    mr.recognized_spend_at,
    (mr.property_id is null) as missing_property
  from public.maintenance_requests mr
  left join public.landlords l on l.id = mr.landlord_id
  where coalesce(mr.observation_only, false) = false
)
select
  b.*,
  not b.is_closed as is_open,
  (not b.is_closed and b.due_at is not null and b.due_at < now()) as is_overdue,
  (not b.is_closed and b.stall_follow_up_sent_at is not null) as is_stalled,
  (not b.is_closed and b.needs_admin_entries > 0) as needs_staff,
  case when b.assigned_at >= b.created_at
    then extract(epoch from (b.assigned_at - b.created_at)) / 3600.0 end as hours_to_assign,
  case when b.status = 'completed' and b.completed_at >= b.created_at
    then extract(epoch from (b.completed_at - b.created_at)) / 3600.0 end as hours_to_complete,
  coalesce(ro.reopen_count, 0) as reopen_count
from base b
left join lateral (
  select count(*)::int as reopen_count
  from public.maintenance_work_order_reopens r
  where r.maintenance_request_id = b.work_order_id
) ro on true;

comment on view analytics.work_orders is
  'One row per work order (observation-only Home Checks excluded). '
  'Open = not completed/cancelled/archived. Overdue = open and past due_at. '
  'Stalled = open and a stall follow-up was sent. Needs staff = open with auto-reassign needs-admin entries. '
  'Emergency = context_urgency emergency, severity urgent, or priority urgent/emergency/high. '
  'Hours to complete only counts completed jobs.';

-- ---------------------------------------------------------------------------
-- 3. Vendor offers (vendor responsiveness) and ratings
-- ---------------------------------------------------------------------------
create or replace view analytics.vendor_offers as
with offers as (
  select
    e.ticket_id as work_order_id,
    e.vendor_id,
    min(e.created_at) as offered_at
  from public.vendor_status_events e
  where e.to_status = 'pending_accept' and e.vendor_id is not null
  group by e.ticket_id, e.vendor_id
)
select
  o.work_order_id,
  o.vendor_id,
  mr.landlord_id,
  coalesce(l.is_demo, false) as is_demo,
  o.offered_at,
  resp.responded_at,
  resp.response,
  case when resp.responded_at is not null
    then extract(epoch from (resp.responded_at - o.offered_at)) / 60.0 end as minutes_to_respond
from offers o
join public.maintenance_requests mr on mr.id = o.work_order_id
left join public.landlords l on l.id = mr.landlord_id
left join lateral (
  select e.created_at as responded_at, e.to_status as response
  from public.vendor_status_events e
  where e.ticket_id = o.work_order_id
    and e.vendor_id = o.vendor_id
    and e.to_status in ('accepted', 'declined')
    and e.created_at >= o.offered_at
  order by e.created_at
  limit 1
) resp on true;

comment on view analytics.vendor_offers is
  'One row per (work order, vendor) offer. Response = first accepted/declined after the offer. '
  'Rows with no vendor_id on the status event are not counted.';

create or replace view analytics.vendor_ratings as
select
  f.vendor_id,
  f.landlord_id,
  coalesce(l.is_demo, false) as is_demo,
  f.rating,
  f.rater_type,
  f.submitted_at
from public.vendor_feedback f
left join public.landlords l on l.id = f.landlord_id
where f.rating is not null;

-- ---------------------------------------------------------------------------
-- 4. Residents and SMS (tenant communication)
-- ---------------------------------------------------------------------------
create or replace view analytics.residents as
select
  us.id as resident_id,
  us.landlord_id,
  coalesce(l.is_demo, false) as is_demo,
  us.created_at,
  us.activation_status,
  us.sms_consent_status,
  (us.activation_status = 'activated') as is_activated
from public.users us
left join public.landlords l on l.id = us.landlord_id
where us.archived_at is null
  and coalesce(us.role, 'resident') in ('resident', 'tenant');

create or replace view analytics.sms_messages as
select
  m.id as message_id,
  m.landlord_id,
  coalesce(l.is_demo, false) as is_demo,
  m.created_at,
  m.direction,
  case
    when lower(coalesce(m.provider_status, '')) in ('failed', 'undelivered') then 'failed'
    when lower(coalesce(m.provider_status, '')) = 'delivered' then 'delivered'
    else 'other'
  end as delivery_status
from public.sms_messages m
left join public.landlords l on l.id = m.landlord_id;

comment on view analytics.sms_messages is
  'One row per SMS (no bodies or numbers). Failed = provider status failed/undelivered.';

-- ---------------------------------------------------------------------------
-- 5. Money: rent ledger, maintenance spend, invoices
-- ---------------------------------------------------------------------------
create or replace view analytics.rent_ledger as
select
  e.id as ledger_event_id,
  e.landlord_id,
  coalesce(l.is_demo, false) as is_demo,
  e.created_at,
  e.billing_period,
  e.event_type,
  case
    when e.event_type = 'rent_due' then 'due'
    when e.event_type = 'rent_payment_stripe' then 'collected_online'
    when e.event_type in ('rent_payment_reported', 'rent_partial_payment_reported') then 'reported_by_tenant'
    when e.event_type = 'rent_late' then 'late'
    else 'other'
  end as kind,
  coalesce(e.amount, 0) as amount
from public.ledger_events e
left join public.landlords l on l.id = e.landlord_id
where e.event_type like 'rent%';

comment on view analytics.rent_ledger is
  'Rent ledger events. collected_online = Stripe payments. reported_by_tenant = tenant said they paid '
  '(not verified). late = late-rent escalation.';

create or replace view analytics.maintenance_invoices as
select
  i.id as invoice_id,
  i.landlord_id,
  coalesce(l.is_demo, false) as is_demo,
  i.status,
  coalesce(i.total_cost, 0) as total_cost,
  i.submitted_at,
  i.approved_at
from public.maintenance_invoices i
left join public.landlords l on l.id = i.landlord_id;

-- ---------------------------------------------------------------------------
-- 6. AI quality and cost
-- ---------------------------------------------------------------------------
create or replace view analytics.ai_classifications as
select
  c.id as classification_id,
  c.landlord_id,
  coalesce(l.is_demo, false) as is_demo,
  c.created_at,
  (c.llm_provider is not null) as used_llm,
  c.confidence_band,
  c.was_correct,
  c.latency_ms
from public.ai_classification_log c
left join public.landlords l on l.id = c.landlord_id;

comment on view analytics.ai_classifications is
  'Maintenance classification runs. used_llm = false means rules only (AI unavailable or skipped). '
  'was_correct is set only for reviewed rows.';

create or replace view analytics.ask_ulo_answers as
select
  e.id as eval_id,
  e.landlord_id,
  coalesce(l.is_demo, false) as is_demo,
  e.created_at,
  e.gate_status,
  coalesce(e.refused, false) as refused,
  e.answer_confidence,
  coalesce(e.prompt_tokens, 0) + coalesce(e.completion_tokens, 0) + coalesce(e.embed_tokens, 0) as total_tokens,
  e.estimated_cost_usd,
  e.latency_ms,
  e.human_rating
from public.ask_ulo_evals e
left join public.landlords l on l.id = e.landlord_id;

-- ---------------------------------------------------------------------------
-- 7. Data health (snapshot)
-- ---------------------------------------------------------------------------
create or replace function analytics.required_cron_health()
returns table (jobname text, status text, scheduled boolean, failed_runs_24h integer)
language plpgsql
stable
set search_path = public
as $$
begin
  if to_regclass('cron.job') is null then
    return query
      select r.jobname, r.status, null::boolean, null::integer
      from public.ulo_required_cron_jobs r;
    return;
  end if;
  return query execute $q$
    select
      r.jobname,
      r.status,
      exists (select 1 from cron.job j where j.jobname = r.jobname and coalesce(j.active, true)) as scheduled,
      (
        select count(*)::int
        from cron.job_run_details d
        join cron.job j on j.jobid = d.jobid
        where j.jobname = r.jobname
          and d.status = 'failed'
          and d.start_time > now() - interval '24 hours'
      ) as failed_runs_24h
    from public.ulo_required_cron_jobs r
  $q$;
end;
$$;

comment on function analytics.required_cron_health() is
  'Required cron jobs: live jobs missing from pg_cron are an outage class (see WO-5FA6).';

-- ---------------------------------------------------------------------------
-- 8. Entry point: public.get_staff_metrics
-- ---------------------------------------------------------------------------
create or replace function public.get_staff_metrics(
  p_days integer default 30,
  p_include_demo boolean default false
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, analytics
as $$
declare
  v_days integer := least(greatest(coalesce(p_days, 30), 1), 365);
  v_since timestamptz;
  v_result jsonb;
begin
  if not coalesce(public.is_platform_staff(), false) then
    raise exception 'Platform staff access required' using errcode = '42501';
  end if;

  v_since := now() - make_interval(days => v_days);

  with
  la as (
    select * from analytics.landlord_accounts where p_include_demo or not is_demo
  ),
  wo as (
    select * from analytics.work_orders where p_include_demo or not is_demo
  ),
  wo_window as (
    select * from wo where created_at >= v_since
  ),
  vo as (
    select * from analytics.vendor_offers
    where (p_include_demo or not is_demo) and offered_at >= v_since
  ),
  vr as (
    select * from analytics.vendor_ratings
    where (p_include_demo or not is_demo) and submitted_at >= v_since
  ),
  res as (
    select * from analytics.residents where p_include_demo or not is_demo
  ),
  sms as (
    select * from analytics.sms_messages
    where (p_include_demo or not is_demo) and created_at >= v_since
  ),
  rent as (
    select * from analytics.rent_ledger
    where (p_include_demo or not is_demo) and created_at >= v_since
  ),
  inv as (
    select * from analytics.maintenance_invoices where p_include_demo or not is_demo
  ),
  ai as (
    select * from analytics.ai_classifications
    where (p_include_demo or not is_demo) and created_at >= v_since
  ),
  au as (
    select * from analytics.ask_ulo_answers
    where (p_include_demo or not is_demo) and created_at >= v_since
  ),
  active_landlords as (
    select landlord_id from wo_window
    union
    select landlord_id from sms where direction = 'inbound'
  ),
  weeks as (
    select generate_series(
      date_trunc('week', v_since), date_trunc('week', now()), interval '1 week'
    ) as week_start
  ),
  cron_health as (
    select * from analytics.required_cron_health()
  )
  select jsonb_build_object(
    'generated_at', now(),
    'window_days', v_days,
    'since', v_since,
    'include_demo', coalesce(p_include_demo, false),

    'growth', jsonb_build_object(
      'landlords_total', (select count(*) from la),
      'landlords_new', (select count(*) from la where created_at >= v_since),
      'landlords_active', (select count(distinct landlord_id) from active_landlords
                           where landlord_id in (select landlord_id from la)),
      'properties', (select coalesce(sum(property_count), 0) from la),
      'units', (select coalesce(sum(unit_count), 0) from la),
      'residents', (select count(*) from res),
      'residents_activated', (select count(*) from res where is_activated),
      'resident_activation_rate', (
        select round(count(*) filter (where is_activated)::numeric / nullif(count(*), 0), 4) from res
      ),
      'waitlist_signups', (select count(*) from public.waitlist_signups w where w.created_at >= v_since),
      'funnel', jsonb_build_object(
        'signed_up', (select count(*) from la),
        'onboarding_completed', (select count(*) from la where onboarding_status = 'completed'),
        'added_property', (select count(*) from la where property_count > 0),
        'added_residents', (select count(*) from la where resident_count > 0),
        'activated_a_resident', (select count(*) from la where activated_resident_count > 0),
        'first_work_order', (select count(*) from la where first_work_order_at is not null)
      ),
      'new_landlords_by_source', coalesce((
        select jsonb_agg(jsonb_build_object('source', source, 'count', n) order by n desc)
        from (
          select coalesce(acquisition_source, 'unknown') as source, count(*) as n
          from la where created_at >= v_since group by 1
        ) s
      ), '[]'::jsonb)
    ),

    'maintenance', jsonb_build_object(
      'created', (select count(*) from wo_window),
      'completed', (select count(*) from wo where status = 'completed' and completed_at >= v_since),
      'cancelled', (select count(*) from wo where cancelled_at >= v_since),
      'emergencies', (select count(*) from wo_window where is_emergency),
      'open_now', (select count(*) from wo where is_open),
      'overdue_now', (select count(*) from wo where is_overdue),
      'stalled_now', (select count(*) from wo where is_stalled),
      'needs_staff_now', (select count(*) from wo where needs_staff),
      'reopened', (select count(*) from public.maintenance_work_order_reopens r
                   where r.reopened_at >= v_since
                     and r.maintenance_request_id in (select work_order_id from wo)),
      'median_hours_to_assign', (
        select round(percentile_cont(0.5) within group (order by hours_to_assign)::numeric, 1)
        from wo_window where hours_to_assign is not null
      ),
      'p90_hours_to_assign', (
        select round(percentile_cont(0.9) within group (order by hours_to_assign)::numeric, 1)
        from wo_window where hours_to_assign is not null
      ),
      'median_hours_to_complete', (
        select round(percentile_cont(0.5) within group (order by hours_to_complete)::numeric, 1)
        from wo where completed_at >= v_since and hours_to_complete is not null
      ),
      'p90_hours_to_complete', (
        select round(percentile_cont(0.9) within group (order by hours_to_complete)::numeric, 1)
        from wo where completed_at >= v_since and hours_to_complete is not null
      ),
      'by_trade', coalesce((
        select jsonb_agg(jsonb_build_object('trade', trade, 'created', n) order by n desc, trade)
        from (select trade, count(*) as n from wo_window group by trade) t
      ), '[]'::jsonb),
      'weekly', coalesce((
        select jsonb_agg(jsonb_build_object(
          'week_start', to_char(w.week_start, 'YYYY-MM-DD'),
          'created', (select count(*) from wo_window x
                      where x.created_at >= w.week_start and x.created_at < w.week_start + interval '1 week'),
          'completed', (select count(*) from wo x
                        where x.status = 'completed'
                          and x.completed_at >= greatest(w.week_start, v_since)
                          and x.completed_at < w.week_start + interval '1 week')
        ) order by w.week_start)
        from weeks w
      ), '[]'::jsonb)
    ),

    'vendors', jsonb_build_object(
      'active_vendors', (select count(distinct vendor_id) from wo_window where vendor_id is not null),
      'offers', (select count(*) from vo),
      'accepted', (select count(*) from vo where response = 'accepted'),
      'declined', (select count(*) from vo where response = 'declined'),
      'no_response', (select count(*) from vo where response is null),
      'acceptance_rate', (
        select round(count(*) filter (where response = 'accepted')::numeric
                     / nullif(count(*) filter (where response is not null), 0), 4)
        from vo
      ),
      'median_minutes_to_respond', (
        select round(percentile_cont(0.5) within group (order by minutes_to_respond)::numeric, 0)
        from vo where minutes_to_respond is not null
      ),
      'ratings', (select count(*) from vr),
      'average_rating', (select round(avg(rating)::numeric, 2) from vr)
    ),

    'money', jsonb_build_object(
      'rent_due', (select coalesce(sum(amount), 0) from rent where kind = 'due'),
      'rent_collected_online', (select coalesce(sum(amount), 0) from rent where kind = 'collected_online'),
      'rent_reported_by_tenants', (select coalesce(sum(amount), 0) from rent where kind = 'reported_by_tenant'),
      'rent_late_events', (select count(*) from rent where kind = 'late'),
      'maintenance_spend', (select coalesce(sum(recognized_spend), 0) from wo where recognized_spend_at >= v_since),
      'invoices_approved_total', (select coalesce(sum(total_cost), 0) from inv
                                  where status = 'approved' and approved_at >= v_since),
      'invoices_waiting_count', (select count(*) from inv where status = 'submitted'),
      'invoices_waiting_total', (select coalesce(sum(total_cost), 0) from inv where status = 'submitted')
    ),

    'sms', jsonb_build_object(
      'inbound', (select count(*) from sms where direction = 'inbound'),
      'outbound', (select count(*) from sms where direction = 'outbound'),
      'outbound_delivered', (select count(*) from sms where direction = 'outbound' and delivery_status = 'delivered'),
      'outbound_failed', (select count(*) from sms where direction = 'outbound' and delivery_status = 'failed'),
      'outbound_failure_rate', (
        select round(count(*) filter (where delivery_status = 'failed')::numeric / nullif(count(*), 0), 4)
        from sms where direction = 'outbound'
      ),
      'residents_activated_in_window', (select count(*) from res where is_activated and created_at >= v_since),
      'residents_activation_failed', (select count(*) from res where activation_status = 'delivery_failed'),
      'residents_opted_out', (select count(*) from res where activation_status = 'opted_out' or sms_consent_status = 'opted_out')
    ),

    'ai', jsonb_build_object(
      'classifications', (select count(*) from ai),
      'classification_rules_only_rate', (
        select round(count(*) filter (where not used_llm)::numeric / nullif(count(*), 0), 4) from ai
      ),
      'classification_low_confidence', (select count(*) from ai where confidence_band = 'low'),
      'classifications_reviewed', (select count(*) from ai where was_correct is not null),
      'classification_review_accuracy', (
        select round(count(*) filter (where was_correct)::numeric / nullif(count(*) filter (where was_correct is not null), 0), 4)
        from ai
      ),
      'ask_ulo_answers', (select count(*) from au),
      'ask_ulo_refused', (select count(*) from au where refused),
      'ask_ulo_blocked_or_clarified', (select count(*) from au where gate_status in ('refuse', 'clarify')),
      'ask_ulo_tokens', (select coalesce(sum(total_tokens), 0) from au),
      'ask_ulo_cost_usd', (select round(coalesce(sum(estimated_cost_usd), 0)::numeric, 2) from au),
      'ask_ulo_median_latency_ms', (
        select round(percentile_cont(0.5) within group (order by latency_ms)::numeric, 0)
        from au where latency_ms is not null
      )
    ),

    'data_health', jsonb_build_object(
      'unit_mismatch_findings_7d', (
        select count(*) from public.operations_graph_events g
        where g.event_type = 'ops.ticket_unit_fk_mismatch' and g.created_at >= now() - interval '7 days'
      ),
      'work_orders_missing_property', (select count(*) from wo where missing_property),
      'required_crons_total', (select count(*) from cron_health),
      'required_crons_paused', (select count(*) from cron_health where status = 'paused'),
      'required_crons_missing', (select count(*) from cron_health where status = 'live' and scheduled is false),
      'required_cron_failed_runs_24h', (select coalesce(sum(failed_runs_24h), 0) from cron_health),
      'crons_needing_attention', coalesce((
        select jsonb_agg(jsonb_build_object(
          'jobname', jobname, 'status', status, 'scheduled', scheduled, 'failed_runs_24h', failed_runs_24h
        ) order by jobname)
        from cron_health
        where status = 'paused' or (status = 'live' and scheduled is false) or coalesce(failed_runs_24h, 0) > 0
      ), '[]'::jsonb),
      'delivery_retries_7d', (
        select count(*) from public.delivery_retry_attempts d where d.created_at >= now() - interval '7 days'
      )
    )
  )
  into v_result;

  return v_result;
end;
$$;

comment on function public.get_staff_metrics(integer, boolean) is
  'Staff-only metrics across all landlords (aggregates, no PII). Window 1-365 days. '
  'Demo landlords excluded unless p_include_demo. Raises 42501 for non-staff.';

revoke all on function public.get_staff_metrics(integer, boolean) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.get_staff_metrics(integer, boolean) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant execute on function public.get_staff_metrics(integer, boolean) to authenticated';
  end if;
end $$;

revoke all on function analytics.required_cron_health() from public;
