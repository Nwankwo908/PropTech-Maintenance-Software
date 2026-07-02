-- Match maintenance_requests.unit to units when labels repeat across buildings
-- (e.g. "402" in Birch Tower vs Maple Heights). Supports "Birch Tower · 402" style
-- labels from demo seed while still joining to units.unit_label "402".

create or replace function public.maintenance_unit_label_match(mr_unit text, unit_label text)
returns boolean
language sql
immutable
as $$
  with normalized_unit as (
    select public.normalize_unit_label(unit_label) as value
  ),
  ticket_labels as (
    select
      public.normalize_unit_label(mr_unit) as full_value,
      nullif(
        regexp_replace(
          regexp_replace(coalesce(trim(mr_unit), ''), '#|unit|apt', '', 'gi'),
          '[^0-9]',
          '',
          'g'
        ),
        ''
      ) as numeric_value
  )
  select
    (select value from normalized_unit) = (select full_value from ticket_labels)
    or (
      (select numeric_value from ticket_labels) is not null
      and (select value from normalized_unit) = (select numeric_value from ticket_labels)
    );
$$;

comment on function public.maintenance_unit_label_match(text, text) is
  'True when a maintenance ticket unit string matches a units.unit_label, including building-prefixed labels.';

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
  coalesce(u.landlord_id, mr.landlord_id) as landlord_id,
  coalesce(u.building, resident_by_email.building) as building,
  public.derive_property_id(
    coalesce(u.landlord_id, mr.landlord_id),
    coalesce(u.building, resident_by_email.building)
  ) as property_id,
  coalesce(
    resident_by_auth.id,
    resident_by_email.id
  ) as resident_id
from public.maintenance_requests mr
left join lateral (
  select u0.*
  from public.units u0
  where u0.landlord_id = mr.landlord_id
    and public.maintenance_unit_label_match(mr.unit, u0.unit_label)
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
  select r0.id, r0.building
  from public.users r0
  where resident_by_auth.id is null
    and lower(trim(r0.email)) = lower(trim(mr.email))
  order by r0.created_at desc
  limit 1
) resident_by_email on true;

comment on view public.maintenance_request_enriched is
  'Maintenance requests joined to units, synthetic property_id, and roster resident_id.';

grant select on public.maintenance_request_enriched to authenticated;
grant select on public.maintenance_request_enriched to service_role;
