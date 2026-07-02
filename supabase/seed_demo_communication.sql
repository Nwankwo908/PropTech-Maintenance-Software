-- =============================================================================
-- Demo Property Management — Communication (Conversations) inbox seed
-- =============================================================================
-- Account: Demo Property Management <demo@ulohome.io>
-- Landlord id: de300000-0000-4000-8000-000000000001
--
-- Populates the unified Communication inbox (AdminCommunicationDashboard.tsx)
-- and property detail Conversations tabs:
--   * 1 landlord SMS number (provisioned)
--   * 9 conversations across tenant / vendor / Ulo AI copilot
--   * Birch Tower vendor SMS threads for assigned maintenance (1203, 708, 402)
--   * messages providing the preview text + relative timestamps
--
-- Reuses residents / vendors / units already seeded by
-- supabase/seed_demo_landlord_account.sql — run that first.
--
-- Requires migration 20260615120000_sms_conversation_ai_copilot.sql
-- (adds the 'ai_copilot' conversation_type).
--
-- Idempotent: deletes the demo landlord's conversations + messages, re-inserts.
-- Run after the main demo seed:
--   psql "$DATABASE_URL" -f supabase/seed_demo_communication.sql
-- Or paste into the Supabase SQL Editor.
-- =============================================================================

do $$
declare
  demo_landlord uuid := 'de300000-0000-4000-8000-000000000001';
  now_ts timestamptz := now();
  ulo_number text := '+15550100100';

  num_main uuid := md5('ulo-demo-sms-number-main')::uuid;

  -- Residents (match seed_demo_landlord_account.sql)
  r_johnson uuid := md5('ulo-demo-res-sarah-johnson')::uuid;   -- Cedar Court 103
  r_okafor uuid := md5('ulo-demo-res-david-okafor')::uuid;     -- Pine Ridge 301
  r_alvarez uuid := md5('ulo-demo-res-marco-alvarez')::uuid;   -- Maple Heights 107 (late rent)
  r_walker uuid := md5('ulo-demo-res-jordan-walker')::uuid;    -- Oakwood 304 (emergency plumbing)

  -- Vendors
  v_metro uuid := md5('ulo-demo-vendor-metro-plumbing')::uuid;
  v_summit uuid := md5('ulo-demo-vendor-summit-hvac')::uuid;
  v_bright uuid := md5('ulo-demo-vendor-brightline-electrical')::uuid;

  -- Tickets (for the "Maintenance · …" status prefix)
  t01 uuid := md5('ulo-demo-ticket-01')::uuid;   -- emergency plumbing Oakwood 304
  t02 uuid := md5('ulo-demo-ticket-02')::uuid;   -- electrical Birch 1203
  t07 uuid := md5('ulo-demo-ticket-07')::uuid;   -- electrical Birch 708
  t18 uuid := md5('ulo-demo-ticket-18')::uuid;   -- completed plumbing Oakwood 103
  t31 uuid := md5('ulo-demo-ticket-31')::uuid;   -- plumbing Birch 402

  -- Units (looked up below)
  u_pine_204 uuid;
  u_birch_410 uuid;
  u_birch_1203 uuid;
  u_birch_708 uuid;
  u_birch_402 uuid;

  -- Conversations
  c_sarah uuid := md5('ulo-demo-conv-sarah-ac')::uuid;
  c_metro uuid := md5('ulo-demo-conv-metro-valve')::uuid;
  c_ai_oak uuid := md5('ulo-demo-conv-ai-oakwood')::uuid;
  c_david uuid := md5('ulo-demo-conv-david-faucet')::uuid;
  c_ai_maple uuid := md5('ulo-demo-conv-ai-maple-rent')::uuid;
  c_summit uuid := md5('ulo-demo-conv-summit-inspection')::uuid;
  c_bright_1203 uuid := md5('ulo-demo-conv-bright-1203')::uuid;
  c_bright_708 uuid := md5('ulo-demo-conv-bright-708')::uuid;
  c_metro_402 uuid := md5('ulo-demo-conv-metro-402')::uuid;
