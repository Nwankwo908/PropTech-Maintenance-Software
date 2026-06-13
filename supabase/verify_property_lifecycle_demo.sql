-- Verification checks for property lifecycle demo seed + admin dashboard data paths.
-- Run: docker exec -i supabase_db_PropTech_Maintenance_Software psql -U postgres -d postgres -f - < supabase/verify_property_lifecycle_demo.sql

\set seed_landlord_id '068daf53-07e4-4493-bd7f-6106e3c8c62f'
\set building_name 'Harbor View Lofts'

\echo '=== 1. workflow_templates (required for dashboard groups) ==='
select
  id,
  name,
  active
from public.workflow_templates
where id in (
  'maintenance_request',
  'maintenance_intake',
  'rent_collection',
  'move_in',
  'move_out',
  'inspection'
)
order by id;

\echo '=== 1b. missing required templates ==='
select required.id as missing_template
from (
  values
    ('maintenance_request'),
    ('maintenance_intake'),
    ('rent_collection'),
    ('move_in'),
    ('move_out'),
    ('inspection')
) as required(id)
where not exists (
  select 1 from public.workflow_templates wt where wt.id = required.id
);

\echo '=== 2. lifecycle workflow_runs (seed + shape) ==='
select
  wr.id,
  wr.template_id,
  wr.status,
  wr.entity_type,
  wr.unit_id,
  wr.resident_id,
  wr.property_id,
  wr.landlord_id,
  wr.current_step,
  u.unit_label,
  u.building
from public.workflow_runs wr
left join public.units u on u.id = wr.unit_id
where wr.id in (
  'c10e0001-0001-4000-8000-000000000401'::uuid,
  'c10e0001-0001-4000-8000-000000000402'::uuid,
  'c10e0001-0001-4000-8000-000000000403'::uuid,
  'c10e0001-0001-4000-8000-000000000404'::uuid
)
order by wr.template_id;

\echo '=== 2b. workflow_run validation errors ==='
select issue
from (
  select 'missing run: move_in' as issue
  where not exists (
    select 1 from public.workflow_runs
    where id = 'c10e0001-0001-4000-8000-000000000401'::uuid and template_id = 'move_in'
  )
  union all
  select 'missing run: move_out'
  where not exists (
    select 1 from public.workflow_runs
    where id = 'c10e0001-0001-4000-8000-000000000402'::uuid and template_id = 'move_out'
  )
  union all
  select 'missing run: inspection (scheduled)'
  where not exists (
    select 1 from public.workflow_runs
    where id = 'c10e0001-0001-4000-8000-000000000403'::uuid and template_id = 'inspection'
  )
  union all
  select 'missing run: inspection (completed)'
  where not exists (
    select 1 from public.workflow_runs
    where id = 'c10e0001-0001-4000-8000-000000000404'::uuid and template_id = 'inspection'
  )
  union all
  select 'run missing landlord_id'
  where exists (
    select 1 from public.workflow_runs
    where id in (
      'c10e0001-0001-4000-8000-000000000401'::uuid,
      'c10e0001-0001-4000-8000-000000000402'::uuid,
      'c10e0001-0001-4000-8000-000000000403'::uuid,
      'c10e0001-0001-4000-8000-000000000404'::uuid
    )
    and landlord_id is null
  )
  union all
  select 'run missing unit_id'
  where exists (
    select 1 from public.workflow_runs
    where id in (
      'c10e0001-0001-4000-8000-000000000401'::uuid,
      'c10e0001-0001-4000-8000-000000000402'::uuid,
      'c10e0001-0001-4000-8000-000000000403'::uuid,
      'c10e0001-0001-4000-8000-000000000404'::uuid
    )
    and unit_id is null
  )
) checks
where issue is not null;

\echo '=== 3. property_operations_graph events per lifecycle workflow ==='
select
  wr.template_id,
  wr.id as workflow_run_id,
  count(pog.id) as graph_event_count,
  array_agg(pog.event_type order by pog.created_at) as event_types
