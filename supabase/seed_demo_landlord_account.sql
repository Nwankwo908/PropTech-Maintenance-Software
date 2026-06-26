-- =============================================================================
-- Demo Property Management — seeded landlord showcase account
-- =============================================================================
-- Account: Demo Property Management <demo@ulohome.io>
-- Landlord id: de300000-0000-4000-8000-000000000001 (landlords.is_demo = true)
--
-- Seeds a full, believable portfolio:
--   * 6 properties, 582 units (Oakwood Apartments 124, Pine Ridge 68,
--     Cedar Court 48, Maple Heights 96, Birch Tower 210, Willow Park 36)
--   * Named residents incl. lease expirations + late-rent scenarios
--   * Vendors across plumbing / HVAC / electrical / general / cleaning
--   * Vendor scores: resident feedback, status-event timing, composite ratings
--   * Maintenance: open, completed, emergency, SLA-overdue, preventive,
--     and a vendor-reassignment example
--   * Workflows: maintenance, rent collection, lease renewal, move-in,
--     move-out, inspections — with workflow_events timelines
--   * property_operations_graph events powering the AI Operations Feed,
--     Smart Insights, Needs Attention, and unit timelines
--   * Property Health signals: open tickets per building, repeat issues (45d window),
--     resident feedback per building, vendor assignments for performance scoring
--     (PM tasks seeded separately in seed_demo_preventive_maintenance.sql)
--
-- Idempotent: deletes everything owned by the demo landlord, then re-inserts.
-- Never touches other landlords' data.
--
-- Run after migrations (incl. 20260611120000_landlord_accounts.sql and
-- 20260615150000_vendor_feedback_scoring.sql for vendor score KPIs):
--   psql "$DATABASE_URL" -f supabase/seed_demo_landlord_account.sql
-- Or paste into the Supabase SQL Editor.
-- =============================================================================

do $$
declare
  demo_landlord uuid := 'de300000-0000-4000-8000-000000000001';
  now_ts timestamptz := now();

  -- Properties (synthetic ids via derive_property_id)
  p_oakwood uuid;
  p_pine uuid;
  p_cedar uuid;
  p_maple uuid;
  p_birch uuid;
  p_willow uuid;

  -- Showcase units (looked up after bulk insert)
  u_oak_103 uuid; u_oak_204 uuid; u_oak_304 uuid; u_oak_506 uuid;
  u_oak_108 uuid; u_oak_205 uuid;
  u_pine_305 uuid; u_pine_204 uuid; u_pine_301 uuid;
  u_cedar_102 uuid; u_cedar_305 uuid;
  u_maple_207 uuid; u_maple_312 uuid; u_maple_105 uuid; u_maple_107 uuid;
  u_birch_1203 uuid; u_birch_410 uuid; u_birch_708 uuid; u_birch_107 uuid;
  u_willow_103 uuid; u_willow_201 uuid;

  -- Vendors
  v_apex uuid := md5('ulo-demo-vendor-apex-plumbing')::uuid;
  v_rooter uuid := md5('ulo-demo-vendor-rapid-rooter')::uuid;
  v_summit uuid := md5('ulo-demo-vendor-summit-hvac')::uuid;
  v_bright uuid := md5('ulo-demo-vendor-brightline-electrical')::uuid;
  v_allied uuid := md5('ulo-demo-vendor-allied-general')::uuid;
  v_fresh uuid := md5('ulo-demo-vendor-freshnest-cleaning')::uuid;
  v_metro uuid := md5('ulo-demo-vendor-metro-plumbing')::uuid;
  v_green uuid := md5('ulo-demo-vendor-greenscape')::uuid;

  -- Residents
  r_johnson uuid := md5('ulo-demo-res-sarah-johnson')::uuid;       -- lease renewal expiring
  r_alvarez uuid := md5('ulo-demo-res-marco-alvarez')::uuid;       -- late rent (escalated)
  r_chen uuid := md5('ulo-demo-res-grace-chen')::uuid;             -- rent overdue
  r_okafor uuid := md5('ulo-demo-res-david-okafor')::uuid;         -- rent due today
  r_patel uuid := md5('ulo-demo-res-anita-patel')::uuid;           -- moving in
  r_brooks uuid := md5('ulo-demo-res-lamar-brooks')::uuid;         -- moving out
  r_nguyen uuid := md5('ulo-demo-res-kim-nguyen')::uuid;           -- inspection scheduled
  r_rossi uuid := md5('ulo-demo-res-elena-rossi')::uuid;           -- inspection issue found
  r_walker uuid := md5('ulo-demo-res-jordan-walker')::uuid;        -- emergency plumbing
  r_haddad uuid := md5('ulo-demo-res-omar-haddad')::uuid;
  r_silva uuid := md5('ulo-demo-res-bianca-silva')::uuid;
  r_kowalski uuid := md5('ulo-demo-res-piotr-kowalski')::uuid;
  r_freeman uuid := md5('ulo-demo-res-tessa-freeman')::uuid;       -- lease renewal (no response)
  r_ito uuid := md5('ulo-demo-res-haruto-ito')::uuid;
  r_mensah uuid := md5('ulo-demo-res-abena-mensah')::uuid;
  r_oconnor uuid := md5('ulo-demo-res-liam-oconnor')::uuid;

  -- Occupancy
  o_patel uuid := md5('ulo-demo-occ-patel')::uuid;
  o_brooks uuid := md5('ulo-demo-occ-brooks')::uuid;
  o_nguyen uuid := md5('ulo-demo-occ-nguyen')::uuid;
  o_rossi uuid := md5('ulo-demo-occ-rossi')::uuid;
  o_mensah uuid := md5('ulo-demo-occ-mensah')::uuid;

  -- Maintenance tickets
  t01 uuid := md5('ulo-demo-ticket-01')::uuid;  -- emergency plumbing Oakwood 304
  t02 uuid := md5('ulo-demo-ticket-02')::uuid;  -- urgent electrical Birch 1203
  t03 uuid := md5('ulo-demo-ticket-03')::uuid;  -- urgent no-heat Maple 207
  t04 uuid := md5('ulo-demo-ticket-04')::uuid;  -- high plumbing SLA overdue Oakwood 108
  t05 uuid := md5('ulo-demo-ticket-05')::uuid;  -- urgent gas smell Pine 305
  t06 uuid := md5('ulo-demo-ticket-06')::uuid;  -- urgent plumbing Cedar 102
  t07 uuid := md5('ulo-demo-ticket-07')::uuid;  -- high electrical Birch 708
  t08 uuid := md5('ulo-demo-ticket-08')::uuid;  -- door/window Willow 103
  t09 uuid := md5('ulo-demo-ticket-09')::uuid;  -- plumbing from inspection Oakwood 205
  t10 uuid := md5('ulo-demo-ticket-10')::uuid;  -- preventive HVAC Maple 312
  t11 uuid := md5('ulo-demo-ticket-11')::uuid;  -- cleaning Birch 410
  t12 uuid := md5('ulo-demo-ticket-12')::uuid;  -- noise Pine 204
  t13 uuid := md5('ulo-demo-ticket-13')::uuid;  -- general Cedar 305
  t14 uuid := md5('ulo-demo-ticket-14')::uuid;  -- vendor reassignment Oakwood 506
  t15 uuid := md5('ulo-demo-ticket-15')::uuid;  -- general Maple 105
  t16 uuid := md5('ulo-demo-ticket-16')::uuid;  -- preventive furnace Willow 201
  t17 uuid := md5('ulo-demo-ticket-17')::uuid;  -- completed plumbing Oakwood 304 (repeat unit)
  t18 uuid := md5('ulo-demo-ticket-18')::uuid;  -- completed plumbing Oakwood 103
  t19 uuid := md5('ulo-demo-ticket-19')::uuid;  -- completed electrical Oakwood 204
  t20 uuid := md5('ulo-demo-ticket-20')::uuid;  -- completed hvac Birch 107
  t21 uuid := md5('ulo-demo-ticket-21')::uuid;  -- completed general Birch 410
  t22 uuid := md5('ulo-demo-ticket-22')::uuid;  -- completed hvac Maple 207 (repeat unit)
  t23 uuid := md5('ulo-demo-ticket-23')::uuid;  -- completed plumbing Maple 105
  t24 uuid := md5('ulo-demo-ticket-24')::uuid;  -- completed cleaning Pine 204
  t25 uuid := md5('ulo-demo-ticket-25')::uuid;  -- completed general Cedar 305
  t26 uuid := md5('ulo-demo-ticket-26')::uuid;  -- completed plumbing Willow 103
  -- Stale prior-window assignments (vendor never responded). These drag the
  -- prior 4-week vendor response rate down so the Vendor Response KPI trends
  -- up (green TrendingUp pill) on the overview dashboard.
  t27 uuid := md5('ulo-demo-ticket-27')::uuid;  -- stale pending Birch 503
  t28 uuid := md5('ulo-demo-ticket-28')::uuid;  -- stale pending Pine 401
  t29 uuid := md5('ulo-demo-ticket-29')::uuid;  -- completed plumbing Pine 301 (repeat pair)
  t30 uuid := md5('ulo-demo-ticket-30')::uuid;  -- open plumbing Pine 301 (repeat within 45d)

  -- Workflow runs
  wr_maint1 uuid := md5('ulo-demo-run-maint-1')::uuid;        -- active (t01)
  wr_maint2 uuid := md5('ulo-demo-run-maint-2')::uuid;        -- active (t03)
  wr_maint3 uuid := md5('ulo-demo-run-maint-3')::uuid;        -- escalated, vendor declined (t14)
  wr_maint4 uuid := md5('ulo-demo-run-maint-4')::uuid;        -- completed (t17)
  wr_maint5 uuid := md5('ulo-demo-run-maint-5')::uuid;        -- completed (t20)
  wr_rent1 uuid := md5('ulo-demo-run-rent-1')::uuid;          -- due today (Okafor)
  wr_rent2 uuid := md5('ulo-demo-run-rent-2')::uuid;          -- overdue (Chen)
  wr_rent3 uuid := md5('ulo-demo-run-rent-3')::uuid;          -- escalated overdue (Alvarez)
  wr_rent4 uuid := md5('ulo-demo-run-rent-4')::uuid;          -- completed / paid (Ito)
  wr_lease1 uuid := md5('ulo-demo-run-lease-1')::uuid;        -- active (Johnson, 14 days)
  wr_lease2 uuid := md5('ulo-demo-run-lease-2')::uuid;        -- escalated no response (Freeman)
  wr_movein1 uuid := md5('ulo-demo-run-movein-1')::uuid;      -- active (Patel)
  wr_movein2 uuid := md5('ulo-demo-run-movein-2')::uuid;      -- completed (Mensah)
  wr_moveout1 uuid := md5('ulo-demo-run-moveout-1')::uuid;    -- active (Brooks)
  wr_moveout2 uuid := md5('ulo-demo-run-moveout-2')::uuid;    -- completed
  wr_insp1 uuid := md5('ulo-demo-run-insp-1')::uuid;          -- active scheduled (Nguyen)
  wr_insp2 uuid := md5('ulo-demo-run-insp-2')::uuid;          -- completed, issue found (Rossi)
  wr_insp3 uuid := md5('ulo-demo-run-insp-3')::uuid;          -- active overdue

  -- Inspections
  insp_sched uuid := md5('ulo-demo-insp-scheduled')::uuid;
  insp_done uuid := md5('ulo-demo-insp-completed')::uuid;
  insp_overdue uuid := md5('ulo-demo-insp-overdue')::uuid;
