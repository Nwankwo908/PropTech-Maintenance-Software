-- =============================================================================
-- Demo patch: refresh Ulo Activity Feed showcase events (recent timestamps)
-- Safe to run without a full landlord account reseed.
--
-- Why: hourly workflow/rent cron rows bury the original seed's ~1-month-old
-- graph events in the client fetch window. Re-stamp landlord-facing outcomes
-- to "now" so the bell feed is full for Try Demo / Overview.
-- =============================================================================

do $$
declare
  demo_landlord uuid := 'de300000-0000-4000-8000-000000000001';
  now_ts timestamptz := now();

  p_oakwood uuid;
  p_pine uuid;
  p_cedar uuid;
  p_maple uuid;
  p_birch uuid;
  p_willow uuid;

  u_oak_304 uuid; u_oak_506 uuid; u_oak_108 uuid; u_oak_204 uuid; u_oak_205 uuid;
  u_maple_207 uuid; u_maple_105 uuid;
  u_birch_410 uuid; u_birch_708 uuid; u_birch_1203 uuid; u_birch_402 uuid; u_birch_107 uuid;
  u_cedar_102 uuid; u_cedar_305 uuid;
  u_pine_305 uuid; u_willow_201 uuid;

  r_walker uuid := md5('ulo-demo-res-jordan-walker')::uuid;
  r_silva uuid := md5('ulo-demo-res-bianca-silva')::uuid;
  r_freeman uuid := md5('ulo-demo-res-tessa-freeman')::uuid;
  r_ito uuid := md5('ulo-demo-res-haruto-ito')::uuid;
  r_alvarez uuid := md5('ulo-demo-res-marco-alvarez')::uuid;
  r_johnson uuid := md5('ulo-demo-res-sarah-johnson')::uuid;
  r_oconnor uuid := md5('ulo-demo-res-liam-oconnor')::uuid;
  r_haddad uuid := md5('ulo-demo-res-omar-haddad')::uuid;
  r_chen uuid := md5('ulo-demo-res-grace-chen')::uuid;
  r_okafor uuid := md5('ulo-demo-res-david-okafor')::uuid;
  r_patel uuid := md5('ulo-demo-res-anita-patel')::uuid;
  r_brooks uuid := md5('ulo-demo-res-lamar-brooks')::uuid;
  r_nguyen uuid := md5('ulo-demo-res-kim-nguyen')::uuid;
  r_rossi uuid := md5('ulo-demo-res-elena-rossi')::uuid;
  r_mensah uuid := md5('ulo-demo-res-abena-mensah')::uuid;
  r_kowalski uuid := md5('ulo-demo-res-piotr-kowalski')::uuid;

  v_summit uuid := md5('ulo-demo-vendor-summit-hvac')::uuid;
  v_apex uuid := md5('ulo-demo-vendor-apex-plumbing')::uuid;
  v_bright uuid := md5('ulo-demo-vendor-brightline-electrical')::uuid;
  v_metro uuid := md5('ulo-demo-vendor-metro-plumbing')::uuid;
  v_rooter uuid := md5('ulo-demo-vendor-rapid-rooter')::uuid;

  t01 uuid := md5('ulo-demo-ticket-01')::uuid;
  t02 uuid := md5('ulo-demo-ticket-02')::uuid;
  t03 uuid := md5('ulo-demo-ticket-03')::uuid;
  t04 uuid := md5('ulo-demo-ticket-04')::uuid;
  t05 uuid := md5('ulo-demo-ticket-05')::uuid;
  t06 uuid := md5('ulo-demo-ticket-06')::uuid;
  t09 uuid := md5('ulo-demo-ticket-09')::uuid;
  t11 uuid := md5('ulo-demo-ticket-11')::uuid;
  t14 uuid := md5('ulo-demo-ticket-14')::uuid;
  t17 uuid := md5('ulo-demo-ticket-17')::uuid;
  t20 uuid := md5('ulo-demo-ticket-20')::uuid;
  t31 uuid := md5('ulo-demo-ticket-31')::uuid;

  wr_maint1 uuid := md5('ulo-demo-run-maint-1')::uuid;
  wr_maint2 uuid := md5('ulo-demo-run-maint-2')::uuid;
  wr_maint3 uuid := md5('ulo-demo-run-maint-3')::uuid;
  wr_maint4 uuid := md5('ulo-demo-run-maint-4')::uuid;
  wr_maint5 uuid := md5('ulo-demo-run-maint-5')::uuid;
  wr_maint6 uuid := md5('ulo-demo-run-maint-6')::uuid;
  wr_maint7 uuid := md5('ulo-demo-run-maint-7')::uuid;
  wr_rent1 uuid := md5('ulo-demo-run-rent-1')::uuid;
  wr_rent2 uuid := md5('ulo-demo-run-rent-2')::uuid;
  wr_rent3 uuid := md5('ulo-demo-run-rent-3')::uuid;
  wr_rent4 uuid := md5('ulo-demo-run-rent-4')::uuid;
  wr_lease1 uuid := md5('ulo-demo-run-lease-1')::uuid;
  wr_lease3 uuid := md5('ulo-demo-run-lease-3')::uuid;
  wr_movein1 uuid := md5('ulo-demo-run-movein-1')::uuid;
  wr_moveout1 uuid := md5('ulo-demo-run-moveout-1')::uuid;
  wr_insp1 uuid := md5('ulo-demo-run-insp-1')::uuid;
  wr_insp2 uuid := md5('ulo-demo-run-insp-2')::uuid;
  wr_insp3 uuid := md5('ulo-demo-run-insp-3')::uuid;

  insp_sched uuid := md5('ulo-demo-insp-scheduled')::uuid;
  insp_done uuid := md5('ulo-demo-insp-completed')::uuid;

  upserted integer := 0;
