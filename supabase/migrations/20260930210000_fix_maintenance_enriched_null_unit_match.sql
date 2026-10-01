-- Fix null-unit false positives in maintenance_unit_label_match and stop
-- maintenance_request_enriched from inventing a property via created_at tiebreak.
--
-- Bug class: ticket.unit IS NULL was treated as matching letter unit labels
-- (e.g. "B"), then order by created_at desc limit 1 silently picked 3804 W Bay
-- even when maintenance_requests.property_id / unit_id correctly pointed at
-- 646 Bartlett. Wrong-but-populated is worse than a visible gap.

-- ---------------------------------------------------------------------------
-- 1. Null / blank ticket unit never matches any label
-- ---------------------------------------------------------------------------
create or replace function public.maintenance_unit_label_match(mr_unit text, unit_label text)
returns boolean
language sql
immutable
as $$
  select case
    when nullif(trim(mr_unit), '') is null then false
    when nullif(trim(unit_label), '') is null then false
    else (
      with normalized_unit as (
        select public.normalize_unit_label(unit_label) as value
      ),
      ticket_labels as (
        select
          public.normalize_unit_label(mr_unit) as full_value,
          nullif(
            regexp_replace(
              regexp_replace(trim(mr_unit), '#|unit|apt', '', 'gi'),
              '[^0-9]',
              '',
              'g'
            ),
            ''
          ) as numeric_value
      )
      select
        nullif((select value from normalized_unit), '') is not null
        and (
          (select value from normalized_unit) = (select full_value from ticket_labels)
          or (
            (select numeric_value from ticket_labels) is not null
            and (select value from normalized_unit) = (select numeric_value from ticket_labels)
          )
        )
    )
  end;
$$;

comment on function public.maintenance_unit_label_match(text, text) is
  'True when a non-blank maintenance ticket unit string matches a units.unit_label (including building-prefixed labels). Null/blank ticket unit never matches.';

-- ---------------------------------------------------------------------------
-- 2. Enriched view: prefer stored unit_id; label match only when unique;
--    never created_at desc limit 1; landlord_id always from the ticket.
-- ---------------------------------------------------------------------------
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
  coalesce(u_by_id.id, u_by_label.id) as unit_id,
  mr.landlord_id as landlord_id,
  coalesce(u_by_id.building, u_by_label.building) as building,
  coalesce(
    mr.property_id,
    u_by_id.property_id,
    u_by_label.property_id
  ) as property_id,
  coalesce(
    resident_by_auth.id,
    resident_by_email.id
  ) as resident_id,
  mr.urgency,
  mr.due_at,
  mr.resident_name,
  mr.resident_reported_recurring
from public.maintenance_requests mr
-- Canonical unit_id on the ticket wins — must belong to the same landlord.
left join public.units u_by_id
  on mr.unit_id is not null
  and u_by_id.id = mr.unit_id
  and u_by_id.landlord_id = mr.landlord_id
-- Label join only when unit_id is missing. Landlord-scoped. Exactly one match
-- after optional building-hint filter; ambiguous → unresolved (nulls).
left join lateral (
  with candidates as (
    select u0.id, u0.building, u0.property_id, u0.landlord_id
    from public.units u0
    where mr.unit_id is null
      and nullif(trim(mr.unit), '') is not null
      and u0.landlord_id = mr.landlord_id
      and public.maintenance_unit_label_match(mr.unit, u0.unit_label)
  ),
  hinted as (
    select c.*
    from candidates c
    where c.building is not null
      and lower(mr.unit) like '%' || lower(trim(c.building)) || '%'
  ),
  pool as (
    select * from hinted
    where exists (select 1 from hinted)
    union all
    select * from candidates
    where not exists (select 1 from hinted)
  )
  select p.id, p.building, p.property_id, p.landlord_id
  from pool p
  where (select count(*)::int from pool) = 1
) u_by_label on u_by_id.id is null
left join lateral (
  select r0.id
  from public.users r0
  where mr.resident_user_id is not null
    and r0.supabase_user_id = mr.resident_user_id
  limit 1
) resident_by_auth on true
left join lateral (
  select r0.id, r0.building
  from public.users r0
  where resident_by_auth.id is null
    and mr.email is not null
    and nullif(trim(mr.email), '') is not null
    and lower(trim(r0.email)) = lower(trim(mr.email))
  order by r0.created_at desc
  limit 1
) resident_by_email on true;

comment on view public.maintenance_request_enriched is
  'Maintenance requests joined to units (prefer unit_id; unique label match only), stored property_id, roster resident_id, SLA fields. Null/ambiguous unit → unresolved building/property rather than a wrong guess.';

grant select on public.maintenance_request_enriched to authenticated;
grant select on public.maintenance_request_enriched to service_role;
