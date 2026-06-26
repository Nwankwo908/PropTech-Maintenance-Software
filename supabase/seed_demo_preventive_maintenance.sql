-- Demo PM compliance pipeline: unit_assets → preventive_maintenance_tasks → workflow_runs.
-- Aligned with Property Health PM compliance (20% weight): every portfolio building has
-- preventive tasks; mix of completed, assigned, and scheduled/overdue statuses.
-- Run after seed_demo_landlord_account.sql and migrations through 20260617140000.

do $$
declare
  demo_landlord uuid := 'de300000-0000-4000-8000-000000000001';
  now_ts timestamptz := now();
  v_summit uuid := md5('ulo-demo-vendor-summit-hvac')::uuid;

  -- Property assets
  asset_furnace uuid := md5('ulo-demo-asset-furnace-willow-201')::uuid;
  asset_water uuid := md5('ulo-demo-asset-water-heater-maple-312')::uuid;
  asset_hvac uuid := md5('ulo-demo-asset-hvac-birch-107')::uuid;
  asset_electrical uuid := md5('ulo-demo-pm-electrical-cedar-305')::uuid;
  asset_roof uuid := md5('ulo-demo-pm-roof-birch-common')::uuid;
  asset_smoke uuid := md5('ulo-demo-pm-smoke-oak-304')::uuid;
  asset_boiler uuid := md5('ulo-demo-pm-boiler-pine-301')::uuid;
  asset_co uuid := md5('ulo-demo-pm-co-pine-common')::uuid;
  asset_dryer uuid := md5('ulo-demo-pm-dryer-oak-common')::uuid;
  asset_filter uuid := md5('ulo-demo-pm-filter-maple-common')::uuid;
  asset_furnace_tune uuid := md5('ulo-demo-pm-furnace-tune-willow-201')::uuid;

  -- Preventive tasks (same ids for stable workflow entity_id)
  task_furnace uuid := md5('ulo-demo-pm-task-furnace')::uuid;
  task_water uuid := md5('ulo-demo-pm-task-water-heater')::uuid;
  task_hvac uuid := md5('ulo-demo-pm-task-hvac')::uuid;
  task_electrical uuid := md5('ulo-demo-pm-task-electrical')::uuid;
  task_roof uuid := md5('ulo-demo-pm-task-roof')::uuid;
  task_smoke uuid := md5('ulo-demo-pm-task-smoke')::uuid;
  task_boiler uuid := md5('ulo-demo-pm-task-boiler-pine')::uuid;
  task_co uuid := md5('ulo-demo-pm-task-co-pine')::uuid;
  task_dryer uuid := md5('ulo-demo-pm-task-dryer-oak')::uuid;
  task_filter uuid := md5('ulo-demo-pm-task-filter-maple')::uuid;
  task_furnace_tune uuid := md5('ulo-demo-pm-task-furnace-tune')::uuid;

  -- Workflow runs
  wr_furnace uuid := md5('ulo-demo-pm-wr-furnace')::uuid;
  wr_water uuid := md5('ulo-demo-pm-wr-water')::uuid;
  wr_hvac uuid := md5('ulo-demo-pm-wr-hvac')::uuid;
  wr_electrical uuid := md5('ulo-demo-pm-wr-electrical')::uuid;
  wr_roof uuid := md5('ulo-demo-pm-wr-roof')::uuid;
  wr_smoke uuid := md5('ulo-demo-pm-wr-smoke')::uuid;
  wr_boiler uuid := md5('ulo-demo-pm-wr-boiler-pine')::uuid;
  wr_co uuid := md5('ulo-demo-pm-wr-co-pine')::uuid;
  wr_dryer uuid := md5('ulo-demo-pm-wr-dryer-oak')::uuid;
  wr_filter uuid := md5('ulo-demo-pm-wr-filter-maple')::uuid;
  wr_furnace_tune uuid := md5('ulo-demo-pm-wr-furnace-tune')::uuid;
