-- Operations intelligence views for staff dashboards.
-- Metrics use available ticket / vendor / graph data with documented proxies where
-- dedicated complaint, approval, or cost tables do not yet exist.

create extension if not exists "uuid-ossp" with schema extensions;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function public.normalize_unit_label(label text)
returns text
language sql
immutable
as $$
  select lower(
    regexp_replace(
      regexp_replace(coalesce(trim(label), ''), '#|unit|apt', '', 'gi'),
      '[^a-z0-9]',
      '',
      'g'
    )
  );
$$;

comment on function public.normalize_unit_label(text) is
  'Normalize unit labels for matching maintenance_requests.unit to units.unit_label.';

create or replace function public.derive_property_id(
  p_landlord_id uuid,
  p_building text
)
returns uuid
language sql
immutable
as $$
  select extensions.uuid_generate_v5(
    '6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid,
    p_landlord_id::text || '/' || coalesce(nullif(trim(p_building), ''), '(default)')
  );
$$;

comment on function public.derive_property_id(uuid, text) is
  'Synthetic property_id until a properties table exists (landlord + building).';

create or replace function public.is_emergency_request(
  p_priority text,
  p_severity text
)
returns boolean
language sql
immutable
as $$
  select coalesce(lower(trim(p_severity)), '') = 'urgent'
    or coalesce(lower(trim(p_priority)), '') in ('urgent', 'emergency', 'high');
$$;

comment on function public.is_emergency_request(text, text) is
  'True when ticket severity or resident priority indicates an emergency.';

-- Enriched ticket rows: unit_id, landlord_id, building, property_id, resident_id.
create or replace view public.maintenance_request_enriched
with (security_invoker = true)
as
select
  mr.id,
  mr.created_at,
  mr.assigned_at,
  mr.priority,
  mr.severity,
  mr.unit,
  mr.issue_category,
  mr.description,
  mr.assigned_vendor_id,
  mr.vendor_work_status,
  mr.estimated_minutes,
  mr.resident_user_id,
  mr.email,
  u.id as unit_id,
  u.landlord_id,
  u.building,
  public.derive_property_id(u.landlord_id, u.building) as property_id,
  coalesce(
    resident_by_auth.id,
    resident_by_email.id
  ) as resident_id
from public.maintenance_requests mr
left join lateral (
  select u0.*
  from public.units u0
  where public.normalize_unit_label(u0.unit_label) = public.normalize_unit_label(mr.unit)
  order by
    case
      when u0.building is not null
        and nullif(trim(mr.unit), '') is not null
        and lower(mr.unit) like '%' || lower(trim(u0.building)) || '%'
      then 0
      else 1
    end,
    u0.created_at desc
  limit 1
) u on true
left join lateral (
  select r0.id
  from public.users r0
  where mr.resident_user_id is not null
    and r0.supabase_user_id = mr.resident_user_id
  limit 1
) resident_by_auth on true
left join lateral (
  select r0.id
  from public.users r0
  where resident_by_auth.id is null
    and lower(trim(r0.email)) = lower(trim(mr.email))
  order by r0.created_at desc
  limit 1
) resident_by_email on true;

comment on view public.maintenance_request_enriched is
  'Maintenance requests joined to units, synthetic property_id, and roster resident_id.';

-- ---------------------------------------------------------------------------
-- 1. vendor_performance_view
-- ---------------------------------------------------------------------------