begin
  if not exists (select 1 from public.landlords where id = demo_landlord) then
    raise exception 'demo landlord missing — run 20260611120000_landlord_accounts.sql first';
  end if;
  if not exists (select 1 from public.users where id = r_johnson and landlord_id = demo_landlord) then
    raise exception 'demo residents missing — run seed_demo_landlord_account.sql first';
  end if;

  select id into u_pine_204 from public.units
    where landlord_id = demo_landlord and building = 'Pine Ridge' and unit_label = '204';
  select id into u_birch_410 from public.units
    where landlord_id = demo_landlord and building = 'Birch Tower' and unit_label = '410';
  select id into u_birch_1203 from public.units
    where landlord_id = demo_landlord and building = 'Birch Tower' and unit_label = '1203';
  select id into u_birch_708 from public.units
    where landlord_id = demo_landlord and building = 'Birch Tower' and unit_label = '708';
  select id into u_birch_402 from public.units
    where landlord_id = demo_landlord and building = 'Birch Tower' and unit_label = '402';

  -- ---------------------------------------------------------------------------
  -- Cleanup (idempotent re-run) — only this landlord's SMS data
  -- ---------------------------------------------------------------------------
  delete from public.sms_messages where landlord_id = demo_landlord;
  delete from public.sms_conversations where landlord_id = demo_landlord;
  delete from public.sms_numbers where landlord_id = demo_landlord;

  -- ---------------------------------------------------------------------------
  -- Provisioned landlord SMS number
  -- ---------------------------------------------------------------------------
  insert into public.sms_numbers (id, landlord_id, phone_number, provider, status, purpose, created_at)
  values (num_main, demo_landlord, ulo_number, 'twilio', 'active', 'landlord_main', now_ts - interval '120 days');

  -- ---------------------------------------------------------------------------
  -- Conversations
  -- ---------------------------------------------------------------------------
  insert into public.sms_conversations (
    id, landlord_id, sms_number_id, external_phone_number,
    resident_id, vendor_id, unit_id, maintenance_request_id,
    conversation_type, status, created_at, updated_at
  )
  values
    -- 1. Tenant — Sarah Johnson — AC outage (unread, in progress)
    (c_sarah, demo_landlord, num_main, '+15555620001',
     r_johnson, null, null, t01,
     'resident_intake', 'in_progress', now_ts - interval '3 hours', now_ts - interval '2 minutes'),
    -- 2. Vendor — Metro Plumbing — repair completed
    (c_metro, demo_landlord, num_main, '+15555610008',
     null, v_metro, u_pine_204, t18,
     'vendor_alert', 'completed', now_ts - interval '2 days', now_ts - interval '12 minutes'),
    -- 3. Ulo AI — auto-routed vendor for Oakwood 304 emergency
    (c_ai_oak, demo_landlord, num_main, ulo_number,
     r_walker, null, null, null,
     'ai_copilot', 'completed', now_ts - interval '50 minutes', now_ts - interval '18 minutes'),
    -- 4. Tenant — David Okafor — resolved faucet
    (c_david, demo_landlord, num_main, '+15555620004',
     r_okafor, null, null, null,
     'resident_intake', 'resolved', now_ts - interval '2 days', now_ts - interval '1 hour'),
    -- 5. Ulo AI — sent late-rent reminder (Maple 107)
    (c_ai_maple, demo_landlord, num_main, ulo_number,
     r_alvarez, null, null, null,
     'ai_copilot', 'completed', now_ts - interval '3 hours', now_ts - interval '2 hours'),
    -- 6. Vendor — Summit HVAC — preventive inspection scheduled (Birch 410)
    (c_summit, demo_landlord, num_main, '+15555610003',
     null, v_summit, u_birch_410, null,
     'vendor_alert', 'scheduled', now_ts - interval '1 day', now_ts - interval '3 hours'),
    -- 7–9. Birch Tower — assigned maintenance vendor SMS threads
    (c_bright_1203, demo_landlord, num_main, '+15555610004',
     null, v_bright, u_birch_1203, t02,
     'vendor_alert', 'in_progress', now_ts - interval '26 hours', now_ts - interval '20 minutes'),
    (c_bright_708, demo_landlord, num_main, '+15555610004',
     null, v_bright, u_birch_708, t07,
     'vendor_alert', 'accepted', now_ts - interval '5 days', now_ts - interval '2 hours'),
    (c_metro_402, demo_landlord, num_main, '+15555610008',
     null, v_metro, u_birch_402, t31,
     'vendor_alert', 'scheduled', now_ts - interval '2 days', now_ts - interval '45 minutes');

  -- ---------------------------------------------------------------------------
  -- Messages (latest message per conversation drives the inbox preview)
  -- ---------------------------------------------------------------------------
  insert into public.sms_messages (
    id, conversation_id, landlord_id, direction,
    from_number, to_number, body, provider, media_urls, created_at
  )
  values
    -- Sarah Johnson thread
    (md5('ulo-demo-msg-sarah-1')::uuid, c_sarah, demo_landlord, 'outbound',
     ulo_number, '+15555620001',
     'Hi Sarah — this is Ulo for Demo Property Management. How can we help?',
     'twilio', '{}'::text[], now_ts - interval '3 hours'),
    (md5('ulo-demo-msg-sarah-2')::uuid, c_sarah, demo_landlord, 'inbound',
     '+15555620001', ulo_number,
     'My AC stopped working this morning, it''s getting really warm in here.',
     'twilio',
     array[
       'https://images.unsplash.com/photo-1631545806604-aa4a6292c1a9?auto=format&fit=crop&w=800&q=80',
       'https://images.unsplash.com/photo-1558002038-1055906df827?auto=format&fit=crop&w=800&q=80'
     ]::text[],
     now_ts - interval '2 minutes'),

    -- Metro Plumbing thread
    (md5('ulo-demo-msg-metro-1')::uuid, c_metro, demo_landlord, 'outbound',
     ulo_number, '+15555610008',
     'Job #18 — main shut-off valve replacement at Pine Ridge 204. Please confirm completion.',
     'twilio', '{}'::text[], now_ts - interval '90 minutes'),
    (md5('ulo-demo-msg-metro-2')::uuid, c_metro, demo_landlord, 'inbound',
     '+15555610008', ulo_number,
     'Repair completed. Replaced the shut-off valve and tested.',
     'twilio', '{}'::text[], now_ts - interval '12 minutes'),

    -- Ulo AI — Oakwood auto-routed vendor
    (md5('ulo-demo-msg-ai-oak-1')::uuid, c_ai_oak, demo_landlord, 'outbound',
     ulo_number, ulo_number,
     'Auto-routed Oakwood 304 emergency to Rapid Plumb Co. (4.9★, nearby) — Apex Plumbing was 6+ hrs out.',
     'twilio', '{}'::text[], now_ts - interval '18 minutes'),

    -- David Okafor — resolved
    (md5('ulo-demo-msg-david-1')::uuid, c_david, demo_landlord, 'inbound',
     '+15555620004', ulo_number,
     'Thanks for the quick turnaround on the faucet!',
     'twilio', '{}'::text[], now_ts - interval '1 hour'),

    -- Ulo AI — Maple late rent reminder sent
    (md5('ulo-demo-msg-ai-maple-1')::uuid, c_ai_maple, demo_landlord, 'outbound',
     ulo_number, '+15555620005',
     'Hi Marco — friendly reminder your rent for Maple Heights 107 was due on the 1st. Pay anytime at your portal link or reply if you need help.',
     'twilio', '{}'::text[], now_ts - interval '2 hours'),

    -- Summit HVAC — scheduled inspection
    (md5('ulo-demo-msg-summit-1')::uuid, c_summit, demo_landlord, 'inbound',
     '+15555610003', ulo_number,
     'Scheduled preventive inspection for next Tuesday 9am.',
     'twilio', '{}'::text[], now_ts - interval '3 hours'),

    -- Brightline Electrical — Birch 1203 breaker panel (in progress)
    (md5('ulo-demo-msg-bright-1203-1')::uuid, c_bright_1203, demo_landlord, 'outbound',
     ulo_number, '+15555610004',
     'Job assigned — Birch Tower 1203: breaker panel sparking when AC kicks on. Urgent — please accept in portal.',
     'twilio', '{}'::text[], now_ts - interval '24 hours'),
    (md5('ulo-demo-msg-bright-1203-2')::uuid, c_bright_1203, demo_landlord, 'inbound',
     '+15555610004', ulo_number,
     'Accepted. Crew dispatched — ETA tomorrow 9–11am. Will shut off affected circuits before panel work.',
     'twilio', '{}'::text[], now_ts - interval '20 minutes'),

    -- Brightline Electrical — Birch 708 storm outlets (accepted)
    (md5('ulo-demo-msg-bright-708-1')::uuid, c_bright_708, demo_landlord, 'outbound',
     ulo_number, '+15555610004',
     'New job — Birch Tower 708: half the living room outlets dead after storm. Please confirm availability.',
     'twilio', '{}'::text[], now_ts - interval '5 days'),
    (md5('ulo-demo-msg-bright-708-2')::uuid, c_bright_708, demo_landlord, 'inbound',
     '+15555610004', ulo_number,
     'Accepted. Can schedule Thursday afternoon — will test GFCI chain on arrival.',
     'twilio', '{}'::text[], now_ts - interval '2 hours'),

    -- Metro Plumbing — Birch 402 dishwasher backup (scheduled)
    (md5('ulo-demo-msg-metro-402-1')::uuid, c_metro_402, demo_landlord, 'outbound',
     ulo_number, '+15555610008',
     'Job assigned — Birch Tower 402: dishwasher backing up into sink. Normal priority — please accept and propose visit window.',
     'twilio', '{}'::text[], now_ts - interval '36 hours'),
    (md5('ulo-demo-msg-metro-402-2')::uuid, c_metro_402, demo_landlord, 'inbound',
     '+15555610008', ulo_number,
     'Accepted. Scheduled for Friday 1–3pm — will snake drain line and check dishwasher discharge hose.',
     'twilio', '{}'::text[], now_ts - interval '45 minutes');

  raise notice 'Seeded % demo conversations for landlord %',
    (select count(*) from public.sms_conversations where landlord_id = demo_landlord),
    demo_landlord;
end $$;