begin
  if not exists (select 1 from public.landlords where id = demo_landlord) then
    raise exception 'demo landlord missing';
  end if;

  if not exists (
    select 1 from public.maintenance_requests
    where landlord_id = demo_landlord and id = t01
  ) then
    raise exception 'demo tickets missing — run seed_demo_landlord_account.sql first';
  end if;

  p_oakwood := public.derive_property_id(demo_landlord, 'Oakwood Apartments');
  p_pine := public.derive_property_id(demo_landlord, 'Pine Ridge');
  p_cedar := public.derive_property_id(demo_landlord, 'Cedar Court');
  p_maple := public.derive_property_id(demo_landlord, 'Maple Heights');
  p_birch := public.derive_property_id(demo_landlord, 'Birch Tower');
  p_willow := public.derive_property_id(demo_landlord, 'Willow Park');

  select id into u_oak_304 from public.units
    where landlord_id = demo_landlord and building = 'Oakwood Apartments' and unit_label = '304';
  select id into u_oak_506 from public.units
    where landlord_id = demo_landlord and building = 'Oakwood Apartments' and unit_label = '506';
  select id into u_oak_108 from public.units
    where landlord_id = demo_landlord and building = 'Oakwood Apartments' and unit_label = '108';
  select id into u_oak_204 from public.units
    where landlord_id = demo_landlord and building = 'Oakwood Apartments' and unit_label = '204';
  select id into u_oak_205 from public.units
    where landlord_id = demo_landlord and building = 'Oakwood Apartments' and unit_label = '205';
  select id into u_maple_207 from public.units
    where landlord_id = demo_landlord and building = 'Maple Heights' and unit_label = '207';
  select id into u_maple_105 from public.units
    where landlord_id = demo_landlord and building = 'Maple Heights' and unit_label = '105';
  select id into u_birch_410 from public.units
    where landlord_id = demo_landlord and building = 'Birch Tower' and unit_label = '410';
  select id into u_birch_708 from public.units
    where landlord_id = demo_landlord and building = 'Birch Tower' and unit_label = '708';
  select id into u_birch_1203 from public.units
    where landlord_id = demo_landlord and building = 'Birch Tower' and unit_label = '1203';
  select id into u_birch_402 from public.units
    where landlord_id = demo_landlord and building = 'Birch Tower' and unit_label = '402';
  select id into u_birch_107 from public.units
    where landlord_id = demo_landlord and building = 'Birch Tower' and unit_label = '107';
  select id into u_cedar_102 from public.units
    where landlord_id = demo_landlord and building = 'Cedar Court' and unit_label = '102';
  select id into u_cedar_305 from public.units
    where landlord_id = demo_landlord and building = 'Cedar Court' and unit_label = '305';
  select id into u_pine_305 from public.units
    where landlord_id = demo_landlord and building = 'Pine Ridge' and unit_label = '305';
  select id into u_willow_201 from public.units
    where landlord_id = demo_landlord and building = 'Willow Park' and unit_label = '201';

  insert into public.property_operations_graph (
    id, landlord_id, property_id, unit_id, resident_id, vendor_id,
    workflow_run_id, event_type, event_source, event_payload, created_at
  )
  values
    (md5('ulo-demo-graph-feed-1')::uuid, demo_landlord, p_oakwood, u_oak_304, r_walker, null, wr_maint1,
     'maintenance.ticket_created', 'sms',
     jsonb_build_object('message', 'Emergency plumbing ticket created from SMS — Oakwood 304.',
       'maintenance_request_id', t01, 'unit_label', '304', 'building', 'Oakwood Apartments', 'urgency', 'urgent'),
     now_ts - interval '45 minutes'),
    (md5('ulo-demo-graph-feed-7')::uuid, demo_landlord, p_pine, u_pine_305, r_kowalski, null, wr_insp3,
     'maintenance.ticket_created', 'sms',
     jsonb_build_object('message', 'Urgent gas-smell ticket created from SMS — Pine Ridge 305.',
       'maintenance_request_id', t05, 'unit_label', '305', 'building', 'Pine Ridge', 'urgency', 'urgent'),
     now_ts - interval '70 minutes'),
    (md5('ulo-demo-graph-feed-2')::uuid, demo_landlord, p_maple, u_maple_207, r_silva, v_summit, wr_maint2,
     'maintenance.vendor_assigned', 'automation',
     jsonb_build_object('message', 'Summit HVAC auto-assigned to no-heat ticket — Maple Heights 207.',
       'maintenance_request_id', t03, 'unit_label', '207', 'building', 'Maple Heights'),
     now_ts - interval '2 hours'),
    (md5('ulo-demo-graph-feed-3b')::uuid, demo_landlord, p_birch, u_birch_410, r_ito, null, wr_maint6,
     'maintenance.vendor_declined_needs_vendor', 'automation',
     jsonb_build_object('message', 'Cleaning vendor declined with no vendor in roster — admin must assign or onboard a vendor.',
       'maintenance_request_id', t11, 'unit_label', '410', 'building', 'Birch Tower'),
     now_ts - interval '2 hours 20 minutes'),
    (md5('ulo-demo-graph-feed-3')::uuid, demo_landlord, p_oakwood, u_oak_506, r_freeman, v_apex, wr_maint3,
     'maintenance.vendor_reassigned', 'automation',
     jsonb_build_object('message', 'Rapid Rooter declined — Apex Plumbing Co reassigned automatically.',
       'maintenance_request_id', t14, 'unit_label', '506', 'building', 'Oakwood Apartments'),
     now_ts - interval '3 hours'),
    (md5('ulo-demo-graph-m2')::uuid, demo_landlord, p_oakwood, u_oak_108, null, v_apex, null,
     'maintenance.sla_overdue', 'automation',
     jsonb_build_object('message', 'SLA breached — sewage smell ticket past due at Oakwood 108.',
       'maintenance_request_id', t04, 'unit_label', '108', 'building', 'Oakwood Apartments'),
     now_ts - interval '5 hours'),
    (md5('ulo-demo-graph-feed-5')::uuid, demo_landlord, p_cedar, u_cedar_102, r_johnson, null, wr_lease1,
     'lease.renewal_reminder_sent', 'automation',
     jsonb_build_object('message', 'Lease renewal reminder sent to Sarah Johnson — lease ends in 14 days.',
       'unit_label', '103', 'building', 'Cedar Court', 'workflow_template_id', 'lease_renewal'),
     now_ts - interval '5 hours 30 minutes'),
    (md5('ulo-demo-graph-feed-5b')::uuid, demo_landlord, p_birch, u_birch_708, r_oconnor, null, wr_lease3,
     'workflow.escalate', 'automation',
     jsonb_build_object('message', 'Lease renewal escalated — no response from Liam O''Connor.',
       'unit_label', '708', 'building', 'Birch Tower', 'workflow_template_id', 'lease_renewal'),
     now_ts - interval '6 hours'),
    (md5('ulo-demo-graph-feed-6')::uuid, demo_landlord, p_oakwood, null, null, null, null,
     'maintenance.recurring_issue_detected', 'automation',
     jsonb_build_object('message', 'Recurring plumbing issues detected at Oakwood Apartments — 4 tickets in 60 days.',
       'building', 'Oakwood Apartments', 'issue_category', 'plumbing'),
     now_ts - interval '6 hours 30 minutes'),
    (md5('ulo-demo-graph-r1')::uuid, demo_landlord, p_pine, null, r_okafor, null, wr_rent1,
     'rent.reminder_sent', 'sms',
     jsonb_build_object('message', 'Rent reminder sent to David Okafor — $1,450 due today.',
       'unit_label', '301', 'building', 'Pine Ridge'),
     now_ts - interval '9 hours'),
    (md5('ulo-demo-graph-feed-4')::uuid, demo_landlord, p_maple, u_maple_105, r_alvarez, null, wr_rent3,
     'rent.late_escalated', 'automation',
     jsonb_build_object('message', 'Late rent escalated — Marco Alvarez, 7 days overdue ($2,400).',
       'unit_label', '107', 'building', 'Maple Heights', 'amount_due', 2400),
     now_ts - interval '1 day'),
    (md5('ulo-demo-graph-i1')::uuid, demo_landlord, p_cedar, u_cedar_305, r_nguyen, null, wr_insp1,
     'inspection.notice_sent', 'dashboard',
     jsonb_build_object('message', 'Inspection notice sent to Kim Nguyen — Cedar Court 305.',
       'unit_label', '305', 'building', 'Cedar Court', 'inspection_id', insp_sched),
     now_ts - interval '1 day 2 hours'),
    (md5('ulo-demo-graph-m1')::uuid, demo_landlord, p_birch, u_birch_1203, r_haddad, v_bright, null,
     'maintenance.vendor_assigned', 'dashboard',
     jsonb_build_object('message', 'Brightline Electrical dispatched for sparking breaker panel.',
       'maintenance_request_id', t02, 'unit_label', '1203', 'building', 'Birch Tower'),
     now_ts - interval '26 hours'),
    (md5('ulo-demo-graph-m1b')::uuid, demo_landlord, p_birch, u_birch_402, r_chen, v_metro, wr_maint7,
     'maintenance.vendor_assigned', 'dashboard',
     jsonb_build_object('message', 'Metro Plumbing accepted dishwasher backup repair — Birch Tower 402.',
       'maintenance_request_id', t31, 'unit_label', '402', 'building', 'Birch Tower'),
     now_ts - interval '34 hours'),
    (md5('ulo-demo-graph-r2')::uuid, demo_landlord, p_birch, null, r_chen, null, wr_rent2,
     'rent.payment_requested', 'sms',
     jsonb_build_object('message', 'Payment link sent to Grace Chen — $1,850 outstanding.',
       'unit_label', '402', 'building', 'Birch Tower'),
     now_ts - interval '2 days'),
    (md5('ulo-demo-graph-i2')::uuid, demo_landlord, p_oakwood, u_oak_205, r_rossi, null, wr_insp2,
     'inspection.completed', 'dashboard',
     jsonb_build_object('message', 'Annual inspection completed — issue found at Oakwood 205.',
       'unit_label', '205', 'building', 'Oakwood Apartments', 'inspection_id', insp_done,
       'issue_found', true),
     now_ts - interval '2 days 4 hours'),
    (md5('ulo-demo-graph-i3')::uuid, demo_landlord, p_oakwood, u_oak_205, r_rossi, null, wr_insp2,
     'maintenance.ticket_created', 'dashboard',
     jsonb_build_object('message', 'Maintenance ticket opened from inspection finding — kitchen sink leak.',
       'maintenance_request_id', t09, 'inspection_id', insp_done,
       'unit_label', '205', 'building', 'Oakwood Apartments'),
     now_ts - interval '2 days 5 hours'),
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
     now_ts - interval '5 days'),
    (md5('ulo-demo-graph-l4')::uuid, demo_landlord, p_willow, u_willow_201, r_brooks, null, wr_moveout1,
     'move_out.notice_sent', 'dashboard',
     jsonb_build_object('message', 'Move-out notice and turnover checklist sent to Lamar Brooks.',
       'unit_label', '201', 'building', 'Willow Park'),
     now_ts - interval '4 days 12 hours'),
    (md5('ulo-demo-graph-r3')::uuid, demo_landlord, p_birch, u_birch_410, r_ito, null, wr_rent4,
     'rent.payment_received', 'automation',
     jsonb_build_object('message', 'Rent paid in full by Haruto Ito — $1,950.',
       'unit_label', '410', 'building', 'Birch Tower'),
     now_ts - interval '8 days'),
    (md5('ulo-demo-graph-m3')::uuid, demo_landlord, p_oakwood, u_oak_304, r_walker, v_apex, wr_maint4,
     'maintenance.completed', 'vendor_portal',
     jsonb_build_object('message', 'Supply line leak repaired — Oakwood 304.',
       'maintenance_request_id', t17, 'unit_label', '304', 'building', 'Oakwood Apartments'),
     now_ts - interval '16 days'),
    (md5('ulo-demo-graph-m4')::uuid, demo_landlord, p_birch, u_birch_107, null, v_summit, wr_maint5,
     'maintenance.completed', 'vendor_portal',
     jsonb_build_object('message', 'AC restored during heat advisory — Birch Tower 107.',
       'maintenance_request_id', t20, 'unit_label', '107', 'building', 'Birch Tower'),
     now_ts - interval '11 days')
  on conflict (id) do update set
    landlord_id = excluded.landlord_id,
    property_id = excluded.property_id,
    unit_id = excluded.unit_id,
    resident_id = excluded.resident_id,
    vendor_id = excluded.vendor_id,
    workflow_run_id = excluded.workflow_run_id,
    event_type = excluded.event_type,
    event_source = excluded.event_source,
    event_payload = excluded.event_payload,
    created_at = excluded.created_at;

  get diagnostics upserted = row_count;

  -- Bridge rows that live on operations_graph_events (vendor accept / decline / SMS summary)
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
     now_ts - interval '1 day 4 hours')
  on conflict (id) do update set
    landlord_id = excluded.landlord_id,
    event_type = excluded.event_type,
    source = excluded.source,
    property_id = excluded.property_id,
    unit_id = excluded.unit_id,
    resident_id = excluded.resident_id,
    vendor_id = excluded.vendor_id,
    maintenance_request_id = excluded.maintenance_request_id,
    metadata = excluded.metadata,
    created_at = excluded.created_at;

  raise notice 'Demo Ulo Activity Feed patch: upserted % landlord-facing graph events.', upserted;
end $$;
