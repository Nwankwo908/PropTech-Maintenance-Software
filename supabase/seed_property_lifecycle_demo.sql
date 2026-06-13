-- Property lifecycle demo seed: one building, four units, connected graph history.
--
-- Scenarios:
--   Unit 201 — resident moving in (active move_in workflow)
--   Unit 202 — resident moving out (active move_out workflow)
--   Unit 203 — scheduled periodic inspection
--   Unit 204 — completed inspection with issue + linked maintenance request
--
-- All domain events are written to property_operations_graph (canonical graph).
-- Matching rows are also inserted into operations_graph_events for dual-write parity.
--
-- Run after migrations:
--   psql "$DATABASE_URL" -f supabase/seed_property_lifecycle_demo.sql
-- Or paste into Supabase SQL Editor (postgres / service role).
--
-- Matches VITE_DEFAULT_LANDLORD_ID / DEFAULT_LANDLORD_ID.

do $$
declare
  seed_landlord_id uuid := '068daf53-07e4-4493-bd7f-6106e3c8c62f';
  building_name text := 'Harbor View Lofts';
  seed_property_id uuid;
  now_ts timestamptz := now();

  -- Units
  id_unit_201 uuid := 'c10e0001-0001-4000-8000-000000000201';
  id_unit_202 uuid := 'c10e0001-0001-4000-8000-000000000202';
  id_unit_203 uuid := 'c10e0001-0001-4000-8000-000000000203';
  id_unit_204 uuid := 'c10e0001-0001-4000-8000-000000000204';

  -- Residents
  id_resident_move_in uuid := 'c10e0001-0001-4000-8000-000000000101';
  id_resident_move_out uuid := 'c10e0001-0001-4000-8000-000000000102';
  id_resident_scheduled uuid := 'c10e0001-0001-4000-8000-000000000103';
  id_resident_inspection uuid := 'c10e0001-0001-4000-8000-000000000104';

  -- Occupancy
  id_occ_move_in uuid := 'c10e0001-0001-4000-8000-000000000301';
  id_occ_move_out uuid := 'c10e0001-0001-4000-8000-000000000302';
  id_occ_scheduled uuid := 'c10e0001-0001-4000-8000-000000000303';
  id_occ_inspection uuid := 'c10e0001-0001-4000-8000-000000000304';

  -- Workflow runs
  run_move_in uuid := 'c10e0001-0001-4000-8000-000000000401';
  run_move_out uuid := 'c10e0001-0001-4000-8000-000000000402';
  run_insp_scheduled uuid := 'c10e0001-0001-4000-8000-000000000403';
  run_insp_completed uuid := 'c10e0001-0001-4000-8000-000000000404';

  seed_run_ids uuid[] := array[
    run_move_in,
    run_move_out,
    run_insp_scheduled,
    run_insp_completed
  ];

  -- Inspections
  id_insp_scheduled uuid := 'c10e0001-0001-4000-8000-000000000501';
  id_insp_completed uuid := 'c10e0001-0001-4000-8000-000000000502';

  -- Maintenance ticket spawned from completed inspection
  id_ticket_inspection uuid := 'c10e0001-0001-4000-8000-000000000601';

  -- Graph event ids (property_operations_graph + operations_graph_events)
  graph_event_ids uuid[] := array[
    'c10e0002-0010-4000-8000-000000000101'::uuid,
    'c10e0002-0010-4000-8000-000000000102'::uuid,
    'c10e0002-0010-4000-8000-000000000103'::uuid,
    'c10e0002-0010-4000-8000-000000000201'::uuid,
    'c10e0002-0010-4000-8000-000000000202'::uuid,
    'c10e0002-0010-4000-8000-000000000301'::uuid,
    'c10e0002-0010-4000-8000-000000000302'::uuid,
    'c10e0002-0010-4000-8000-000000000303'::uuid,
    'c10e0002-0010-4000-8000-000000000401'::uuid,
    'c10e0002-0010-4000-8000-000000000402'::uuid,
    'c10e0002-0010-4000-8000-000000000403'::uuid,
    'c10e0002-0010-4000-8000-000000000501'::uuid
  ];
