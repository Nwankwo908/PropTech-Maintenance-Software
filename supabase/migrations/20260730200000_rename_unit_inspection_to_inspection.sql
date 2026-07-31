-- One-time rename: legacy workflow template id unit_inspection → inspection.
-- After this, only the canonical `inspection` id remains in live data.
-- Does not rename the unit_inspections table (inspection records).

-- Ensure the canonical template exists (idempotent with 20260605120000).
insert into public.workflow_templates (
  id,
  name,
  type,
  description,
  trigger_config,
  route_config,
  escalation_config,
  active
)
values (
  'inspection',
  'Inspection',
  'operations',
  'Unit / common-area inspection lifecycle (canonical id).',
  '{}'::jsonb,
  '{}'::jsonb,
  '{}'::jsonb,
  true
)
on conflict (id) do nothing;

-- Re-activate a deactivated legacy row long enough to rewrite FKs, if present.
update public.workflow_templates
set active = false
where id = 'unit_inspection';

-- workflow_runs (FK stays valid while both template ids exist)
update public.workflow_runs
set template_id = 'inspection'
where template_id = 'unit_inspection';

update public.workflow_runs
set workflow_type = 'inspection'
where workflow_type = 'unit_inspection';

-- Conversations linked to the old template
update public.sms_conversations
set workflow_template_id = 'inspection'
where workflow_template_id = 'unit_inspection';

-- Property operations graph
update public.operations_graph_events
set workflow_template_id = 'inspection'
where workflow_template_id = 'unit_inspection';

update public.operations_graph_events
set event_type = 'inspection' || substring(event_type from length('unit_inspection') + 1)
where event_type like 'unit_inspection.%';

-- Workflow event log
update public.workflow_events
set event_type = 'inspection' || substring(event_type from length('unit_inspection') + 1)
where event_type like 'unit_inspection.%';

-- Metadata embeds (best-effort)
update public.workflow_runs
set metadata = jsonb_set(
  metadata,
  '{source_workflow_template_id}',
  '"inspection"'::jsonb,
  true
)
where metadata->>'source_workflow_template_id' = 'unit_inspection';

update public.workflow_runs
set metadata = jsonb_set(
  metadata,
  '{source_workflow}',
  '"inspection"'::jsonb,
  true
)
where metadata->>'source_workflow' = 'unit_inspection';

-- Remove the legacy template row (no remaining FK references)
delete from public.workflow_templates
where id = 'unit_inspection';

comment on table public.unit_inspections is
  'Inspection records driven by inspection workflow runs.';
