-- =============================================================================
-- Demo patch: swap overdue inspection card (wr_insp3) → gas-smell WO (t05)
-- Safe to run without a full landlord account reseed.
-- =============================================================================

do $$
declare
  demo_landlord uuid := 'de300000-0000-4000-8000-000000000001';
  now_ts timestamptz := now();
  wr_insp3 uuid := md5('ulo-demo-run-insp-3')::uuid;
  t05 uuid := md5('ulo-demo-ticket-05')::uuid;
  insp_overdue uuid := md5('ulo-demo-insp-overdue')::uuid;
  r_kowalski uuid := md5('ulo-demo-res-piotr-kowalski')::uuid;
  p_pine uuid;
  u_pine_305 uuid;
begin
  if not exists (select 1 from public.landlords where id = demo_landlord) then
    raise exception 'demo landlord missing';
  end if;

  select id into p_pine from public.properties
    where landlord_id = demo_landlord and name = 'Pine Ridge' limit 1;
  select id into u_pine_305 from public.units
    where landlord_id = demo_landlord and building = 'Pine Ridge' and unit_label = '305';

  if p_pine is null or u_pine_305 is null then
    raise exception 'Pine Ridge / unit 305 missing — run seed_demo_landlord_account.sql first';
  end if;

  -- Drop orphaned overdue inspection record (run is now a maintenance WO).
  delete from public.unit_inspections
  where id = insp_overdue and landlord_id = demo_landlord;

  update public.workflow_runs
  set
    template_id = 'maintenance_intake',
    status = 'active',
    entity_type = 'maintenance_request',
    entity_id = t05,
    property_id = p_pine,
    unit_id = u_pine_305,
    resident_id = r_kowalski,
    landlord_id = demo_landlord,
    trigger_type = 'sms_inbound',
    workflow_type = 'maintenance',
    current_stage = 'routed',
    current_step = 'vendor_dispatch',
    started_at = now_ts - interval '70 minutes',
    completed_at = null,
    metadata = jsonb_build_object(
      'landlord_id', demo_landlord,
      'unit_label', '305',
      'building', 'Pine Ridge',
      'maintenance_request_id', t05,
      'issue_category', 'general',
      'urgency', 'urgent',
      'due_at', (now_ts + interval '2 hours')::text
    )
  where id = wr_insp3 and landlord_id = demo_landlord;

  if not found then
    insert into public.workflow_runs (
      id, template_id, status, entity_type, entity_id, property_id, unit_id,
      resident_id, landlord_id, trigger_type, workflow_type, current_stage,
      current_step, started_at, completed_at, metadata
    )
    values (
      wr_insp3, 'maintenance_intake', 'active', 'maintenance_request', t05,
      p_pine, u_pine_305, r_kowalski, demo_landlord, 'sms_inbound', 'maintenance',
      'routed', 'vendor_dispatch', now_ts - interval '70 minutes', null,
      jsonb_build_object(
        'landlord_id', demo_landlord, 'unit_label', '305', 'building', 'Pine Ridge',
        'maintenance_request_id', t05, 'issue_category', 'general', 'urgency', 'urgent',
        'due_at', (now_ts + interval '2 hours')::text
      )
    );
  end if;

  delete from public.workflow_events where workflow_run_id = wr_insp3;

  insert into public.workflow_events (
    id, workflow_run_id, event_type, step, stage, actor_type, message,
    landlord_id, workflow_type, created_at
  )
  values
    (md5('ulo-demo-wfe-insp3-1')::uuid, wr_insp3, 'workflow.trigger', 'intake', 'trigger', 'system',
     'Urgent gas-smell request received from Piotr Kowalski (Pine Ridge 305).',
     demo_landlord, 'maintenance', now_ts - interval '70 minutes'),
    (md5('ulo-demo-wfe-insp3-2')::uuid, wr_insp3, 'workflow.classify', 'classified', 'classify', 'system',
     'Classified urgent / general. SLA due in 2 hours.',
     demo_landlord, 'maintenance', now_ts - interval '68 minutes')
  on conflict (id) do update set
    event_type = excluded.event_type,
    step = excluded.step,
    stage = excluded.stage,
    message = excluded.message,
    workflow_type = excluded.workflow_type,
    created_at = excluded.created_at;

  if to_regclass('public.property_operations_graph') is not null then
    delete from public.property_operations_graph
    where id = md5('ulo-demo-graph-feed-7')::uuid;

    insert into public.property_operations_graph (
      id, landlord_id, property_id, unit_id, resident_id, vendor_id,
      workflow_run_id, event_type, event_source, event_payload, created_at
    )
    values (
      md5('ulo-demo-graph-feed-7')::uuid, demo_landlord, p_pine, u_pine_305, r_kowalski, null, wr_insp3,
      'maintenance.ticket_created', 'sms',
      jsonb_build_object(
        'message', 'Urgent gas-smell ticket created from SMS — Pine Ridge 305.',
        'maintenance_request_id', t05, 'unit_label', '305', 'building', 'Pine Ridge', 'urgency', 'urgent'
      ),
      now_ts - interval '70 minutes'
    );
  end if;

  raise notice 'Swapped wr_insp3 inspection → t05 gas-smell WO';
end $$;