begin
  if not exists (select 1 from public.workflow_templates where id = 'move_in') then
    raise exception 'move_in template missing — run migrations first';
  end if;

  seed_property_id := public.derive_property_id(seed_landlord_id, building_name);

  -- -------------------------------------------------------------------------
  -- Cleanup (idempotent re-run)
  -- -------------------------------------------------------------------------
  delete from public.property_operations_graph
  where id = any (graph_event_ids);

  delete from public.operations_graph_events
  where id = any (graph_event_ids);

  delete from public.workflow_events
  where workflow_run_id = any (seed_run_ids);

  delete from public.maintenance_requests
  where id = id_ticket_inspection;

  delete from public.unit_inspections
  where id in (id_insp_scheduled, id_insp_completed);

  delete from public.workflow_runs
  where id = any (seed_run_ids);

  -- -------------------------------------------------------------------------
  -- Units — one property (Harbor View Lofts), four units
  -- -------------------------------------------------------------------------
  insert into public.units (id, landlord_id, unit_label, building, status)
  values
    (id_unit_201, seed_landlord_id, '201', building_name, 'inactive'),
    (id_unit_202, seed_landlord_id, '202', building_name, 'active'),
    (id_unit_203, seed_landlord_id, '203', building_name, 'active'),
    (id_unit_204, seed_landlord_id, '204', building_name, 'active')
  on conflict (id) do update set
    landlord_id = excluded.landlord_id,
    unit_label = excluded.unit_label,
    building = excluded.building,
    status = excluded.status,
    updated_at = now();

  -- -------------------------------------------------------------------------
  -- Residents
  -- -------------------------------------------------------------------------
  insert into public.users (
    id, resident_id, full_name, email, phone, unit, building, status, balance_due
  )
  values
    (
      id_resident_move_in,
      'harbor-move-in',
      'Alex Rivera',
      'harbor-move-in@example.com',
      '+15555552001',
      '201',
      building_name,
      'pending',
      0
    ),
    (
      id_resident_move_out,
      'harbor-move-out',
      'Taylor Morgan',
      'harbor-move-out@example.com',
      '+15555552002',
      '202',
      building_name,
      'active',
      0
    ),
    (
      id_resident_scheduled,
      'harbor-scheduled-insp',
      'Sam Park',
      'harbor-scheduled-insp@example.com',
      '+15555552003',
      '203',
      building_name,
      'active',
      0
    ),
    (
      id_resident_inspection,
      'harbor-inspection-issue',
      'Jordan Kim',
      'harbor-inspection-issue@example.com',
      '+15555552004',
      '204',
      building_name,
      'active',
      0
    )
  on conflict (id) do update set
    resident_id = excluded.resident_id,
    full_name = excluded.full_name,
    email = excluded.email,
    phone = excluded.phone,
    unit = excluded.unit,
    building = excluded.building,
    status = excluded.status,
    balance_due = excluded.balance_due;

  -- -------------------------------------------------------------------------
  -- Occupancy periods
  -- -------------------------------------------------------------------------
  insert into public.occupancy (
    id, landlord_id, unit_id, resident_id, move_in_date, move_out_date, status
  )
  values
    (
      id_occ_move_in,
      seed_landlord_id,
      id_unit_201,
      id_resident_move_in,
      (current_date + interval '7 days')::date,
      null,
      'active'
    ),
    (
      id_occ_move_out,
      seed_landlord_id,
      id_unit_202,
      id_resident_move_out,
      (current_date - interval '400 days')::date,
      (current_date + interval '14 days')::date,
      'active'
    ),
    (
      id_occ_scheduled,
      seed_landlord_id,
      id_unit_203,
      id_resident_scheduled,
      (current_date - interval '200 days')::date,
      null,
      'active'
    ),
    (
      id_occ_inspection,
      seed_landlord_id,
      id_unit_204,
      id_resident_inspection,
      (current_date - interval '300 days')::date,
      null,
      'active'
    )
  on conflict (id) do update set
    landlord_id = excluded.landlord_id,
    unit_id = excluded.unit_id,
    resident_id = excluded.resident_id,
    move_in_date = excluded.move_in_date,
    move_out_date = excluded.move_out_date,
    status = excluded.status;

  -- -------------------------------------------------------------------------
  -- Workflow runs
  -- -------------------------------------------------------------------------
  insert into public.workflow_runs (
    id,
    template_id,
    status,
    entity_type,
    entity_id,
    property_id,
    unit_id,
    resident_id,
    landlord_id,
    trigger_type,
    workflow_type,
    current_stage,
    current_step,
    started_at,
    completed_at,
    metadata
  )
  values
    (
      run_move_in,
      'move_in',
      'active',
      'occupancy',
      id_occ_move_in,
      seed_property_id,
      id_unit_201,
      id_resident_move_in,
      seed_landlord_id,
      'dashboard',
      'move_in',
      'initiated',
      'checklist_sent',
      now_ts - interval '5 days',
      null,
      jsonb_build_object(
        'landlord_id', seed_landlord_id,
        'unit_label', '201',
        'building', building_name,
        'move_in_date', (current_date + interval '7 days')::text,
        'occupancy_id', id_occ_move_in,
        'move_in_classification', 'new_lease',
        'step_state', jsonb_build_object(
          'step', 'checklist_sent',
          'move_in_date', (current_date + interval '7 days')::text
        )
      )
    ),
    (
      run_move_out,
      'move_out',
      'active',
      'occupancy',
      id_occ_move_out,
      seed_property_id,
      id_unit_202,
      id_resident_move_out,
      seed_landlord_id,
      'dashboard',
      'move_out',
      'notice_sent',
      'turnover_tasks',
      now_ts - interval '21 days',
      null,
      jsonb_build_object(
        'landlord_id', seed_landlord_id,
        'unit_label', '202',
        'building', building_name,
        'move_out_date', (current_date + interval '14 days')::text,
        'occupancy_id', id_occ_move_out,
        'move_out_classification', 'voluntary_move_out',
        'step_state', jsonb_build_object(
          'step', 'turnover_tasks',
          'move_out_date', (current_date + interval '14 days')::text
        )
      )
    ),
    (
      run_insp_scheduled,
      'inspection',
      'active',
      'inspection',
      id_insp_scheduled,
      seed_property_id,
      id_unit_203,
      id_resident_scheduled,
      seed_landlord_id,
      'dashboard',
      'inspection',
      'scheduled',
      'notice_sent',
      now_ts - interval '10 days',
      null,
      jsonb_build_object(
        'landlord_id', seed_landlord_id,
        'unit_label', '203',
        'building', building_name,
        'inspection_id', id_insp_scheduled,
        'inspection_type', 'periodic',
        'scheduled_at', (now_ts + interval '5 days')::text,
        'occupancy_id', id_occ_scheduled,
        'inspection_classification', 'periodic',
        'step_state', jsonb_build_object(
          'step', 'notice_sent',
          'scheduled_at', (now_ts + interval '5 days')::text
        )
      )
    ),
    (
      run_insp_completed,
      'inspection',
      'completed',
      'inspection',
      id_insp_completed,
      seed_property_id,
      id_unit_204,
      id_resident_inspection,
      seed_landlord_id,
      'dashboard',
      'inspection',
      'completed',
      'completed',
      now_ts - interval '14 days',
      now_ts - interval '3 days',
      jsonb_build_object(
        'landlord_id', seed_landlord_id,
        'unit_label', '204',
        'building', building_name,
        'inspection_id', id_insp_completed,
        'inspection_type', 'annual',
        'scheduled_at', (now_ts - interval '7 days')::text,
        'occupancy_id', id_occ_inspection,
        'inspection_classification', 'annual',
        'issue_found', true,
        'findings', jsonb_build_array(
          'Water damage under kitchen sink',
          'Soft cabinet base panel'
        ),
        'linked_maintenance_request_id', id_ticket_inspection,
        'step_state', jsonb_build_object(
          'step', 'completed',
          'issue_found', true
        )
      )
    )
  on conflict (id) do update set
    template_id = excluded.template_id,
    status = excluded.status,
    entity_type = excluded.entity_type,
    entity_id = excluded.entity_id,
    property_id = excluded.property_id,
    unit_id = excluded.unit_id,
    resident_id = excluded.resident_id,
    landlord_id = excluded.landlord_id,
    trigger_type = excluded.trigger_type,
    workflow_type = excluded.workflow_type,
    current_stage = excluded.current_stage,
    current_step = excluded.current_step,
    started_at = excluded.started_at,
    completed_at = excluded.completed_at,
    metadata = excluded.metadata;

  -- -------------------------------------------------------------------------
  -- Inspection records
  -- -------------------------------------------------------------------------
  insert into public.unit_inspections (
    id,
    landlord_id,
    inspection_type,
    status,
    workflow_run_id,
    property_id,
    unit_id,
    resident_id,
    occupancy_id,
    scheduled_at,
    notice_sent_at,
    completed_at,
    inspector_name,
    metadata
  )
  values
    (
      id_insp_scheduled,
      seed_landlord_id,
      'periodic',
      'notice_sent',
      run_insp_scheduled,
      seed_property_id,
      id_unit_203,
      id_resident_scheduled,
      id_occ_scheduled,
      now_ts + interval '5 days',
      now_ts - interval '2 days',
      null,
      'Harbor Inspections LLC',
      jsonb_build_object(
        'building', building_name,
        'unit_label', '203'
      )
    ),
    (
      id_insp_completed,
      seed_landlord_id,
      'annual',
      'completed',
      run_insp_completed,
      seed_property_id,
      id_unit_204,
      id_resident_inspection,
      id_occ_inspection,
      now_ts - interval '7 days',
      now_ts - interval '8 days',
      now_ts - interval '3 days',
      'Harbor Inspections LLC',
      jsonb_build_object(
        'building', building_name,
        'unit_label', '204',
        'issue_found', true,
        'findings', jsonb_build_array(
          'Water damage under kitchen sink',
          'Soft cabinet base panel'
        ),
        'linked_maintenance_request_id', id_ticket_inspection
      )
    )
  on conflict (id) do update set
    landlord_id = excluded.landlord_id,
    inspection_type = excluded.inspection_type,
    status = excluded.status,
    workflow_run_id = excluded.workflow_run_id,
    property_id = excluded.property_id,
    unit_id = excluded.unit_id,
    resident_id = excluded.resident_id,
    occupancy_id = excluded.occupancy_id,
    scheduled_at = excluded.scheduled_at,
    notice_sent_at = excluded.notice_sent_at,
    completed_at = excluded.completed_at,
    inspector_name = excluded.inspector_name,
    metadata = excluded.metadata,
    updated_at = now();

  -- -------------------------------------------------------------------------
  -- Maintenance request linked to completed inspection
  -- -------------------------------------------------------------------------
  insert into public.maintenance_requests (
    id,
    created_at,
    priority,
    urgency,
    severity,
    resident_name,
    email,
    resident_phone,
    unit,
    description,
    resident_user_id,
    vendor_work_status,
    issue_category
  )
  values (
    id_ticket_inspection,
    now_ts - interval '2 days',
    'normal',
    'normal',
    'normal',
    'Jordan Kim',
    'harbor-inspection-issue@example.com',
    '+15555552004',
    '204',
    'Kitchen sink leak and cabinet water damage — flagged during annual unit inspection.',
    id_resident_inspection,
    'unassigned',
    'plumbing'
  )
  on conflict (id) do update set
    created_at = excluded.created_at,
    priority = excluded.priority,
    urgency = excluded.urgency,
    severity = excluded.severity,
    resident_name = excluded.resident_name,
    email = excluded.email,
    resident_phone = excluded.resident_phone,
    unit = excluded.unit,
    description = excluded.description,
    resident_user_id = excluded.resident_user_id,
    vendor_work_status = excluded.vendor_work_status,
    issue_category = excluded.issue_category;

  -- -------------------------------------------------------------------------
  -- Workflow timeline events (admin workflow dashboard)
  -- -------------------------------------------------------------------------
  insert into public.workflow_events (
    id,
    workflow_run_id,
    event_type,
    step,
    stage,
    actor_type,
    message,
    landlord_id,
    workflow_type,
    created_at
  )
  values
    (
      'c10e0003-0020-4000-8000-000000000101',
      run_move_in,
      'move_in.started',
      'initiated',
      'trigger',
      'system',
      'Move-in workflow started for Alex Rivera (Unit 201).',
      seed_landlord_id,
      'move_in',
      now_ts - interval '5 days'
    ),
    (
      'c10e0003-0020-4000-8000-000000000102',
      run_move_in,
      'move_in.checklist_sent',
      'checklist_sent',
      'route',
      'system',
      'Move-in checklist sent to Alex Rivera.',
      seed_landlord_id,
      'move_in',
      now_ts - interval '3 days'
    ),
    (
      'c10e0003-0020-4000-8000-000000000201',
      run_move_out,
      'move_out.started',
      'initiated',
      'trigger',
      'system',
      'Move-out workflow started for Taylor Morgan (Unit 202).',
      seed_landlord_id,
      'move_out',
      now_ts - interval '21 days'
    ),
    (
      'c10e0003-0020-4000-8000-000000000202',
      run_move_out,
      'move_out.notice_sent',
      'notice_sent',
      'route',
      'system',
      'Move-out notice and turnover checklist sent.',
      seed_landlord_id,
      'move_out',
      now_ts - interval '14 days'
    ),
    (
      'c10e0003-0020-4000-8000-000000000301',
      run_insp_scheduled,
      'inspection.started',
      'scheduled',
      'trigger',
      'system',
      'Periodic inspection workflow started for Unit 203.',
      seed_landlord_id,
      'inspection',
      now_ts - interval '10 days'
    ),
    (
      'c10e0003-0020-4000-8000-000000000302',
      run_insp_scheduled,
      'inspection.notice_sent',
      'notice_sent',
      'route',
      'system',
      'Inspection notice sent to Sam Park.',
      seed_landlord_id,
      'inspection',
      now_ts - interval '2 days'
    ),
    (
      'c10e0003-0020-4000-8000-000000000401',
      run_insp_completed,
      'inspection.completed',
      'completed',
      'act',
      'system',
      'Annual inspection completed — plumbing issue found under kitchen sink.',
      seed_landlord_id,
      'inspection',
      now_ts - interval '3 days'
    )
  on conflict (id) do update set
    workflow_run_id = excluded.workflow_run_id,
    event_type = excluded.event_type,
    step = excluded.step,
    stage = excluded.stage,
    actor_type = excluded.actor_type,
    message = excluded.message,
    landlord_id = excluded.landlord_id,
    workflow_type = excluded.workflow_type,
    created_at = excluded.created_at;

  -- -------------------------------------------------------------------------
  -- property_operations_graph — canonical connected history (same property_id)
  -- -------------------------------------------------------------------------
  insert into public.property_operations_graph (
    id,
    landlord_id,
    property_id,
    unit_id,
    resident_id,
    workflow_run_id,
    event_type,
    event_source,
    event_payload,
    created_at
  )
  values
    -- Move in — Unit 201
    (
      'c10e0002-0010-4000-8000-000000000101',
      seed_landlord_id,
      seed_property_id,
      id_unit_201,
      id_resident_move_in,
      run_move_in,
      'move_in.started',
      'dashboard',
      jsonb_build_object(
        'message', 'Move-in workflow started for Alex Rivera (Unit 201).',
        'workflow_template_id', 'move_in',
        'occupancy_id', id_occ_move_in,
        'unit_label', '201',
        'building', building_name,
        'move_in_date', (current_date + interval '7 days')::text
      ),
      now_ts - interval '5 days'
    ),
    (
      'c10e0002-0010-4000-8000-000000000102',
      seed_landlord_id,
      seed_property_id,
      id_unit_201,
      id_resident_move_in,
      run_move_in,
      'move_in.checklist_sent',
      'dashboard',
      jsonb_build_object(
        'message', 'Move-in checklist sent to Alex Rivera.',
        'workflow_template_id', 'move_in',
        'occupancy_id', id_occ_move_in,
        'unit_label', '201',
        'building', building_name
      ),
      now_ts - interval '3 days'
    ),
    (
      'c10e0002-0010-4000-8000-000000000103',
      seed_landlord_id,
      seed_property_id,
      id_unit_201,
      id_resident_move_in,
      run_move_in,
      'move_in.unit_activated',
      'dashboard',
      jsonb_build_object(
        'message', 'Unit 201 prepared for move-in; keys scheduled for handoff.',
        'workflow_template_id', 'move_in',
        'occupancy_id', id_occ_move_in,
        'unit_label', '201',
        'building', building_name
      ),
      now_ts - interval '1 day'
    ),
    -- Move out — Unit 202
    (
      'c10e0002-0010-4000-8000-000000000201',
      seed_landlord_id,
      seed_property_id,
      id_unit_202,
      id_resident_move_out,
      run_move_out,
      'move_out.started',
      'dashboard',
      jsonb_build_object(
        'message', 'Move-out workflow started for Taylor Morgan (Unit 202).',
        'workflow_template_id', 'move_out',
        'occupancy_id', id_occ_move_out,
        'unit_label', '202',
        'building', building_name,
        'move_out_date', (current_date + interval '14 days')::text
      ),
      now_ts - interval '21 days'
    ),
    (
      'c10e0002-0010-4000-8000-000000000202',
      seed_landlord_id,
      seed_property_id,
      id_unit_202,
      id_resident_move_out,
      run_move_out,
      'move_out.notice_sent',
      'dashboard',
      jsonb_build_object(
        'message', 'Move-out notice and turnover checklist sent to Taylor Morgan.',
        'workflow_template_id', 'move_out',
        'occupancy_id', id_occ_move_out,
        'unit_label', '202',
        'building', building_name,
        'move_out_date', (current_date + interval '14 days')::text
      ),
      now_ts - interval '14 days'
    ),
    -- Scheduled inspection — Unit 203
    (
      'c10e0002-0010-4000-8000-000000000301',
      seed_landlord_id,
      seed_property_id,
      id_unit_203,
      id_resident_scheduled,
      run_insp_scheduled,
      'inspection.started',
      'dashboard',
      jsonb_build_object(
        'message', 'Periodic inspection workflow started for Unit 203.',
        'workflow_template_id', 'inspection',
        'inspection_id', id_insp_scheduled,
        'occupancy_id', id_occ_scheduled,
        'unit_label', '203',
        'building', building_name,
        'inspection_type', 'periodic'
      ),
      now_ts - interval '10 days'
    ),
    (
      'c10e0002-0010-4000-8000-000000000302',
      seed_landlord_id,
      seed_property_id,
      id_unit_203,
      id_resident_scheduled,
      run_insp_scheduled,
      'inspection.scheduled',
      'dashboard',
      jsonb_build_object(
        'message', 'Inspection scheduled for ' || to_char(now_ts + interval '5 days', 'Mon DD, YYYY'),
        'workflow_template_id', 'inspection',
        'inspection_id', id_insp_scheduled,
        'occupancy_id', id_occ_scheduled,
        'scheduled_at', (now_ts + interval '5 days')::text,
        'unit_label', '203',
        'building', building_name
      ),
      now_ts - interval '8 days'
    ),
    (
      'c10e0002-0010-4000-8000-000000000303',
      seed_landlord_id,
      seed_property_id,
      id_unit_203,
      id_resident_scheduled,
      run_insp_scheduled,
      'inspection.notice_sent',
      'dashboard',
      jsonb_build_object(
        'message', 'Inspection notice sent to Sam Park.',
        'workflow_template_id', 'inspection',
        'inspection_id', id_insp_scheduled,
        'occupancy_id', id_occ_scheduled,
        'unit_label', '203',
        'building', building_name
      ),
      now_ts - interval '2 days'
    ),
    -- Completed inspection — Unit 204
    (
      'c10e0002-0010-4000-8000-000000000401',
      seed_landlord_id,
      seed_property_id,
      id_unit_204,
      id_resident_inspection,
      run_insp_completed,
      'inspection.started',
      'dashboard',
      jsonb_build_object(
        'message', 'Annual inspection workflow started for Unit 204.',
        'workflow_template_id', 'inspection',
        'inspection_id', id_insp_completed,
        'occupancy_id', id_occ_inspection,
        'unit_label', '204',
        'building', building_name,
        'inspection_type', 'annual'
      ),
      now_ts - interval '14 days'
    ),
    (
      'c10e0002-0010-4000-8000-000000000402',
      seed_landlord_id,
      seed_property_id,
      id_unit_204,
      id_resident_inspection,
      run_insp_completed,
      'inspection.scheduled',
      'dashboard',
      jsonb_build_object(
        'message', 'Annual inspection scheduled for Unit 204.',
        'workflow_template_id', 'inspection',
        'inspection_id', id_insp_completed,
        'scheduled_at', (now_ts - interval '7 days')::text,
        'unit_label', '204',
        'building', building_name
      ),
      now_ts - interval '10 days'
    ),
    (
      'c10e0002-0010-4000-8000-000000000403',
      seed_landlord_id,
      seed_property_id,
      id_unit_204,
      id_resident_inspection,
      run_insp_completed,
      'inspection.completed',
      'dashboard',
      jsonb_build_object(
        'message', 'Inspection completed — plumbing issue found under kitchen sink.',
        'workflow_template_id', 'inspection',
        'inspection_id', id_insp_completed,
        'occupancy_id', id_occ_inspection,
        'issue_found', true,
        'findings', jsonb_build_array(
          'Water damage under kitchen sink',
          'Soft cabinet base panel'
        ),
        'linked_maintenance_request_id', id_ticket_inspection,
        'unit_label', '204',
        'building', building_name
      ),
      now_ts - interval '3 days'
    ),
    -- Maintenance spawned from inspection — Unit 204
    (
      'c10e0002-0010-4000-8000-000000000501',
      seed_landlord_id,
      seed_property_id,
      id_unit_204,
      id_resident_inspection,
      null,
      'maintenance.request_submitted',
      'dashboard',
      jsonb_build_object(
        'message', 'Maintenance request opened from inspection finding (kitchen sink leak).',
        'maintenance_request_id', id_ticket_inspection,
        'inspection_id', id_insp_completed,
        'workflow_template_id', 'maintenance_request',
        'unit_label', '204',
        'building', building_name,
        'issue_category', 'plumbing',
        'source', 'inspection_follow_up'
      ),
      now_ts - interval '2 days'
    )
  on conflict (id) do update set
    landlord_id = excluded.landlord_id,
    property_id = excluded.property_id,
    unit_id = excluded.unit_id,
    resident_id = excluded.resident_id,
    workflow_run_id = excluded.workflow_run_id,
    event_type = excluded.event_type,
    event_source = excluded.event_source,
    event_payload = excluded.event_payload,
    created_at = excluded.created_at;

  -- -------------------------------------------------------------------------
  -- operations_graph_events — dual-write parity during migration
  -- -------------------------------------------------------------------------
  insert into public.operations_graph_events (
    id,
    landlord_id,
    event_type,
    source,
    actor_type,
    property_id,
    unit_id,
    resident_id,
    workflow_run_id,
    workflow_template_id,
    maintenance_request_id,
    inspection_id,
    occupancy_id,
    metadata,
    created_at
  )
  select
    pog.id,
    pog.landlord_id,
    pog.event_type,
    pog.event_source,
    'system',
    pog.property_id,
    pog.unit_id,
    pog.resident_id,
    pog.workflow_run_id,
    pog.event_payload ->> 'workflow_template_id',
    nullif(pog.event_payload ->> 'maintenance_request_id', '')::uuid,
    nullif(pog.event_payload ->> 'inspection_id', '')::uuid,
    nullif(pog.event_payload ->> 'occupancy_id', '')::uuid,
    pog.event_payload,
    pog.created_at
  from public.property_operations_graph pog
  where pog.id = any (graph_event_ids)
  on conflict (id) do update set
    landlord_id = excluded.landlord_id,
    event_type = excluded.event_type,
    source = excluded.source,
    property_id = excluded.property_id,
    unit_id = excluded.unit_id,
    resident_id = excluded.resident_id,
    workflow_run_id = excluded.workflow_run_id,
    workflow_template_id = excluded.workflow_template_id,
    maintenance_request_id = excluded.maintenance_request_id,
    inspection_id = excluded.inspection_id,
    occupancy_id = excluded.occupancy_id,
    metadata = excluded.metadata,
    created_at = excluded.created_at;

  raise notice 'Harbor View Lofts lifecycle demo seeded (property_id=%).', seed_property_id;
end $$;