begin
  if not exists (select 1 from public.workflow_templates where id = 'move_in') then
    raise exception 'workflow templates missing — run migrations first';
  end if;
  if not exists (select 1 from public.landlords where id = demo_landlord) then
    raise exception 'demo landlord missing — run 20260611120000_landlord_accounts.sql first';
  end if;

  p_oakwood := public.derive_property_id(demo_landlord, 'Oakwood Apartments');
  p_pine := public.derive_property_id(demo_landlord, 'Pine Ridge');
  p_cedar := public.derive_property_id(demo_landlord, 'Cedar Court');
  p_maple := public.derive_property_id(demo_landlord, 'Maple Heights');
  p_birch := public.derive_property_id(demo_landlord, 'Birch Tower');
  p_willow := public.derive_property_id(demo_landlord, 'Willow Park');

  -- ---------------------------------------------------------------------------
  -- Cleanup: everything owned by the demo landlord (idempotent re-run)
  -- ---------------------------------------------------------------------------
  delete from public.property_operations_graph where landlord_id = demo_landlord;
  delete from public.operations_graph_events where landlord_id = demo_landlord;
  delete from public.workflow_events where landlord_id = demo_landlord;
  delete from public.unit_inspections where landlord_id = demo_landlord;
  delete from public.workflow_runs where landlord_id = demo_landlord;
  if to_regclass('public.vendor_feedback_requests') is not null then
    delete from public.vendor_feedback_requests where landlord_id = demo_landlord;
  end if;
  if to_regclass('public.vendor_feedback') is not null then
    delete from public.vendor_feedback where landlord_id = demo_landlord;
  end if;
  delete from public.maintenance_requests where landlord_id = demo_landlord;
  delete from public.occupancy where landlord_id = demo_landlord;
  delete from public.users where landlord_id = demo_landlord;
  delete from public.vendors where landlord_id = demo_landlord;
  delete from public.units where landlord_id = demo_landlord;

  -- ---------------------------------------------------------------------------
  -- Units — 6 properties, 582 units
  -- ---------------------------------------------------------------------------
  insert into public.units (id, landlord_id, unit_label, building, status)
  select
    md5('ulo-demo-unit-' || b.building || '-' || gs.n)::uuid,
    demo_landlord,
    (((gs.n - 1) / b.per_floor + 1) * 100 + ((gs.n - 1) % b.per_floor + 1))::text,
    b.building,
    case
      when gs.n % 19 = 0 then 'vacant'
      when gs.n % 43 = 0 then 'inactive'
      else 'active'
    end
  from (
    values
      ('Oakwood Apartments', 124, 8),
      ('Pine Ridge', 68, 8),
      ('Cedar Court', 48, 6),
      ('Maple Heights', 96, 8),
      ('Birch Tower', 210, 10),
      ('Willow Park', 36, 6)
  ) as b(building, unit_count, per_floor)
  cross join lateral generate_series(1, b.unit_count) as gs(n);

  -- Showcase unit lookups (and force them active so scenarios are coherent)
  select id into u_oak_103 from public.units where landlord_id = demo_landlord and building = 'Oakwood Apartments' and unit_label = '103';
  select id into u_oak_204 from public.units where landlord_id = demo_landlord and building = 'Oakwood Apartments' and unit_label = '204';
  select id into u_oak_304 from public.units where landlord_id = demo_landlord and building = 'Oakwood Apartments' and unit_label = '304';
  select id into u_oak_506 from public.units where landlord_id = demo_landlord and building = 'Oakwood Apartments' and unit_label = '506';
  select id into u_oak_108 from public.units where landlord_id = demo_landlord and building = 'Oakwood Apartments' and unit_label = '108';
  select id into u_oak_205 from public.units where landlord_id = demo_landlord and building = 'Oakwood Apartments' and unit_label = '205';
  select id into u_pine_305 from public.units where landlord_id = demo_landlord and building = 'Pine Ridge' and unit_label = '305';
  select id into u_pine_204 from public.units where landlord_id = demo_landlord and building = 'Pine Ridge' and unit_label = '204';
  select id into u_pine_301 from public.units where landlord_id = demo_landlord and building = 'Pine Ridge' and unit_label = '301';
  select id into u_cedar_102 from public.units where landlord_id = demo_landlord and building = 'Cedar Court' and unit_label = '102';
  select id into u_cedar_305 from public.units where landlord_id = demo_landlord and building = 'Cedar Court' and unit_label = '305';
  select id into u_maple_207 from public.units where landlord_id = demo_landlord and building = 'Maple Heights' and unit_label = '207';
  select id into u_maple_312 from public.units where landlord_id = demo_landlord and building = 'Maple Heights' and unit_label = '312';
  select id into u_maple_105 from public.units where landlord_id = demo_landlord and building = 'Maple Heights' and unit_label = '105';
  select id into u_maple_107 from public.units where landlord_id = demo_landlord and building = 'Maple Heights' and unit_label = '107';
  select id into u_birch_1203 from public.units where landlord_id = demo_landlord and building = 'Birch Tower' and unit_label = '1203';
  select id into u_birch_410 from public.units where landlord_id = demo_landlord and building = 'Birch Tower' and unit_label = '410';
  select id into u_birch_708 from public.units where landlord_id = demo_landlord and building = 'Birch Tower' and unit_label = '708';
  select id into u_birch_107 from public.units where landlord_id = demo_landlord and building = 'Birch Tower' and unit_label = '107';
  select id into u_willow_103 from public.units where landlord_id = demo_landlord and building = 'Willow Park' and unit_label = '103';
  select id into u_willow_201 from public.units where landlord_id = demo_landlord and building = 'Willow Park' and unit_label = '201';

  update public.units set status = 'active'
  where id in (
    u_oak_103, u_oak_204, u_oak_304, u_oak_506, u_oak_108, u_oak_205,
    u_pine_305, u_pine_204, u_pine_301, u_cedar_102, u_cedar_305,
    u_maple_207, u_maple_312, u_maple_105, u_maple_107,
    u_birch_1203, u_birch_410, u_birch_708, u_birch_107,
    u_willow_103, u_willow_201
  );

  -- ---------------------------------------------------------------------------
  -- Vendors
  -- ---------------------------------------------------------------------------
  -- Canonical category slugs are plumbing / electrical / appliance; trades like
  -- HVAC, cleaning, and general maintenance are NULL = generalist routing
  -- (see 20260412130000_normalize_vendor_categories.sql + vendors_category_check).
  insert into public.vendors (id, landlord_id, name, category, email, phone, notification_channel, active)
  values
    (v_apex, demo_landlord, 'Apex Plumbing Co', 'plumbing', 'dispatch@apexplumbing.example.com', '+15555610001', 'both', true),
    (v_rooter, demo_landlord, 'Rapid Rooter', 'plumbing', 'jobs@rapidrooter.example.com', '+15555610002', 'sms', true),
    (v_metro, demo_landlord, 'Metro Plumbing', 'plumbing', 'office@metroplumbing.example.com', '+15555610008', 'email', true),
    (v_summit, demo_landlord, 'Summit HVAC', null, 'service@summithvac.example.com', '+15555610003', 'both', true),
    (v_bright, demo_landlord, 'Brightline Electrical', 'electrical', 'crew@brightline.example.com', '+15555610004', 'email', true),
    (v_allied, demo_landlord, 'Allied General Maintenance', null, 'work@alliedgm.example.com', '+15555610005', 'both', true),
    (v_fresh, demo_landlord, 'FreshNest Cleaning', null, 'book@freshnest.example.com', '+15555610006', 'sms', true),
    (v_green, demo_landlord, 'GreenScape Grounds', null, 'hello@greenscape.example.com', '+15555610007', 'email', false);

  -- ---------------------------------------------------------------------------
  -- Residents (named showcase residents)
  -- ---------------------------------------------------------------------------
  insert into public.users (
    id, landlord_id, resident_id, full_name, email, phone, unit, building,
    status, balance_due, move_in_date, lease_end_date
  )
  values
    (r_johnson, demo_landlord, 'DEMO-001', 'Sarah Johnson', 'sarah.johnson@example.com', '+15555620001', '103', 'Cedar Court', 'active', 0, current_date - 351, current_date + 14),
    (r_alvarez, demo_landlord, 'DEMO-002', 'Marco Alvarez', 'marco.alvarez@example.com', '+15555620002', '107', 'Maple Heights', 'active', 2400, current_date - 540, current_date + 190),
    (r_chen, demo_landlord, 'DEMO-003', 'Grace Chen', 'grace.chen@example.com', '+15555620003', '402', 'Birch Tower', 'active', 1850, current_date - 260, current_date + 105),
    (r_okafor, demo_landlord, 'DEMO-004', 'David Okafor', 'david.okafor@example.com', '+15555620004', '301', 'Pine Ridge', 'active', 1450, current_date - 120, current_date + 245),
    (r_patel, demo_landlord, 'DEMO-005', 'Anita Patel', 'anita.patel@example.com', '+15555620005', '204', 'Oakwood Apartments', 'pending', 0, current_date + 6, current_date + 371),
    (r_brooks, demo_landlord, 'DEMO-006', 'Lamar Brooks', 'lamar.brooks@example.com', '+15555620006', '201', 'Willow Park', 'active', 0, current_date - 700, current_date + 12),
    (r_nguyen, demo_landlord, 'DEMO-007', 'Kim Nguyen', 'kim.nguyen@example.com', '+15555620007', '305', 'Cedar Court', 'active', 0, current_date - 180, current_date + 185),
    (r_rossi, demo_landlord, 'DEMO-008', 'Elena Rossi', 'elena.rossi@example.com', '+15555620008', '205', 'Oakwood Apartments', 'active', 0, current_date - 410, current_date + 320),
    (r_walker, demo_landlord, 'DEMO-009', 'Jordan Walker', 'jordan.walker@example.com', '+15555620009', '304', 'Oakwood Apartments', 'active', 0, current_date - 95, current_date + 270),
    (r_haddad, demo_landlord, 'DEMO-010', 'Omar Haddad', 'omar.haddad@example.com', '+15555620010', '1203', 'Birch Tower', 'active', 0, current_date - 300, current_date + 65),
    (r_silva, demo_landlord, 'DEMO-011', 'Bianca Silva', 'bianca.silva@example.com', '+15555620011', '207', 'Maple Heights', 'active', 0, current_date - 220, current_date + 145),
    (r_kowalski, demo_landlord, 'DEMO-012', 'Piotr Kowalski', 'piotr.kowalski@example.com', '+15555620012', '305', 'Pine Ridge', 'active', 0, current_date - 60, current_date + 305),
    (r_freeman, demo_landlord, 'DEMO-013', 'Tessa Freeman', 'tessa.freeman@example.com', '+15555620013', '506', 'Oakwood Apartments', 'active', 0, current_date - 330, current_date + 28),
    (r_ito, demo_landlord, 'DEMO-014', 'Haruto Ito', 'haruto.ito@example.com', '+15555620014', '410', 'Birch Tower', 'active', 0, current_date - 150, current_date + 215),
    (r_mensah, demo_landlord, 'DEMO-015', 'Abena Mensah', 'abena.mensah@example.com', '+15555620015', '102', 'Cedar Court', 'active', 0, current_date - 21, current_date + 344),
    (r_oconnor, demo_landlord, 'DEMO-016', 'Liam O''Connor', 'liam.oconnor@example.com', '+15555620016', '708', 'Birch Tower', 'active', 0, current_date - 480, current_date + 85);

  -- ---------------------------------------------------------------------------
  -- Occupancy (lifecycle scenarios)
  -- ---------------------------------------------------------------------------
  insert into public.occupancy (id, landlord_id, unit_id, resident_id, move_in_date, move_out_date, status)
  values
    (o_patel, demo_landlord, u_oak_204, r_patel, current_date + 6, null, 'active'),
    (o_brooks, demo_landlord, u_willow_201, r_brooks, current_date - 700, current_date + 12, 'active'),
    (o_nguyen, demo_landlord, u_cedar_305, r_nguyen, current_date - 180, null, 'active'),
    (o_rossi, demo_landlord, u_oak_205, r_rossi, current_date - 410, null, 'active'),
    (o_mensah, demo_landlord, u_cedar_102, r_mensah, current_date - 21, null, 'active');

  -- ---------------------------------------------------------------------------
  -- Maintenance requests
  -- ---------------------------------------------------------------------------
  insert into public.maintenance_requests (
    id, landlord_id, created_at, priority, urgency, severity,
    resident_name, email, resident_phone, unit, description,
    vendor_work_status, issue_category, assigned_vendor_id, assigned_at, due_at
  )
  values
    -- Open / critical -----------------------------------------------------------
    (t01, demo_landlord, now_ts - interval '45 minutes', 'urgent', 'urgent', 'urgent',
     'Jordan Walker', 'jordan.walker@example.com', '+15555620009', '304',
     'EMERGENCY: water heater burst in utility closet, active leak spreading to hallway.',
     'unassigned', 'plumbing', null, null, now_ts + interval '4 hours'),
    (t02, demo_landlord, now_ts - interval '26 hours', 'urgent', 'urgent', 'urgent',
     'Omar Haddad', 'omar.haddad@example.com', '+15555620010', '1203',
     'Breaker panel sparking when AC compressor kicks on. Smell of burning plastic.',
     'in_progress', 'electrical', v_bright, now_ts - interval '24 hours', now_ts + interval '10 hours'),
    (t03, demo_landlord, now_ts - interval '3 hours', 'urgent', 'urgent', 'urgent',
     'Bianca Silva', 'bianca.silva@example.com', '+15555620011', '207',
     'No heat in unit — thermostat unresponsive, family with infant.',
     'pending_accept', 'hvac', v_summit, now_ts - interval '2 hours', now_ts + interval '20 hours'),
    (t04, demo_landlord, now_ts - interval '3 days', 'high', 'high', 'high',
     'Noah Bennett', 'noah.bennett@example.com', '+15555620031', '108',
     'Sewage smell from bathroom drain getting worse — suspected vent blockage.',
     'accepted', 'plumbing', v_apex, now_ts - interval '2 days 18 hours', now_ts - interval '6 hours'),
    (t05, demo_landlord, now_ts - interval '5 hours', 'urgent', 'urgent', 'urgent',
     'Piotr Kowalski', 'piotr.kowalski@example.com', '+15555620012', '305',
     'Gas smell near the stove — resident vacated unit, gas company notified.',
     'unassigned', 'general', null, null, now_ts + interval '2 hours'),
    (t06, demo_landlord, now_ts - interval '30 hours', 'urgent', 'urgent', 'urgent',
     'Abena Mensah', 'abena.mensah@example.com', '+15555620015', '102',
     'Ceiling leak below upstairs bathroom — drywall sagging.',
     'in_progress', 'plumbing', v_rooter, now_ts - interval '28 hours', now_ts + interval '14 hours'),
    (t07, demo_landlord, now_ts - interval '6 days', 'high', 'high', 'high',
     'Liam O''Connor', 'liam.oconnor@example.com', '+15555620016', '708',
     'Half the outlets in the living room dead after storm.',
     'unassigned', 'electrical', null, null, now_ts + interval '1 day'),
    -- Open / normal --------------------------------------------------------------
    (t08, demo_landlord, now_ts - interval '4 days', 'normal', 'normal', 'normal',
     'Maya Lindqvist', 'maya.lindqvist@example.com', '+15555620032', '103',
     'Patio door not latching; lock misaligned.',
     'accepted', 'door_window', v_allied, now_ts - interval '3 days 12 hours', now_ts + interval '3 days'),
    (t09, demo_landlord, now_ts - interval '2 days', 'normal', 'normal', 'normal',
     'Elena Rossi', 'elena.rossi@example.com', '+15555620008', '205',
     'Kitchen sink leak and cabinet water damage — flagged during annual unit inspection.',
     'unassigned', 'plumbing', null, null, now_ts + interval '4 days'),
    (t10, demo_landlord, now_ts - interval '1 day', 'normal', 'normal', 'normal',
     'Property Manager', 'demo@ulohome.io', null, '312',
     'Preventive maintenance: HVAC filter replacement and coil service (quarterly schedule).',
     'accepted', 'hvac', v_summit, now_ts - interval '20 hours', now_ts + interval '6 days'),
    (t11, demo_landlord, now_ts - interval '8 hours', 'normal', 'normal', 'normal',
     'Haruto Ito', 'haruto.ito@example.com', '+15555620014', '410',
     'Move-out deep clean needed before showing.',
     'pending_accept', 'cleaning', v_fresh, now_ts - interval '7 hours', now_ts + interval '5 days'),
    (t12, demo_landlord, now_ts - interval '9 days', 'low', 'low', 'low',
     'David Okafor', 'david.okafor@example.com', '+15555620004', '204',
     'Recurring late-night noise from HVAC closet shared wall.',
     'unassigned', 'noise', null, null, null),
    (t13, demo_landlord, now_ts - interval '3 days', 'normal', 'normal', 'normal',
     'Kim Nguyen', 'kim.nguyen@example.com', '+15555620007', '305',
     'Hallway light fixture flickering on floor 3.',
     'in_progress', 'general', v_allied, now_ts - interval '2 days 6 hours', now_ts + interval '2 days'),
    (t14, demo_landlord, now_ts - interval '2 days', 'normal', 'normal', 'normal',
     'Tessa Freeman', 'tessa.freeman@example.com', '+15555620013', '506',
     'Garbage disposal jammed and leaking underneath.',
     'pending_accept', 'plumbing', v_apex, now_ts - interval '3 hours', now_ts + interval '2 days'),
    (t15, demo_landlord, now_ts - interval '12 days', 'normal', 'normal', 'normal',
     'Ravi Subramanian', 'ravi.subramanian@example.com', '+15555620033', '105',
     'Window screen torn; requesting replacement.',
     'unassigned', 'general', null, null, null),
    (t16, demo_landlord, now_ts - interval '1 day', 'normal', 'normal', 'normal',
     'Property Manager', 'demo@ulohome.io', null, '201',
     'Preventive maintenance: annual furnace service ahead of winter.',
     'pending_accept', 'hvac', v_summit, now_ts - interval '22 hours', now_ts + interval '10 days'),
    -- Completed -------------------------------------------------------------------
    (t17, demo_landlord, now_ts - interval '18 days', 'high', 'high', 'high',
     'Jordan Walker', 'jordan.walker@example.com', '+15555620009', '304',
     'Bathroom supply line leak behind vanity.',
     'completed', 'plumbing', v_apex, now_ts - interval '17 days 18 hours', now_ts - interval '16 days'),
    (t18, demo_landlord, now_ts - interval '24 days', 'normal', 'normal', 'normal',
     'Sofia Marin', 'sofia.marin@example.com', '+15555620034', '103',
     'Slow draining tub.',
     'completed', 'plumbing', v_rooter, now_ts - interval '23 days', now_ts - interval '21 days'),
    (t19, demo_landlord, now_ts - interval '31 days', 'normal', 'normal', 'normal',
     'Anita Patel', 'anita.patel@example.com', '+15555620005', '204',
     'GFCI outlet in kitchen keeps tripping.',
     'completed', 'electrical', v_bright, now_ts - interval '30 days', now_ts - interval '28 days'),
    (t20, demo_landlord, now_ts - interval '12 days', 'urgent', 'urgent', 'urgent',
     'Carmen Reyes', 'carmen.reyes@example.com', '+15555620035', '107',
     'AC down during heat advisory.',
     'completed', 'hvac', v_summit, now_ts - interval '11 days 20 hours', now_ts - interval '11 days'),
    (t21, demo_landlord, now_ts - interval '40 days', 'normal', 'normal', 'normal',
     'Haruto Ito', 'haruto.ito@example.com', '+15555620014', '410',
     'Closet door off track.',
     'completed', 'general', v_allied, now_ts - interval '39 days', now_ts - interval '36 days'),
    (t22, demo_landlord, now_ts - interval '49 days', 'normal', 'normal', 'normal',
     'Bianca Silva', 'bianca.silva@example.com', '+15555620011', '207',
     'Thermostat replacement.',
     'completed', 'hvac', v_summit, now_ts - interval '48 days', now_ts - interval '45 days'),
    (t23, demo_landlord, now_ts - interval '55 days', 'normal', 'normal', 'normal',
     'Ravi Subramanian', 'ravi.subramanian@example.com', '+15555620033', '105',
     'Running toilet wasting water.',
     'completed', 'plumbing', v_metro, now_ts - interval '54 days', now_ts - interval '51 days'),
    (t24, demo_landlord, now_ts - interval '20 days', 'normal', 'normal', 'normal',
     'David Okafor', 'david.okafor@example.com', '+15555620004', '204',
     'Carpet cleaning after radiator drip.',
     'completed', 'cleaning', v_fresh, now_ts - interval '19 days', now_ts - interval '16 days'),
    (t25, demo_landlord, now_ts - interval '64 days', 'normal', 'normal', 'normal',
     'Kim Nguyen', 'kim.nguyen@example.com', '+15555620007', '305',
     'Caulking refresh in bathroom.',
     'completed', 'general', v_allied, now_ts - interval '63 days', now_ts - interval '60 days'),
    (t26, demo_landlord, now_ts - interval '70 days', 'high', 'high', 'high',
     'Maya Lindqvist', 'maya.lindqvist@example.com', '+15555620032', '103',
     'Burst hose bib flooding garden bed.',
     'completed', 'plumbing', v_apex, now_ts - interval '69 days 12 hours', now_ts - interval '68 days'),
    -- Stale prior-window assignments (no vendor acknowledgement)
    (t27, demo_landlord, now_ts - interval '35 days', 'low', 'low', 'low',
     'Devon Carter', 'devon.carter@example.com', '+15555620036', '503',
     'Balcony door weather stripping worn — vendor never confirmed the job.',
     'pending_accept', 'general', v_allied, now_ts - interval '34 days', null),
    (t28, demo_landlord, now_ts - interval '44 days', 'low', 'low', 'low',
     'Priya Raman', 'priya.raman@example.com', '+15555620037', '401',
     'Laundry room faucet drip — assignment still awaiting vendor response.',
     'pending_accept', 'plumbing', v_metro, now_ts - interval '43 days', null),
    -- Repeat-issue pair (same unit + category within 45 days — Property Health signal)
    (t29, demo_landlord, now_ts - interval '28 days', 'normal', 'normal', 'normal',
     'David Okafor', 'david.okafor@example.com', '+15555620004', '301',
     'Kitchen sink drip — slow leak under cabinet, towels placed.',
     'completed', 'plumbing', v_metro, now_ts - interval '27 days', now_ts - interval '25 days'),
    (t30, demo_landlord, now_ts - interval '9 days', 'high', 'high', 'high',
     'David Okafor', 'david.okafor@example.com', '+15555620004', '301',
     'Same sink leak returned; water damage spreading on cabinet floor.',
     'in_progress', 'plumbing', v_metro, now_ts - interval '8 days', now_ts + interval '1 day');

  -- ---------------------------------------------------------------------------
  -- Workflow runs
  -- ---------------------------------------------------------------------------
  insert into public.workflow_runs (
    id, template_id, status, entity_type, entity_id, property_id, unit_id,
    resident_id, landlord_id, trigger_type, workflow_type, current_stage,
    current_step, started_at, completed_at, metadata
  )
  values
    -- Maintenance ---------------------------------------------------------------
    (wr_maint1, 'maintenance_intake', 'active', 'maintenance_request', t01,
     p_oakwood, u_oak_304, r_walker, demo_landlord, 'sms_inbound', 'maintenance',
     'routed', 'vendor_dispatch', now_ts - interval '45 minutes', null,
     jsonb_build_object('landlord_id', demo_landlord, 'unit_label', '304', 'building', 'Oakwood Apartments',
       'maintenance_request_id', t01, 'issue_category', 'plumbing', 'urgency', 'urgent',
       'due_at', (now_ts + interval '4 hours')::text)),
    (wr_maint2, 'maintenance_intake', 'active', 'maintenance_request', t03,
     p_maple, u_maple_207, r_silva, demo_landlord, 'sms_inbound', 'maintenance',
     'acted', 'awaiting_vendor_accept', now_ts - interval '3 hours', null,
     jsonb_build_object('landlord_id', demo_landlord, 'unit_label', '207', 'building', 'Maple Heights',
       'maintenance_request_id', t03, 'issue_category', 'hvac', 'urgency', 'urgent',
       'due_at', (now_ts + interval '20 hours')::text)),
    (wr_maint3, 'maintenance_intake', 'escalated', 'maintenance_request', t14,
     p_oakwood, u_oak_506, r_freeman, demo_landlord, 'sms_inbound', 'maintenance',
     'escalated', 'vendor_reassigned', now_ts - interval '2 days', null,
     jsonb_build_object('landlord_id', demo_landlord, 'unit_label', '506', 'building', 'Oakwood Apartments',
       'maintenance_request_id', t14, 'issue_category', 'plumbing',
       'declined_vendor', 'Rapid Rooter', 'reassigned_vendor', 'Apex Plumbing Co')),
    (wr_maint4, 'maintenance_intake', 'completed', 'maintenance_request', t17,
     p_oakwood, u_oak_304, r_walker, demo_landlord, 'sms_inbound', 'maintenance',
     'logged', 'completed', now_ts - interval '18 days', now_ts - interval '16 days',
     jsonb_build_object('landlord_id', demo_landlord, 'unit_label', '304', 'building', 'Oakwood Apartments',
       'maintenance_request_id', t17, 'issue_category', 'plumbing')),
    (wr_maint5, 'maintenance_intake', 'completed', 'maintenance_request', t20,
     p_birch, u_birch_107, null, demo_landlord, 'sms_inbound', 'maintenance',
     'logged', 'completed', now_ts - interval '12 days', now_ts - interval '11 days',
     jsonb_build_object('landlord_id', demo_landlord, 'unit_label', '107', 'building', 'Birch Tower',
       'maintenance_request_id', t20, 'issue_category', 'hvac')),
    -- Rent collection -------------------------------------------------------------
    (wr_rent1, 'rent_collection', 'active', 'user', r_okafor,
     p_pine, null, r_okafor, demo_landlord, 'cron', 'rent', 'classified',
     'reminder_sent', now_ts - interval '10 hours', null,
     jsonb_build_object('landlord_id', demo_landlord, 'unit_label', '301', 'building', 'Pine Ridge',
       'amount_due', 1450, 'billing_period', to_char(current_date, 'YYYY-MM'),
       'rent_due_date', current_date::text, 'rent_classification', 'rent_due_today',
       'sms_sent', true, 'step_state', jsonb_build_object('rent_classification', 'rent_due_today', 'sms_sent', true))),
    (wr_rent2, 'rent_collection', 'active', 'user', r_chen,
     p_birch, null, r_chen, demo_landlord, 'cron', 'rent', 'acted',
     'payment_requested', now_ts - interval '4 days', null,
     jsonb_build_object('landlord_id', demo_landlord, 'unit_label', '402', 'building', 'Birch Tower',
       'amount_due', 1850, 'billing_period', to_char(current_date, 'YYYY-MM'),
       'rent_due_date', (current_date - 4)::text, 'rent_classification', 'rent_overdue',
       'sms_sent', true, 'email_sent', true, 'payment_requested', true,
       'step_state', jsonb_build_object('rent_classification', 'rent_overdue', 'sms_sent', true))),
    (wr_rent3, 'rent_collection', 'escalated', 'user', r_alvarez,
     p_maple, u_maple_107, r_alvarez, demo_landlord, 'cron', 'rent', 'escalated',
     'late_escalation', now_ts - interval '7 days', null,
     jsonb_build_object('landlord_id', demo_landlord, 'unit_label', '107', 'building', 'Maple Heights',
       'amount_due', 2400, 'billing_period', to_char(current_date, 'YYYY-MM'),
       'rent_due_date', (current_date - 7)::text, 'rent_classification', 'rent_overdue',
       'sms_sent', true, 'email_sent', true, 'payment_requested', true,
       'step_state', jsonb_build_object('rent_classification', 'rent_overdue', 'payment_intent', 'questions'))),
    (wr_rent4, 'rent_collection', 'completed', 'user', r_ito,
     p_birch, u_birch_410, r_ito, demo_landlord, 'cron', 'rent', 'logged',
     'paid', now_ts - interval '9 days', now_ts - interval '8 days',
     jsonb_build_object('landlord_id', demo_landlord, 'unit_label', '410', 'building', 'Birch Tower',
       'amount_due', 1950, 'billing_period', to_char(current_date, 'YYYY-MM'),
       'rent_due_date', (current_date - 9)::text, 'rent_classification', 'paid',
       'sms_sent', true, 'payment_intent', 'paid',
       'step_state', jsonb_build_object('rent_classification', 'paid', 'payment_intent', 'paid'))),
    -- Lease renewals ---------------------------------------------------------------
    (wr_lease1, 'lease_renewal', 'active', 'user', r_johnson,
     p_cedar, u_cedar_102, r_johnson, demo_landlord, 'cron', 'leasing', 'acted',
     'renewal_offer_sent', now_ts - interval '16 days', null,
     jsonb_build_object('landlord_id', demo_landlord, 'unit_label', '103', 'building', 'Cedar Court',
       'lease_end_date', (current_date + 14)::text, 'notice_days', 60)),
    (wr_lease2, 'lease_renewal', 'escalated', 'user', r_freeman,
     p_oakwood, u_oak_506, r_freeman, demo_landlord, 'cron', 'leasing', 'escalated',
     'no_response', now_ts - interval '30 days', null,
     jsonb_build_object('landlord_id', demo_landlord, 'unit_label', '506', 'building', 'Oakwood Apartments',
       'lease_end_date', (current_date + 28)::text, 'notice_days', 60, 'reminders_sent', 3)),
    -- Move in -----------------------------------------------------------------------
    (wr_movein1, 'move_in', 'active', 'occupancy', o_patel,
     p_oakwood, u_oak_204, r_patel, demo_landlord, 'dashboard', 'move_in', 'initiated',
     'checklist_sent', now_ts - interval '4 days', null,
     jsonb_build_object('landlord_id', demo_landlord, 'unit_label', '204', 'building', 'Oakwood Apartments',
       'move_in_date', (current_date + 6)::text, 'occupancy_id', o_patel,
       'move_in_classification', 'new_lease',
       'step_state', jsonb_build_object('step', 'checklist_sent'))),
    (wr_movein2, 'move_in', 'completed', 'occupancy', o_mensah,
     p_cedar, u_cedar_102, r_mensah, demo_landlord, 'dashboard', 'move_in', 'logged',
     'completed', now_ts - interval '24 days', now_ts - interval '21 days',
     jsonb_build_object('landlord_id', demo_landlord, 'unit_label', '102', 'building', 'Cedar Court',
       'move_in_date', (current_date - 21)::text, 'move_in_classification', 'new_lease')),
    -- Move out ----------------------------------------------------------------------
    (wr_moveout1, 'move_out', 'active', 'occupancy', o_brooks,
     p_willow, u_willow_201, r_brooks, demo_landlord, 'dashboard', 'move_out', 'notice_sent',
     'turnover_tasks', now_ts - interval '12 days', null,
     jsonb_build_object('landlord_id', demo_landlord, 'unit_label', '201', 'building', 'Willow Park',
       'move_out_date', (current_date + 12)::text, 'occupancy_id', o_brooks,
       'move_out_classification', 'voluntary_move_out',
       'step_state', jsonb_build_object('step', 'turnover_tasks'))),
    (wr_moveout2, 'move_out', 'completed', null, null,
     p_birch, u_birch_410, null, demo_landlord, 'dashboard', 'move_out', 'logged',
     'completed', now_ts - interval '38 days', now_ts - interval '31 days',
     jsonb_build_object('landlord_id', demo_landlord, 'unit_label', '410', 'building', 'Birch Tower',
       'move_out_date', (current_date - 31)::text, 'move_out_classification', 'lease_end')),
    -- Inspections ---------------------------------------------------------------------
    (wr_insp1, 'inspection', 'active', 'inspection', insp_sched,
     p_cedar, u_cedar_305, r_nguyen, demo_landlord, 'dashboard', 'inspection', 'scheduled',
     'notice_sent', now_ts - interval '6 days', null,
     jsonb_build_object('landlord_id', demo_landlord, 'unit_label', '305', 'building', 'Cedar Court',
       'inspection_id', insp_sched, 'inspection_type', 'periodic',
       'scheduled_at', (now_ts + interval '5 days')::text, 'inspection_classification', 'periodic',
       'step_state', jsonb_build_object('step', 'notice_sent'))),
    (wr_insp2, 'inspection', 'completed', 'inspection', insp_done,
     p_oakwood, u_oak_205, r_rossi, demo_landlord, 'dashboard', 'inspection', 'completed',
     'completed', now_ts - interval '10 days', now_ts - interval '2 days',
     jsonb_build_object('landlord_id', demo_landlord, 'unit_label', '205', 'building', 'Oakwood Apartments',
       'inspection_id', insp_done, 'inspection_type', 'annual',
       'scheduled_at', (now_ts - interval '3 days')::text, 'inspection_classification', 'annual',
       'issue_found', true,
       'findings', jsonb_build_array('Kitchen sink leak', 'Cabinet base water damage'),
       'linked_maintenance_request_id', t09,
       'step_state', jsonb_build_object('step', 'completed', 'issue_found', true))),
    (wr_insp3, 'inspection', 'active', 'inspection', insp_overdue,
     p_maple, u_maple_312, null, demo_landlord, 'cron', 'inspection', 'scheduled',
     'awaiting_completion', now_ts - interval '9 days', null,
     jsonb_build_object('landlord_id', demo_landlord, 'unit_label', '312', 'building', 'Maple Heights',
       'inspection_id', insp_overdue, 'inspection_type', 'preventive',
       'scheduled_at', (now_ts - interval '2 days')::text, 'inspection_classification', 'preventive',
       'step_state', jsonb_build_object('step', 'awaiting_completion')));

  -- ---------------------------------------------------------------------------
  -- Inspection records
  -- ---------------------------------------------------------------------------
  insert into public.unit_inspections (
    id, landlord_id, inspection_type, status, workflow_run_id, property_id,
    unit_id, resident_id, occupancy_id, scheduled_at, notice_sent_at,
    completed_at, inspector_name, metadata
  )
  values
    (insp_sched, demo_landlord, 'periodic', 'notice_sent', wr_insp1, p_cedar,
     u_cedar_305, r_nguyen, o_nguyen, now_ts + interval '5 days', now_ts - interval '1 day',
     null, 'Ulo Field Team', jsonb_build_object('building', 'Cedar Court', 'unit_label', '305')),
    (insp_done, demo_landlord, 'annual', 'completed', wr_insp2, p_oakwood,
     u_oak_205, r_rossi, o_rossi, now_ts - interval '3 days', now_ts - interval '6 days',
     now_ts - interval '2 days', 'Ulo Field Team',
     jsonb_build_object('building', 'Oakwood Apartments', 'unit_label', '205',
       'issue_found', true,
       'findings', jsonb_build_array('Kitchen sink leak', 'Cabinet base water damage'),
       'linked_maintenance_request_id', t09)),
    (insp_overdue, demo_landlord, 'periodic', 'notice_sent', wr_insp3, p_maple,
     u_maple_312, null, null, now_ts - interval '2 days', now_ts - interval '7 days',
     null, 'Ulo Field Team', jsonb_build_object('building', 'Maple Heights', 'unit_label', '312'));

  -- ---------------------------------------------------------------------------
  -- Workflow timeline events
  -- ---------------------------------------------------------------------------
  insert into public.workflow_events (
    id, workflow_run_id, event_type, step, stage, actor_type, message,
    landlord_id, workflow_type, created_at
  )
  values
    (md5('ulo-demo-wfe-maint1-1')::uuid, wr_maint1, 'workflow.trigger', 'intake', 'trigger', 'system',
     'Emergency plumbing request received via SMS from Jordan Walker (Oakwood 304).', demo_landlord, 'maintenance', now_ts - interval '45 minutes'),
    (md5('ulo-demo-wfe-maint1-2')::uuid, wr_maint1, 'workflow.classify', 'classified', 'classify', 'system',
     'Classified urgent / plumbing. SLA due in 4 hours.', demo_landlord, 'maintenance', now_ts - interval '43 minutes'),
    (md5('ulo-demo-wfe-maint2-1')::uuid, wr_maint2, 'workflow.trigger', 'intake', 'trigger', 'system',
     'No-heat request received from Bianca Silva (Maple Heights 207).', demo_landlord, 'maintenance', now_ts - interval '3 hours'),
    (md5('ulo-demo-wfe-maint2-2')::uuid, wr_maint2, 'workflow.act', 'awaiting_vendor_accept', 'act', 'system',
     'Summit HVAC notified; awaiting acceptance.', demo_landlord, 'maintenance', now_ts - interval '2 hours'),
    (md5('ulo-demo-wfe-maint3-1')::uuid, wr_maint3, 'workflow.act', 'vendor_dispatch', 'act', 'system',
     'Rapid Rooter assigned to garbage disposal repair (Oakwood 506).', demo_landlord, 'maintenance', now_ts - interval '2 days'),
    (md5('ulo-demo-wfe-maint3-2')::uuid, wr_maint3, 'workflow.escalate', 'vendor_reassigned', 'escalate', 'system',
     'Rapid Rooter declined the assignment. Reassigned to Apex Plumbing Co.', demo_landlord, 'maintenance', now_ts - interval '3 hours'),
    (md5('ulo-demo-wfe-maint4-1')::uuid, wr_maint4, 'workflow.log', 'completed', 'log', 'system',
     'Supply line leak repaired by Apex Plumbing Co; resident confirmed.', demo_landlord, 'maintenance', now_ts - interval '16 days'),
    (md5('ulo-demo-wfe-maint5-1')::uuid, wr_maint5, 'workflow.log', 'completed', 'log', 'system',
     'AC restored by Summit HVAC during heat advisory.', demo_landlord, 'maintenance', now_ts - interval '11 days'),
    (md5('ulo-demo-wfe-rent1-1')::uuid, wr_rent1, 'rent.due_detected', 'classified', 'classify', 'system',
     'Rent due today for David Okafor — $1,450.', demo_landlord, 'rent', now_ts - interval '10 hours'),
    (md5('ulo-demo-wfe-rent1-2')::uuid, wr_rent1, 'rent.reminder_sent', 'reminder_sent', 'act', 'system',
     'Rent reminder sent via SMS to David Okafor.', demo_landlord, 'rent', now_ts - interval '9 hours'),
    (md5('ulo-demo-wfe-rent2-1')::uuid, wr_rent2, 'rent.reminder_sent', 'reminder_sent', 'act', 'system',
     'Overdue reminder sent via SMS + email to Grace Chen.', demo_landlord, 'rent', now_ts - interval '3 days'),
    (md5('ulo-demo-wfe-rent2-2')::uuid, wr_rent2, 'rent.payment_requested', 'payment_requested', 'act', 'system',
     'Payment link sent — $1,850 outstanding.', demo_landlord, 'rent', now_ts - interval '2 days'),
    (md5('ulo-demo-wfe-rent3-1')::uuid, wr_rent3, 'rent.reminder_sent', 'reminder_sent', 'act', 'system',
     'Overdue reminder sent to Marco Alvarez.', demo_landlord, 'rent', now_ts - interval '6 days'),
    (md5('ulo-demo-wfe-rent3-2')::uuid, wr_rent3, 'rent.late_escalated', 'late_escalation', 'escalate', 'system',
     'Rent 7 days late ($2,400). Escalated for account review.', demo_landlord, 'rent', now_ts - interval '1 day'),
    (md5('ulo-demo-wfe-rent4-1')::uuid, wr_rent4, 'rent.payment_received', 'paid', 'log', 'system',
     'Payment received in full from Haruto Ito — $1,950.', demo_landlord, 'rent', now_ts - interval '8 days'),
    (md5('ulo-demo-wfe-lease1-1')::uuid, wr_lease1, 'workflow.act', 'renewal_offer_sent', 'act', 'system',
     'Lease renewal offer sent to Sarah Johnson — lease ends in 14 days.', demo_landlord, 'leasing', now_ts - interval '14 days'),
    (md5('ulo-demo-wfe-lease2-1')::uuid, wr_lease2, 'workflow.escalate', 'no_response', 'escalate', 'system',
     'No response after 3 renewal reminders to Tessa Freeman. Escalated.', demo_landlord, 'leasing', now_ts - interval '2 days'),
    (md5('ulo-demo-wfe-movein1-1')::uuid, wr_movein1, 'move_in.started', 'initiated', 'trigger', 'system',
     'Move-in workflow started for Anita Patel (Oakwood 204).', demo_landlord, 'move_in', now_ts - interval '4 days'),
    (md5('ulo-demo-wfe-movein1-2')::uuid, wr_movein1, 'move_in.checklist_sent', 'checklist_sent', 'route', 'system',
     'Move-in checklist sent to Anita Patel.', demo_landlord, 'move_in', now_ts - interval '3 days'),
    (md5('ulo-demo-wfe-movein2-1')::uuid, wr_movein2, 'move_in.unit_activated', 'completed', 'log', 'system',
     'Abena Mensah moved in — Cedar Court 102 activated.', demo_landlord, 'move_in', now_ts - interval '21 days'),
    (md5('ulo-demo-wfe-moveout1-1')::uuid, wr_moveout1, 'move_out.started', 'initiated', 'trigger', 'system',
     'Move-out workflow started for Lamar Brooks (Willow Park 201).', demo_landlord, 'move_out', now_ts - interval '12 days'),
    (md5('ulo-demo-wfe-moveout1-2')::uuid, wr_moveout1, 'move_out.notice_sent', 'notice_sent', 'route', 'system',
     'Move-out notice and turnover checklist sent.', demo_landlord, 'move_out', now_ts - interval '10 days'),
    (md5('ulo-demo-wfe-moveout2-1')::uuid, wr_moveout2, 'move_out.unit_vacated', 'completed', 'log', 'system',
     'Birch Tower 410 vacated and turned over.', demo_landlord, 'move_out', now_ts - interval '31 days'),
    (md5('ulo-demo-wfe-insp1-1')::uuid, wr_insp1, 'inspection.scheduled', 'scheduled', 'route', 'system',
     'Periodic inspection scheduled for Cedar Court 305.', demo_landlord, 'inspection', now_ts - interval '6 days'),
    (md5('ulo-demo-wfe-insp1-2')::uuid, wr_insp1, 'inspection.notice_sent', 'notice_sent', 'act', 'system',
     'Inspection notice sent to Kim Nguyen.', demo_landlord, 'inspection', now_ts - interval '1 day'),
    (md5('ulo-demo-wfe-insp2-1')::uuid, wr_insp2, 'inspection.started', 'scheduled', 'trigger', 'system',
     'Annual inspection workflow started for Oakwood 205.', demo_landlord, 'inspection', now_ts - interval '10 days'),
    (md5('ulo-demo-wfe-insp2-2')::uuid, wr_insp2, 'workflow.log', 'completed', 'log', 'system',
     'Inspection completed — kitchen sink leak found; maintenance ticket opened.', demo_landlord, 'inspection', now_ts - interval '2 days'),
    (md5('ulo-demo-wfe-insp3-1')::uuid, wr_insp3, 'inspection.scheduled', 'scheduled', 'route', 'system',
     'Preventive inspection scheduled for Maple Heights 312.', demo_landlord, 'inspection', now_ts - interval '9 days');

  -- ---------------------------------------------------------------------------
  -- Property operations graph — feeds AI Operations Feed, Smart Insights,
  -- unit timelines, and connected history
  -- ---------------------------------------------------------------------------
  insert into public.property_operations_graph (
    id, landlord_id, property_id, unit_id, resident_id, vendor_id,
    workflow_run_id, event_type, event_source, event_payload, created_at
  )
  values
    -- Very recent events (AI Operations Feed)
    (md5('ulo-demo-graph-feed-1')::uuid, demo_landlord, p_oakwood, u_oak_304, r_walker, null, wr_maint1,
     'maintenance.ticket_created', 'sms',
     jsonb_build_object('message', 'Emergency plumbing ticket created from SMS — Oakwood 304.',
       'maintenance_request_id', t01, 'unit_label', '304', 'building', 'Oakwood Apartments', 'urgency', 'urgent'),
     now_ts - interval '45 minutes'),
    (md5('ulo-demo-graph-feed-2')::uuid, demo_landlord, p_maple, u_maple_207, r_silva, v_summit, wr_maint2,
     'maintenance.vendor_assigned', 'automation',
     jsonb_build_object('message', 'Summit HVAC auto-assigned to no-heat ticket — Maple Heights 207.',
       'maintenance_request_id', t03, 'unit_label', '207', 'building', 'Maple Heights'),
     now_ts - interval '2 hours'),
    (md5('ulo-demo-graph-feed-3')::uuid, demo_landlord, p_oakwood, u_oak_506, r_freeman, v_apex, wr_maint3,
     'maintenance.vendor_reassigned', 'automation',
     jsonb_build_object('message', 'Rapid Rooter declined — Apex Plumbing Co reassigned automatically.',
       'maintenance_request_id', t14, 'unit_label', '506', 'building', 'Oakwood Apartments'),
     now_ts - interval '3 hours'),
    (md5('ulo-demo-graph-feed-4')::uuid, demo_landlord, p_maple, u_maple_105, r_alvarez, null, wr_rent3,
     'rent.late_escalated', 'automation',
     jsonb_build_object('message', 'Late rent escalated — Marco Alvarez, 7 days overdue ($2,400).',
       'unit_label', '107', 'building', 'Maple Heights', 'amount_due', 2400),
     now_ts - interval '1 day'),
    (md5('ulo-demo-graph-feed-5')::uuid, demo_landlord, p_cedar, u_cedar_102, r_johnson, null, wr_lease1,
     'workflow.act', 'automation',
     jsonb_build_object('message', 'Lease renewal reminder sent to Sarah Johnson — lease ends in 14 days.',
       'unit_label', '103', 'building', 'Cedar Court', 'workflow_template_id', 'lease_renewal'),
     now_ts - interval '5 hours'),
    (md5('ulo-demo-graph-feed-6')::uuid, demo_landlord, p_oakwood, null, null, null, null,
     'maintenance.recurring_issue_detected', 'automation',
     jsonb_build_object('message', 'Recurring plumbing issues detected at Oakwood Apartments — 4 tickets in 60 days.',
       'building', 'Oakwood Apartments', 'issue_category', 'plumbing'),
     now_ts - interval '6 hours'),
    (md5('ulo-demo-graph-feed-7')::uuid, demo_landlord, p_maple, u_maple_312, null, v_summit, wr_insp3,
     'inspection.scheduled', 'automation',
     jsonb_build_object('message', 'Preventive HVAC inspection scheduled — Maple Heights 312.',
       'unit_label', '312', 'building', 'Maple Heights'),
     now_ts - interval '1 day 2 hours'),
    -- Maintenance domain history
    (md5('ulo-demo-graph-m1')::uuid, demo_landlord, p_birch, u_birch_1203, r_haddad, v_bright, null,
     'maintenance.vendor_assigned', 'dashboard',
     jsonb_build_object('message', 'Brightline Electrical dispatched for sparking breaker panel.',
       'maintenance_request_id', t02, 'unit_label', '1203', 'building', 'Birch Tower'),
     now_ts - interval '24 hours'),
    (md5('ulo-demo-graph-m2')::uuid, demo_landlord, p_oakwood, u_oak_108, null, v_apex, null,
     'maintenance.sla_overdue', 'automation',
     jsonb_build_object('message', 'SLA breached — sewage smell ticket past due at Oakwood 108.',
       'maintenance_request_id', t04, 'unit_label', '108', 'building', 'Oakwood Apartments'),
     now_ts - interval '5 hours'),
    (md5('ulo-demo-graph-m3')::uuid, demo_landlord, p_oakwood, u_oak_304, r_walker, v_apex, wr_maint4,
     'maintenance.completed', 'vendor_portal',
     jsonb_build_object('message', 'Supply line leak repaired — Oakwood 304.',
       'maintenance_request_id', t17, 'unit_label', '304', 'building', 'Oakwood Apartments'),
     now_ts - interval '16 days'),
    (md5('ulo-demo-graph-m4')::uuid, demo_landlord, p_birch, u_birch_107, null, v_summit, wr_maint5,
     'maintenance.completed', 'vendor_portal',
     jsonb_build_object('message', 'AC restored during heat advisory — Birch Tower 107.',
       'maintenance_request_id', t20, 'unit_label', '107', 'building', 'Birch Tower'),
     now_ts - interval '11 days'),
    -- Rent domain history
    (md5('ulo-demo-graph-r1')::uuid, demo_landlord, p_pine, null, r_okafor, null, wr_rent1,
     'rent.reminder_sent', 'sms',
     jsonb_build_object('message', 'Rent reminder sent to David Okafor — $1,450 due today.',
       'unit_label', '301', 'building', 'Pine Ridge'),
     now_ts - interval '9 hours'),
    (md5('ulo-demo-graph-r2')::uuid, demo_landlord, p_birch, null, r_chen, null, wr_rent2,
     'rent.payment_requested', 'sms',
     jsonb_build_object('message', 'Payment link sent to Grace Chen — $1,850 outstanding.',
       'unit_label', '402', 'building', 'Birch Tower'),
     now_ts - interval '2 days'),
    (md5('ulo-demo-graph-r3')::uuid, demo_landlord, p_birch, u_birch_410, r_ito, null, wr_rent4,
     'rent.payment_received', 'automation',
     jsonb_build_object('message', 'Rent paid in full by Haruto Ito — $1,950.',
       'unit_label', '410', 'building', 'Birch Tower'),
     now_ts - interval '8 days'),
    -- Lifecycle history
    (md5('ulo-demo-graph-l1')::uuid, demo_landlord, p_oakwood, u_oak_204, r_patel, null, wr_movein1,
     'move_in.started', 'dashboard',
     jsonb_build_object('message', 'Move-in workflow started for Anita Patel (Oakwood 204).',
       'unit_label', '204', 'building', 'Oakwood Apartments', 'move_in_date', (current_date + 6)::text),
     now_ts - interval '4 days'),
    (md5('ulo-demo-graph-l2')::uuid, demo_landlord, p_oakwood, u_oak_204, r_patel, null, wr_movein1,
     'move_in.checklist_sent', 'dashboard',
     jsonb_build_object('message', 'Move-in checklist sent to Anita Patel.',
       'unit_label', '204', 'building', 'Oakwood Apartments'),
     now_ts - interval '3 days'),
    (md5('ulo-demo-graph-l3')::uuid, demo_landlord, p_willow, u_willow_201, r_brooks, null, wr_moveout1,
     'move_out.started', 'dashboard',
     jsonb_build_object('message', 'Move-out workflow started for Lamar Brooks (Willow Park 201).',
       'unit_label', '201', 'building', 'Willow Park', 'move_out_date', (current_date + 12)::text),
     now_ts - interval '12 days'),
    (md5('ulo-demo-graph-l4')::uuid, demo_landlord, p_willow, u_willow_201, r_brooks, null, wr_moveout1,
     'move_out.notice_sent', 'dashboard',
     jsonb_build_object('message', 'Move-out notice and turnover checklist sent to Lamar Brooks.',
       'unit_label', '201', 'building', 'Willow Park'),
     now_ts - interval '10 days'),
    (md5('ulo-demo-graph-l5')::uuid, demo_landlord, p_cedar, u_cedar_102, r_mensah, null, wr_movein2,
     'move_in.unit_activated', 'dashboard',
     jsonb_build_object('message', 'Abena Mensah moved in — Cedar Court 102 activated.',
       'unit_label', '102', 'building', 'Cedar Court'),
     now_ts - interval '21 days'),
    -- Inspection history
    (md5('ulo-demo-graph-i1')::uuid, demo_landlord, p_cedar, u_cedar_305, r_nguyen, null, wr_insp1,
     'inspection.notice_sent', 'dashboard',
     jsonb_build_object('message', 'Inspection notice sent to Kim Nguyen — Cedar Court 305.',
       'unit_label', '305', 'building', 'Cedar Court', 'inspection_id', insp_sched),
     now_ts - interval '1 day'),
    (md5('ulo-demo-graph-i2')::uuid, demo_landlord, p_oakwood, u_oak_205, r_rossi, null, wr_insp2,
     'inspection.completed', 'dashboard',
     jsonb_build_object('message', 'Annual inspection completed — issue found at Oakwood 205.',
       'unit_label', '205', 'building', 'Oakwood Apartments', 'inspection_id', insp_done,
       'issue_found', true),
     now_ts - interval '2 days'),
    (md5('ulo-demo-graph-i3')::uuid, demo_landlord, p_oakwood, u_oak_205, r_rossi, null, wr_insp2,
     'maintenance.ticket_created', 'dashboard',
     jsonb_build_object('message', 'Maintenance ticket opened from inspection finding — kitchen sink leak.',
       'maintenance_request_id', t09, 'inspection_id', insp_done,
       'unit_label', '205', 'building', 'Oakwood Apartments'),
     now_ts - interval '2 days');

  -- ---------------------------------------------------------------------------
  -- Legacy graph bridge — vendor activity + SMS automation (event types outside
  -- the canonical prefix set live here; the feed merges both tables)
  -- ---------------------------------------------------------------------------
  insert into public.operations_graph_events (
    id, landlord_id, event_type, source, property_id, unit_id, resident_id,
    vendor_id, maintenance_request_id, metadata, created_at
  )
  values
    (md5('ulo-demo-bridge-v1')::uuid, demo_landlord, 'vendor.job_accepted', 'vendor_portal',
     p_cedar, u_cedar_102, r_mensah, v_rooter, t06,
     jsonb_build_object('message', 'Rapid Rooter accepted ceiling leak job — Cedar Court 102.',
       'unit_label', '102', 'building', 'Cedar Court'),
     now_ts - interval '28 hours'),
    (md5('ulo-demo-bridge-v2')::uuid, demo_landlord, 'vendor.declined', 'vendor_portal',
     p_oakwood, u_oak_506, r_freeman, v_rooter, t14,
     jsonb_build_object('message', 'Rapid Rooter declined garbage disposal job — Oakwood 506.',
       'unit_label', '506', 'building', 'Oakwood Apartments'),
     now_ts - interval '4 hours'),
    (md5('ulo-demo-bridge-v3')::uuid, demo_landlord, 'sms.auto_reply', 'sms',
     null, null, null, null, null,
     jsonb_build_object('message', 'Auto-replied to 8 resident inquiries in the last 24 hours.'),
     now_ts - interval '1 day 4 hours');

  -- ---------------------------------------------------------------------------
  -- Vendor scoring — status-event timing + resident feedback for vendor_score_view
  -- (requires 20260615150000_vendor_feedback_scoring.sql)
  -- ---------------------------------------------------------------------------
  if to_regclass('public.vendor_feedback') is not null then
    insert into public.vendor_scoring_settings (landlord_id, rework_window_days)
    values (demo_landlord, 30)
    on conflict (landlord_id) do update
      set rework_window_days = excluded.rework_window_days,
          updated_at = now();

    update public.maintenance_requests mr
    set vendor_notified_at = coalesce(mr.vendor_notified_at, mr.assigned_at)
    where mr.landlord_id = demo_landlord
      and mr.assigned_vendor_id is not null
      and mr.assigned_at is not null
      and mr.vendor_work_status = 'completed';

    insert into public.vendor_status_events (ticket_id, created_at, from_status, to_status, source, vendor_id)
    select
      mr.id,
      mr.assigned_at + offs.step_offset,
      offs.from_status,
      offs.to_status,
      'portal',
      mr.assigned_vendor_id
    from public.maintenance_requests mr
    cross join lateral (
      values
        (interval '38 minutes', 'pending_accept', 'accepted'),
        (interval '2 hours 10 minutes', 'accepted', 'in_progress'),
        (interval '1 day 8 hours', 'in_progress', 'completed')
    ) as offs(step_offset, from_status, to_status)
    where mr.landlord_id = demo_landlord
      and mr.vendor_work_status = 'completed'
      and mr.assigned_at is not null
      and mr.assigned_vendor_id is not null
      and mr.id in (t17, t18, t19, t20, t21, t22, t23, t24, t25, t26, t29);

    -- Partial vendor progression on active assigned jobs (response / completion metrics)
    insert into public.vendor_status_events (ticket_id, created_at, from_status, to_status, source, vendor_id)
    values
      (t02, now_ts - interval '23 hours', 'pending_accept', 'accepted', 'portal', v_bright),
      (t02, now_ts - interval '22 hours', 'accepted', 'in_progress', 'portal', v_bright),
      (t04, now_ts - interval '2 days 12 hours', 'pending_accept', 'accepted', 'portal', v_apex),
      (t06, now_ts - interval '27 hours', 'pending_accept', 'accepted', 'portal', v_rooter),
      (t06, now_ts - interval '26 hours', 'accepted', 'in_progress', 'portal', v_rooter),
      (t08, now_ts - interval '3 days', 'pending_accept', 'accepted', 'portal', v_allied),
      (t10, now_ts - interval '18 hours', 'pending_accept', 'accepted', 'portal', v_summit),
      (t30, now_ts - interval '7 days 6 hours', 'pending_accept', 'accepted', 'portal', v_metro),
      (t30, now_ts - interval '7 days', 'accepted', 'in_progress', 'portal', v_metro);

    insert into public.vendor_feedback (
      landlord_id, vendor_id, maintenance_request_id, resident_id, rating, comment, submitted_at
    )
    values
      (demo_landlord, v_apex, t17, r_walker, 5, null, now_ts - interval '16 days'),
      (demo_landlord, v_apex, t26, null, 4, null, now_ts - interval '67 days'),
      (demo_landlord, v_rooter, t18, null, 5, null, now_ts - interval '21 days'),
      (demo_landlord, v_bright, t19, r_patel, 4, null, now_ts - interval '27 days'),
      (demo_landlord, v_summit, t20, null, 5, null, now_ts - interval '10 days'),
      (demo_landlord, v_summit, t22, r_silva, 3, 'Took two visits to fully fix the thermostat.', now_ts - interval '44 days'),
      (demo_landlord, v_allied, t21, r_ito, 4, null, now_ts - interval '35 days'),
      (demo_landlord, v_allied, t25, r_nguyen, 5, null, now_ts - interval '59 days'),
      (demo_landlord, v_metro, t23, null, 2, 'Leak returned after one week.', now_ts - interval '50 days'),
      (demo_landlord, v_fresh, t24, r_okafor, 5, null, now_ts - interval '15 days'),
      (demo_landlord, v_metro, t29, r_okafor, 3, 'Fixed quickly but leak came back within two weeks.', now_ts - interval '24 days');
  end if;

  raise notice 'Demo Property Management seeded: 582 units across 6 properties, % residents, % vendors, % tickets, % workflow runs.',
    (select count(*) from public.users where landlord_id = demo_landlord),
    (select count(*) from public.vendors where landlord_id = demo_landlord),
    (select count(*) from public.maintenance_requests where landlord_id = demo_landlord),
    (select count(*) from public.workflow_runs where landlord_id = demo_landlord);
end $$;