create or replace view public.vendor_performance_view
with (security_invoker = true)
as
with vendor_jobs as (
  select
    mre.assigned_vendor_id as vendor_id,
    mre.id as ticket_id,
    mre.created_at,
    mre.assigned_at,
    mre.unit_id,
    mre.issue_category,
    mre.vendor_work_status
  from public.maintenance_request_enriched mre
  where mre.assigned_vendor_id is not null
),
vendor_timing as (
  select
    vj.vendor_id,
    vj.ticket_id,
    vj.created_at,
    vj.assigned_at,
    vj.unit_id,
    vj.issue_category,
    vj.vendor_work_status,
    min(vse.created_at) filter (where vse.to_status = 'accepted') as accepted_at,
    min(vse.created_at) filter (where vse.to_status = 'completed') as completed_at,
    bool_or(vse.to_status = 'declined') as was_declined
  from vendor_jobs vj
  left join public.vendor_status_events vse
    on vse.ticket_id = vj.ticket_id
  group by
    vj.vendor_id,
    vj.ticket_id,
    vj.created_at,
    vj.assigned_at,
    vj.unit_id,
    vj.issue_category,
    vj.vendor_work_status
),
reopen_flags as (
  select
    vt.vendor_id,
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
        and follow.created_at <= vt.completed_at + interval '90 days'
    ) as is_reopened
  from vendor_timing vt
),
tenant_messages as (
  select
    oge.vendor_id,
    count(*)::bigint as complaint_count
  from public.operations_graph_events oge
  where oge.vendor_id is not null
    and oge.event_type in ('tenant.message_to_vendor', 'sms.message_received')
    and coalesce(oge.actor_type, '') = 'resident'
  group by oge.vendor_id
)
select
  vt.vendor_id,
  count(distinct vt.ticket_id)::bigint as total_jobs,
  round(
    avg(
      extract(
        epoch from (
          vt.accepted_at - coalesce(vt.assigned_at, vt.created_at)
        )
      ) / 60.0
    ) filter (where vt.accepted_at is not null),
    2
  ) as avg_response_time,
  round(
    avg(
      extract(epoch from (vt.completed_at - vt.accepted_at)) / 60.0
    ) filter (
      where vt.accepted_at is not null
        and vt.completed_at is not null
    ),
    2
  ) as avg_completion_time,
  round(
    count(distinct vt.ticket_id) filter (where vt.was_declined)::numeric
      / nullif(count(distinct vt.ticket_id), 0),
    4
  ) as decline_rate,
  round(
    count(distinct rf.ticket_id) filter (where rf.is_reopened)::numeric
      / nullif(
        count(distinct vt.ticket_id) filter (where vt.vendor_work_status = 'completed'),
        0
      ),
    4
  ) as reopen_rate,
  coalesce(max(tm.complaint_count), 0)::bigint as tenant_complaint_count
from vendor_timing vt
left join reopen_flags rf
  on rf.vendor_id = vt.vendor_id
 and rf.ticket_id = vt.ticket_id
left join tenant_messages tm
  on tm.vendor_id = vt.vendor_id
group by vt.vendor_id;

comment on view public.vendor_performance_view is
  'Vendor SLA metrics. avg_* columns are minutes. decline_rate/reopen_rate are 0–1 fractions. '
  'reopen_rate = completed jobs with same unit+category follow-up within 90 days. '
  'tenant_complaint_count = resident proxied/SMS graph events to vendor.';

-- ---------------------------------------------------------------------------
-- 2. unit_maintenance_cost_view
-- ---------------------------------------------------------------------------

create or replace view public.unit_maintenance_cost_view
with (security_invoker = true)
as
with unit_tickets as (
  select
    mre.unit_id,
    mre.id as ticket_id,
    mre.issue_category,
    mre.priority,
    mre.severity,
    mre.estimated_minutes,
    mre.created_at,
    row_number() over (
      partition by mre.unit_id, coalesce(mre.issue_category, 'unknown')
      order by mre.created_at
    ) as category_occurrence
  from public.maintenance_request_enriched mre
  where mre.unit_id is not null
),
recurring as (
  select
    ut.unit_id,
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'issue_category', ut.issue_category,
          'count', ut.category_count
        )
        order by ut.category_count desc, ut.issue_category
      ),
      '[]'::jsonb
    ) as recurring_categories
  from (
    select
      unit_id,
      issue_category,
      count(*)::bigint as category_count
    from unit_tickets
    group by unit_id, issue_category
    having count(*) > 1
  ) ut
  group by ut.unit_id
)
select
  ut.unit_id,
  count(distinct ut.ticket_id)::bigint as total_requests,
  coalesce(r.recurring_categories, '[]'::jsonb) as recurring_categories,
  round(
    sum(coalesce(ut.estimated_minutes, 240) * 1.25)::numeric,
    2
  ) as estimated_total_cost,
  count(distinct ut.ticket_id) filter (
    where public.is_emergency_request(ut.priority, ut.severity)
  )::bigint as emergency_count,
  count(distinct ut.ticket_id) filter (
    where ut.category_occurrence > 1
  )::bigint as repeat_issue_count
from unit_tickets ut
left join recurring r
  on r.unit_id = ut.unit_id
group by ut.unit_id, r.recurring_categories;