from public.workflow_runs wr
left join public.property_operations_graph pog on pog.workflow_run_id = wr.id
where wr.id in (
  'c10e0001-0001-4000-8000-000000000401'::uuid,
  'c10e0001-0001-4000-8000-000000000402'::uuid,
  'c10e0001-0001-4000-8000-000000000403'::uuid,
  'c10e0001-0001-4000-8000-000000000404'::uuid
)
group by wr.template_id, wr.id
order by wr.template_id, wr.id;

\echo '=== 3b. workflows with zero graph events ==='
select wr.template_id, wr.id as workflow_run_id
from public.workflow_runs wr
left join public.property_operations_graph pog on pog.workflow_run_id = wr.id
where wr.id in (
  'c10e0001-0001-4000-8000-000000000401'::uuid,
  'c10e0001-0001-4000-8000-000000000402'::uuid,
  'c10e0001-0001-4000-8000-000000000403'::uuid,
  'c10e0001-0001-4000-8000-000000000404'::uuid
)
group by wr.template_id, wr.id
having count(pog.id) = 0;

\echo '=== 3c. maintenance graph event (inspection follow-up) ==='
select
  pog.event_type,
  pog.unit_id,
  pog.event_payload ->> 'maintenance_request_id' as maintenance_request_id,
  pog.event_payload ->> 'inspection_id' as inspection_id
from public.property_operations_graph pog
where pog.id = 'c10e0002-0010-4000-8000-000000000501'::uuid;

\echo '=== 4. dashboard group counts (simulated from workflow_runs) ==='
select
  case
    when wr.template_id in ('maintenance_request', 'maintenance_intake') then 'maintenance'
    when wr.template_id = 'rent_collection' then 'rent_collection'
    when wr.template_id = 'move_in' then 'move_in'
    when wr.template_id = 'move_out' then 'move_out'
    when wr.template_id in ('inspection', 'unit_inspection') then 'inspection'
    else 'other'
  end as dashboard_group,
  count(*) as run_count
from public.workflow_runs wr
where wr.landlord_id = :'seed_landlord_id'::uuid
   or wr.id in (
     'c10e0001-0001-4000-8000-000000000401'::uuid,
     'c10e0001-0001-4000-8000-000000000402'::uuid,
     'c10e0001-0001-4000-8000-000000000403'::uuid,
     'c10e0001-0001-4000-8000-000000000404'::uuid
   )
group by 1
order by 1;

\echo '=== 5. unit 204 timeline (connected events across workflows) ==='
select
  pog.created_at,
  pog.event_type,
  pog.event_source,
  pog.workflow_run_id,
  pog.event_payload ->> 'message' as message
from public.property_operations_graph pog
where pog.unit_id = 'c10e0001-0001-4000-8000-000000000204'::uuid
order by pog.created_at desc;

\echo '=== 5b. unit 204 timeline category coverage ==='
select
  split_part(pog.event_type, '.', 1) as domain,
  count(*) as event_count
from public.property_operations_graph pog
where pog.unit_id = 'c10e0001-0001-4000-8000-000000000204'::uuid
group by 1
order by 1;

\echo '=== SUMMARY ==='
select
  (select count(*) from public.workflow_templates
   where id in ('maintenance_request','maintenance_intake','rent_collection','move_in','move_out','inspection')) as templates_present,
  (select count(*) from public.workflow_runs
   where id in (
     'c10e0001-0001-4000-8000-000000000401'::uuid,
     'c10e0001-0001-4000-8000-000000000402'::uuid,
     'c10e0001-0001-4000-8000-000000000403'::uuid,
     'c10e0001-0001-4000-8000-000000000404'::uuid
   )) as lifecycle_runs_present,
  (select count(*) from public.property_operations_graph pog
   where pog.workflow_run_id in (
     'c10e0001-0001-4000-8000-000000000401'::uuid,
     'c10e0001-0001-4000-8000-000000000402'::uuid,
     'c10e0001-0001-4000-8000-000000000403'::uuid,
     'c10e0001-0001-4000-8000-000000000404'::uuid
   )) as graph_events_on_workflows,
  (select count(*) from public.property_operations_graph pog
   where pog.unit_id = 'c10e0001-0001-4000-8000-000000000204'::uuid) as unit_204_graph_events;