begin
  if to_regclass('public.preventive_maintenance_tasks') is null then
    raise notice 'preventive_maintenance_tasks missing — run migrations first';
    return;
  end if;

  delete from public.preventive_maintenance_tasks where landlord_id = demo_landlord;
  delete from public.workflow_runs
  where landlord_id = demo_landlord and template_id = 'preventive_maintenance';
  delete from public.unit_assets where landlord_id = demo_landlord;

  -- Property assets (registry only — tasks carry due dates) -------------------
  insert into public.unit_assets (
    id, landlord_id, unit_label, building, appliance_type, appliance_label,
    estimated_age_years, useful_life_years, failure_risk_pct, failure_prediction_window,
    replacement_recommended, replacement_urgency, estimated_replacement_cost,
    detection_source, task_kind, metadata
  )
  values
    (asset_furnace, demo_landlord, '201', 'Willow Park', 'furnace', 'Gas furnace',
     18.0, 15.0, 85, '1–3 months', true, 'immediate', 4200.00, 'photo_ai', 'appliance',
     jsonb_build_object('seed', 'demo_preventive_maintenance')),
    (asset_water, demo_landlord, '312', 'Maple Heights', 'water_heater', 'Water heater',
     14.0, 12.0, 78, '3–6 months', true, 'soon', 1450.00, 'photo_ai', 'appliance',
     jsonb_build_object('seed', 'demo_preventive_maintenance')),
    (asset_hvac, demo_landlord, '107', 'Birch Tower', 'hvac_condenser', 'HVAC condenser',
     12.0, 15.0, 62, '6–9 months', true, 'soon', 3800.00, 'photo_ai', 'appliance',
     jsonb_build_object('seed', 'demo_preventive_maintenance')),
    (asset_electrical, demo_landlord, '305', 'Cedar Court', 'electrical_inspection', 'Electrical inspection',
     0, 1.0, 0, 'Annual cycle', false, 'monitor', null, 'inspection', 'inspection',
     jsonb_build_object('seed', 'demo_preventive_maintenance')),
    (asset_roof, demo_landlord, null, 'Birch Tower', 'roof_inspection', 'Roof inspection',
     0, 1.0, 0, 'Annual cycle', false, 'monitor', null, 'inspection', 'inspection',
     jsonb_build_object('seed', 'demo_preventive_maintenance', 'scope', 'common_area')),
    (asset_smoke, demo_landlord, '304', 'Oakwood Apartments', 'smoke_detector_test', 'Smoke detector test',
     0, 1.0, 0, 'Semi-annual', false, 'monitor', null, 'inspection', 'inspection',
     jsonb_build_object('seed', 'demo_preventive_maintenance')),
    (asset_boiler, demo_landlord, '301', 'Pine Ridge', 'boiler_service', 'Boiler annual service',
     0, 1.0, 0, 'Annual cycle', false, 'monitor', null, 'inspection', 'service',
     jsonb_build_object('seed', 'demo_preventive_maintenance')),
    (asset_co, demo_landlord, null, 'Pine Ridge', 'co_detector_test', 'Corridor CO detector test',
     0, 1.0, 0, 'Annual cycle', false, 'monitor', null, 'inspection', 'inspection',
     jsonb_build_object('seed', 'demo_preventive_maintenance', 'scope', 'common_area')),
    (asset_dryer, demo_landlord, null, 'Oakwood Apartments', 'dryer_vent_cleaning', 'Common laundry dryer vent cleaning',
     0, 1.0, 0, 'Semi-annual', false, 'monitor', null, 'inspection', 'service',
     jsonb_build_object('seed', 'demo_preventive_maintenance', 'scope', 'common_area')),
    (asset_filter, demo_landlord, null, 'Maple Heights', 'hvac_filter_change', 'Quarterly HVAC filter change',
     0, 0.25, 0, 'Quarterly cycle', false, 'monitor', null, 'inspection', 'service',
     jsonb_build_object('seed', 'demo_preventive_maintenance', 'scope', 'common_area')),
    (asset_furnace_tune, demo_landlord, '201', 'Willow Park', 'furnace_tune', 'Annual furnace tune-up',
     0, 1.0, 0, 'Annual cycle', false, 'monitor', null, 'inspection', 'service',
     jsonb_build_object('seed', 'demo_preventive_maintenance'));

  -- Workflow runs -------------------------------------------------------------
  insert into public.workflow_runs (
    id, template_id, status, entity_type, entity_id, landlord_id, trigger_type,
    workflow_type, current_step, current_stage, started_at, completed_at, metadata
  )
  values
    (wr_furnace, 'preventive_maintenance', 'active', 'preventive_maintenance_task', task_furnace,
     demo_landlord, 'automation', 'preventive_maintenance', 'assign_vendor', 'route',
     now_ts - interval '8 days', null,
     jsonb_build_object('landlord_id', demo_landlord, 'unit_label', '201', 'building', 'Willow Park',
       'task_title', 'Gas furnace replacement', 'due_at', (now_ts - interval '3 days')::text)),
    (wr_water, 'preventive_maintenance', 'active', 'preventive_maintenance_task', task_water,
     demo_landlord, 'automation', 'preventive_maintenance', 'assign_vendor', 'route',
     now_ts - interval '5 days', null,
     jsonb_build_object('landlord_id', demo_landlord, 'unit_label', '312', 'building', 'Maple Heights',
       'task_title', 'Water heater replacement', 'assigned_vendor_id', v_summit::text)),
    (wr_hvac, 'preventive_maintenance', 'active', 'preventive_maintenance_task', task_hvac,
     demo_landlord, 'automation', 'preventive_maintenance', 'task_created', 'trigger',
     now_ts - interval '4 days', null,
     jsonb_build_object('landlord_id', demo_landlord, 'unit_label', '107', 'building', 'Birch Tower')),
    (wr_electrical, 'preventive_maintenance', 'completed', 'preventive_maintenance_task', task_electrical,
     demo_landlord, 'automation', 'preventive_maintenance', 'completed', 'log',
     now_ts - interval '14 days', now_ts - interval '1 day',
     jsonb_build_object('landlord_id', demo_landlord, 'unit_label', '305', 'building', 'Cedar Court')),
    (wr_roof, 'preventive_maintenance', 'active', 'preventive_maintenance_task', task_roof,
     demo_landlord, 'automation', 'preventive_maintenance', 'task_created', 'trigger',
     now_ts - interval '6 days', null,
     jsonb_build_object('landlord_id', demo_landlord, 'building', 'Birch Tower')),
    (wr_smoke, 'preventive_maintenance', 'completed', 'preventive_maintenance_task', task_smoke,
     demo_landlord, 'automation', 'preventive_maintenance', 'completed', 'log',
     now_ts - interval '20 days', now_ts - interval '4 days',
     jsonb_build_object('landlord_id', demo_landlord, 'unit_label', '304', 'building', 'Oakwood Apartments')),
    (wr_boiler, 'preventive_maintenance', 'completed', 'preventive_maintenance_task', task_boiler,
     demo_landlord, 'automation', 'preventive_maintenance', 'completed', 'log',
     now_ts - interval '12 days', now_ts - interval '3 days',
     jsonb_build_object('landlord_id', demo_landlord, 'unit_label', '301', 'building', 'Pine Ridge')),
    (wr_co, 'preventive_maintenance', 'active', 'preventive_maintenance_task', task_co,
     demo_landlord, 'automation', 'preventive_maintenance', 'task_created', 'trigger',
     now_ts - interval '7 days', null,
     jsonb_build_object('landlord_id', demo_landlord, 'building', 'Pine Ridge')),
    (wr_dryer, 'preventive_maintenance', 'active', 'preventive_maintenance_task', task_dryer,
     demo_landlord, 'automation', 'preventive_maintenance', 'task_created', 'trigger',
     now_ts - interval '5 days', null,
     jsonb_build_object('landlord_id', demo_landlord, 'building', 'Oakwood Apartments')),
    (wr_filter, 'preventive_maintenance', 'active', 'preventive_maintenance_task', task_filter,
     demo_landlord, 'automation', 'preventive_maintenance', 'assign_vendor', 'route',
     now_ts - interval '3 days', null,
     jsonb_build_object('landlord_id', demo_landlord, 'building', 'Maple Heights',
       'assigned_vendor_id', v_summit::text)),
    (wr_furnace_tune, 'preventive_maintenance', 'active', 'preventive_maintenance_task', task_furnace_tune,
     demo_landlord, 'automation', 'preventive_maintenance', 'assign_vendor', 'route',
     now_ts - interval '6 days', null,
     jsonb_build_object('landlord_id', demo_landlord, 'unit_label', '201', 'building', 'Willow Park',
       'assigned_vendor_id', v_summit::text));

  -- Preventive tasks (source of truth for compliance) -------------------------
  insert into public.preventive_maintenance_tasks (
    id, landlord_id, unit_asset_id, workflow_run_id, title, task_kind, due_at, status,
    assigned_vendor_id, assigned_at, completed_at, unit_label, building, metadata
  )
  values
    (task_furnace, demo_landlord, asset_furnace, wr_furnace,
     'Gas furnace replacement', 'appliance', now_ts - interval '3 days', 'scheduled',
     null, null, null, '201', 'Willow Park',
     jsonb_build_object('seed', 'demo_preventive_maintenance')),
    (task_water, demo_landlord, asset_water, wr_water,
     'Water heater replacement', 'appliance', now_ts + interval '6 days', 'assigned',
     v_summit, now_ts - interval '2 days', null, '312', 'Maple Heights',
     jsonb_build_object('seed', 'demo_preventive_maintenance')),
    (task_hvac, demo_landlord, asset_hvac, wr_hvac,
     'HVAC condenser replacement', 'appliance', now_ts + interval '14 days', 'scheduled',
     null, null, null, '107', 'Birch Tower',
     jsonb_build_object('seed', 'demo_preventive_maintenance')),
    (task_electrical, demo_landlord, asset_electrical, wr_electrical,
     'Electrical inspection', 'inspection', now_ts - interval '2 days', 'completed',
     null, null, now_ts - interval '1 day', '305', 'Cedar Court',
     jsonb_build_object('seed', 'demo_preventive_maintenance')),
    (task_roof, demo_landlord, asset_roof, wr_roof,
     'Roof inspection', 'inspection', now_ts + interval '9 days', 'scheduled',
     null, null, null, null, 'Birch Tower',
     jsonb_build_object('seed', 'demo_preventive_maintenance', 'scope', 'common_area')),
    (task_smoke, demo_landlord, asset_smoke, wr_smoke,
     'Smoke detector test', 'inspection', now_ts - interval '5 days', 'completed',
     null, null, now_ts - interval '4 days', '304', 'Oakwood Apartments',
     jsonb_build_object('seed', 'demo_preventive_maintenance')),
    (task_boiler, demo_landlord, asset_boiler, wr_boiler,
     'Boiler annual service', 'service', now_ts - interval '4 days', 'completed',
     v_summit, now_ts - interval '5 days', now_ts - interval '3 days', '301', 'Pine Ridge',
     jsonb_build_object('seed', 'demo_preventive_maintenance')),
    (task_co, demo_landlord, asset_co, wr_co,
     'Corridor CO detector test', 'inspection', now_ts - interval '6 days', 'scheduled',
     null, null, null, null, 'Pine Ridge',
     jsonb_build_object('seed', 'demo_preventive_maintenance', 'scope', 'common_area')),
    (task_dryer, demo_landlord, asset_dryer, wr_dryer,
     'Common laundry dryer vent cleaning', 'service', now_ts + interval '4 days', 'scheduled',
     null, null, null, null, 'Oakwood Apartments',
     jsonb_build_object('seed', 'demo_preventive_maintenance', 'scope', 'common_area')),
    (task_filter, demo_landlord, asset_filter, wr_filter,
     'Quarterly HVAC filter change', 'service', now_ts + interval '2 days', 'assigned',
     v_summit, now_ts - interval '1 day', null, null, 'Maple Heights',
     jsonb_build_object('seed', 'demo_preventive_maintenance', 'scope', 'common_area')),
    (task_furnace_tune, demo_landlord, asset_furnace_tune, wr_furnace_tune,
     'Annual furnace tune-up', 'service', now_ts + interval '8 days', 'assigned',
     v_summit, now_ts - interval '2 days', null, '201', 'Willow Park',
     jsonb_build_object('seed', 'demo_preventive_maintenance'));

  raise notice 'Demo PM: % tasks (% completed) across % buildings',
    (select count(*) from public.preventive_maintenance_tasks where landlord_id = demo_landlord),
    (select count(*) from public.preventive_maintenance_tasks
     where landlord_id = demo_landlord and status = 'completed'),
    (select count(distinct building) from public.preventive_maintenance_tasks
     where landlord_id = demo_landlord and building is not null);
end $$;