comment on view public.unit_maintenance_cost_view is
  'Per-unit maintenance volume and cost proxy (estimated_minutes × $1.25/min). '
  'recurring_categories lists categories with count > 1. repeat_issue_count excludes first occurrence per category.';

-- ---------------------------------------------------------------------------
-- 3. property_recurring_issues_view
-- ---------------------------------------------------------------------------

create or replace view public.property_recurring_issues_view
with (security_invoker = true)
as
select
  mre.property_id,
  coalesce(nullif(trim(mre.issue_category), ''), 'unknown') as issue_category,
  count(*)::bigint as count,
  max(mre.created_at) as last_seen_at,
  coalesce(
    array_agg(distinct mre.unit_id) filter (where mre.unit_id is not null),
    '{}'::uuid[]
  ) as affected_units
from public.maintenance_request_enriched mre
where mre.property_id is not null
group by mre.property_id, coalesce(nullif(trim(mre.issue_category), ''), 'unknown')
having count(*) > 1;

comment on view public.property_recurring_issues_view is
  'Recurring issue categories per synthetic property (landlord + building). '
  'Only categories with count > 1 are included.';

-- ---------------------------------------------------------------------------
-- 4. landlord_approval_speed_view
-- ---------------------------------------------------------------------------

create or replace view public.landlord_approval_speed_view
with (security_invoker = true)
as
select
  mre.landlord_id,
  round(
    avg(
      extract(epoch from (mre.assigned_at - mre.created_at)) / 3600.0
    ) filter (where mre.assigned_at is not null),
    2
  ) as avg_approval_time,
  count(*) filter (
    where mre.assigned_at is not null
      and mre.assigned_at - mre.created_at > case
        when public.is_emergency_request(mre.priority, mre.severity)
        then interval '2 hours'
        else interval '8 hours'
      end
  )::bigint as delayed_approval_count
from public.maintenance_request_enriched mre
where mre.landlord_id is not null
group by mre.landlord_id;

comment on view public.landlord_approval_speed_view is
  'Landlord vendor-assignment speed. avg_approval_time is hours from ticket creation to assigned_at. '
  'delayed_approval_count uses 2h threshold for emergencies, 8h otherwise.';

-- ---------------------------------------------------------------------------
-- 5. tenant_request_frequency_view
-- ---------------------------------------------------------------------------

create or replace view public.tenant_request_frequency_view
with (security_invoker = true)
as
with tenant_tickets as (
  select
    mre.resident_id,
    mre.unit_id,
    mre.id as ticket_id,
    mre.priority,
    mre.severity,
    mre.issue_category,
    mre.created_at,
    row_number() over (
      partition by mre.resident_id, mre.unit_id, coalesce(mre.issue_category, 'unknown')
      order by mre.created_at
    ) as category_occurrence
  from public.maintenance_request_enriched mre
  where mre.resident_id is not null
    and mre.unit_id is not null
)
select
  tt.resident_id,
  tt.unit_id,
  count(distinct tt.ticket_id)::bigint as request_count,
  count(distinct tt.ticket_id) filter (
    where public.is_emergency_request(tt.priority, tt.severity)
  )::bigint as emergency_count,
  count(distinct tt.ticket_id) filter (
    where tt.category_occurrence > 1
  )::bigint as repeated_issue_count
from tenant_tickets tt
group by tt.resident_id, tt.unit_id;

comment on view public.tenant_request_frequency_view is
  'Per-resident / per-unit request volume. repeated_issue_count excludes first ticket per issue_category.';

-- ---------------------------------------------------------------------------
-- Grants (staff session via is_staff_admin on underlying tables)
-- ---------------------------------------------------------------------------

grant select on public.maintenance_request_enriched to authenticated;
grant select on public.vendor_performance_view to authenticated;
grant select on public.unit_maintenance_cost_view to authenticated;
grant select on public.property_recurring_issues_view to authenticated;
grant select on public.landlord_approval_speed_view to authenticated;
grant select on public.tenant_request_frequency_view to authenticated;

grant select on public.maintenance_request_enriched to service_role;
grant select on public.vendor_performance_view to service_role;
grant select on public.unit_maintenance_cost_view to service_role;
grant select on public.property_recurring_issues_view to service_role;
grant select on public.landlord_approval_speed_view to service_role;
grant select on public.tenant_request_frequency_view to service_role;
