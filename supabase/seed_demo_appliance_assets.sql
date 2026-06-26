-- Demo PM compliance: appliances + scheduled inspections for Analytics.
-- Superseded by seed_demo_preventive_maintenance.sql (Property Health + PM pipeline).
-- Run seed_demo_preventive_maintenance.sql instead unless you only need unit_assets rows.
-- Run after seed_demo_landlord_account.sql and unit_assets migrations.

do $$
declare
  demo_landlord uuid := 'de300000-0000-4000-8000-000000000001';
  now_ts timestamptz := now();
begin
  if to_regclass('public.unit_assets') is null then
    raise notice 'unit_assets missing — run migrations first';
    return;
  end if;

  delete from public.unit_assets where landlord_id = demo_landlord;

  insert into public.unit_assets (
    id,
    landlord_id,
    unit_label,
    building,
    appliance_type,
    appliance_label,
    brand,
    model,
    estimated_age_years,
    useful_life_years,
    failure_risk_pct,
    failure_prediction_window,
    replacement_recommended,
    replacement_urgency,
    estimated_replacement_cost,
    detection_source,
    detection_confidence,
    last_detected_at,
    due_at,
    task_kind,
    metadata
  )
  values
    -- Appliances (replacement / failure prediction) --------------------------------
    (
      md5('ulo-demo-asset-furnace-willow-201')::uuid,
      demo_landlord,
      '201',
      'Willow Park',
      'furnace',
      'Gas furnace replacement',
      'Carrier',
      '58STA090',
      18.0,
      15.0,
      85,
      '1–3 months',
      true,
      'immediate',
      4200.00,
      'photo_ai',
      0.88,
      now_ts - interval '2 days',
      now_ts - interval '3 days',
      'appliance',
      jsonb_build_object('seed', 'demo_appliance_assets')
    ),
    (
      md5('ulo-demo-asset-water-heater-maple-312')::uuid,
      demo_landlord,
      '312',
      'Maple Heights',
      'water_heater',
      'Water heater replacement',
      'Rheem',
      'PROG50-38N RH67',
      14.0,
      12.0,
      78,
      '3–6 months',
      true,
      'soon',
      1450.00,
      'photo_ai',
      0.91,
      now_ts - interval '4 days',
      now_ts + interval '6 days',
      'appliance',
      jsonb_build_object('seed', 'demo_appliance_assets')
    ),
    (
      md5('ulo-demo-asset-hvac-birch-107')::uuid,
      demo_landlord,
      '107',
      'Birch Tower',
      'hvac_condenser',
      'HVAC condenser replacement',
      'Trane',
      'XR14',
      12.0,
      15.0,
      62,
      '6–9 months',
      true,
      'soon',
      3800.00,
      'photo_ai',
      0.86,
      now_ts - interval '6 days',
      now_ts + interval '14 days',
      'appliance',
      jsonb_build_object('seed', 'demo_appliance_assets')
    ),
    -- Scheduled inspections --------------------------------------------------------
    (
      md5('ulo-demo-pm-electrical-cedar-305')::uuid,
      demo_landlord,
      '305',
      'Cedar Court',
      'electrical_inspection',
      'Electrical inspection',
      null,
      null,
      0,
      1.0,
      0,
      'Annual cycle',
      false,
      'monitor',
      null,
      'inspection',
      null,
      now_ts - interval '1 day',
      now_ts - interval '2 days',
      'inspection',
      jsonb_build_object('seed', 'demo_appliance_assets', 'schedule', 'annual')
    ),
    (
      md5('ulo-demo-pm-roof-birch-common')::uuid,
      demo_landlord,
      null,
      'Birch Tower',
      'roof_inspection',
      'Roof inspection',
      null,
      null,
      0,
      1.0,
      0,
      'Annual cycle',
      false,
      'monitor',
      null,
      'inspection',
      null,
      now_ts - interval '3 days',
      now_ts + interval '9 days',
      'inspection',
      jsonb_build_object('seed', 'demo_appliance_assets', 'scope', 'common_area')
    ),
    (
      md5('ulo-demo-pm-smoke-oak-304')::uuid,
      demo_landlord,
      '304',
      'Oakwood Apartments',
      'smoke_detector_test',
      'Smoke detector test',
      null,
      null,
      0,
      1.0,
      0,
      'Semi-annual',
      false,
      'monitor',
      null,
      'inspection',
      null,
      now_ts - interval '5 days',
      now_ts + interval '18 days',
      'inspection',
      jsonb_build_object('seed', 'demo_appliance_assets', 'schedule', 'semi_annual')
    );

  raise notice 'Demo unit_assets: % rows', (
    select count(*) from public.unit_assets where landlord_id = demo_landlord
  );
end $$;
