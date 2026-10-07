-- =============================================================================
-- Demo Property Management — Communication (Conversations) inbox seed
-- =============================================================================
-- Account: Demo Property Management <demo@ulohome.io>
-- Landlord id: de300000-0000-4000-8000-000000000001
--
-- Populates the unified Communication inbox (AdminCommunicationDashboard.tsx)
-- and property detail Conversations tabs.
--
-- Try Demo tip step 6 — first five Requests rows (newest first):
--   1) Sarah Johnson (tenant) ~4m
--   2) Jordan Walker (tenant) ~19m
--   3) Metro Plumbing (vendor) ~48m
--   4) Brightline Electrical (vendor) ~2h
--   5) Summit HVAC (vendor) ~3h
--   (other tenants below the tip cutout)
--
-- KPI targets (AdminCommunicationDashboard metrics):
--   Open Conversations ≈ tenant open threads (vendors scheduled/completed)
--   Unread Messages    = 2  (Sarah + Jordan still awaiting a reply)
--   Failed Deliveries  = 1  (one undelivered rent reminder)
--   Response Rate      ≈ 88% (most inbounds answered within 24h)
--
-- Reuses residents / vendors / units from seed_demo_landlord_account.sql.
-- Idempotent. Run: node scripts/seed-demo-portfolio.mjs
-- =============================================================================

do $$
declare
  demo_landlord uuid := 'de300000-0000-4000-8000-000000000001';
  now_ts timestamptz := now();
  ulo_number text := '+15550100100';

  num_main uuid := md5('ulo-demo-sms-number-main')::uuid;

  r_johnson uuid := md5('ulo-demo-res-sarah-johnson')::uuid;
  r_okafor uuid := md5('ulo-demo-res-david-okafor')::uuid;
  r_alvarez uuid := md5('ulo-demo-res-marco-alvarez')::uuid;
  r_walker uuid := md5('ulo-demo-res-jordan-walker')::uuid;
  r_nguyen uuid := md5('ulo-demo-res-kim-nguyen')::uuid;
  r_rossi uuid := md5('ulo-demo-res-elena-rossi')::uuid;
  r_mensah uuid := md5('ulo-demo-res-abena-mensah')::uuid;
  r_silva uuid := md5('ulo-demo-res-bianca-silva')::uuid;

  v_metro uuid := md5('ulo-demo-vendor-metro-plumbing')::uuid;
  v_summit uuid := md5('ulo-demo-vendor-summit-hvac')::uuid;
  v_bright uuid := md5('ulo-demo-vendor-brightline-electrical')::uuid;

  t01 uuid := md5('ulo-demo-ticket-01')::uuid;
  t02 uuid := md5('ulo-demo-ticket-02')::uuid;
  t07 uuid := md5('ulo-demo-ticket-07')::uuid;
  t09 uuid := md5('ulo-demo-ticket-09')::uuid;
  t18 uuid := md5('ulo-demo-ticket-18')::uuid;
  t31 uuid := md5('ulo-demo-ticket-31')::uuid;

  u_pine_204 uuid;
  u_birch_410 uuid;
  u_birch_1203 uuid;
  u_birch_708 uuid;
  u_birch_402 uuid;

  c_sarah uuid := md5('ulo-demo-conv-sarah-ac')::uuid;
  c_jordan uuid := md5('ulo-demo-conv-jordan-leak')::uuid;
  c_david uuid := md5('ulo-demo-conv-david-faucet')::uuid;
  c_kim uuid := md5('ulo-demo-conv-kim-inspection')::uuid;
  c_elena uuid := md5('ulo-demo-conv-elena-inspection')::uuid;
  c_metro uuid := md5('ulo-demo-conv-metro-valve')::uuid;
  c_ai_oak uuid := md5('ulo-demo-conv-ai-oakwood')::uuid;
  c_ai_maple uuid := md5('ulo-demo-conv-ai-maple-rent')::uuid;
  c_summit uuid := md5('ulo-demo-conv-summit-inspection')::uuid;
  c_bright_1203 uuid := md5('ulo-demo-conv-bright-1203')::uuid;
  c_bright_708 uuid := md5('ulo-demo-conv-bright-708')::uuid;
  c_metro_402 uuid := md5('ulo-demo-conv-metro-402')::uuid;
  -- Older closed threads so 4-week KPI deltas are non-zero / sensible
  c_hist_1 uuid := md5('ulo-demo-conv-hist-lockout')::uuid;
  c_hist_2 uuid := md5('ulo-demo-conv-hist-smoke')::uuid;
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

  delete from public.sms_messages where landlord_id = demo_landlord;
  delete from public.sms_conversations where landlord_id = demo_landlord;
  delete from public.sms_numbers where landlord_id = demo_landlord;

  insert into public.sms_numbers (id, landlord_id, phone_number, provider, status, purpose, created_at)
  values (num_main, demo_landlord, ulo_number, 'twilio', 'active', 'landlord_main', now_ts - interval '120 days');

  -- ---------------------------------------------------------------------------
  -- Conversations
  -- Tip top-5 by updated_at: 2 tenants + 3 vendors (all with real SMS).
  -- Open KPI: tenants open; tip vendors stay scheduled/completed.
  -- ---------------------------------------------------------------------------
  insert into public.sms_conversations (
    id, landlord_id, sms_number_id, external_phone_number,
    resident_id, vendor_id, unit_id, maintenance_request_id,
    conversation_type, status, created_at, updated_at
  )
  values
    -- Tip 1–2: tenants
    (c_sarah, demo_landlord, num_main, '+15555620001',
     r_johnson, null, null, null,
     'resident_intake', 'in_progress', now_ts - interval '5 hours', now_ts - interval '4 minutes'),
    (c_jordan, demo_landlord, num_main, '+15555620009',
     r_walker, null, null, t01,
     'resident_intake', 'in_progress', now_ts - interval '2 hours', now_ts - interval '19 minutes'),
    -- Tip 3–5: vendors with real conversations
    (c_metro, demo_landlord, num_main, '+15555610008',
     null, v_metro, u_pine_204, t18,
     'vendor_alert', 'completed', now_ts - interval '2 days', now_ts - interval '48 minutes'),
    (c_bright_1203, demo_landlord, num_main, '+15555610004',
     null, v_bright, u_birch_1203, t02,
     'vendor_alert', 'scheduled', now_ts - interval '26 hours', now_ts - interval '2 hours'),
    (c_summit, demo_landlord, num_main, '+15555610003',
     null, v_summit, u_birch_410, null,
     'vendor_alert', 'scheduled', now_ts - interval '1 day', now_ts - interval '3 hours'),
    -- Below tip cutout — more tenants + other vendors
    (c_david, demo_landlord, num_main, '+15555620004',
     r_okafor, null, null, null,
     'resident_intake', 'in_progress', now_ts - interval '6 hours', now_ts - interval '5 hours'),
    (c_kim, demo_landlord, num_main, '+15555620007',
     r_nguyen, null, null, null,
     'resident_intake', 'resolved', now_ts - interval '1 day', now_ts - interval '6 hours'),
    (c_elena, demo_landlord, num_main, '+15555620008',
     r_rossi, null, null, t09,
     'resident_intake', 'in_progress', now_ts - interval '8 hours', now_ts - interval '7 hours'),
    (c_ai_maple, demo_landlord, num_main, '+15555620002',
     r_alvarez, null, null, null,
     'resident_intake', 'open', now_ts - interval '5 days', now_ts - interval '2 days' + interval '3 hours'),
    (c_ai_oak, demo_landlord, num_main, ulo_number,
     r_walker, null, null, null,
     'ai_copilot', 'completed', now_ts - interval '50 minutes', now_ts - interval '40 minutes'),
    (c_metro_402, demo_landlord, num_main, '+15555610008',
     null, v_metro, u_birch_402, t31,
     'vendor_alert', 'scheduled', now_ts - interval '2 days', now_ts - interval '2 days'),
    (c_bright_708, demo_landlord, num_main, '+15555610004',
     null, v_bright, u_birch_708, t07,
     'vendor_alert', 'completed', now_ts - interval '5 days', now_ts - interval '3 days'),
    -- History (prior 4-week window) — closed now
    (c_hist_1, demo_landlord, num_main, '+15555620015',
     r_mensah, null, null, null,
     'resident_intake', 'resolved', now_ts - interval '45 days', now_ts - interval '40 days'),
    (c_hist_2, demo_landlord, num_main, '+15555620011',
     r_silva, null, null, null,
     'resident_intake', 'resolved', now_ts - interval '38 days', now_ts - interval '35 days');

  -- ---------------------------------------------------------------------------
  -- Messages
  -- Unread KPI: open thread + latest inbound → only Sarah + Jordan end inbound.
  -- Failed KPI: one undelivered outbound (Marco rent).
  -- Response rate: answer mid-thread inbounds within 24h; leave 2 recent open.
  -- ---------------------------------------------------------------------------
  insert into public.sms_messages (
    id, conversation_id, landlord_id, direction,
    from_number, to_number, body, provider, provider_status, media_urls, created_at
  )
  values
    -- 1) Sarah — unanswered latest (unread)
    (md5('ulo-demo-msg-sarah-1')::uuid, c_sarah, demo_landlord, 'inbound',
     '+15555620001', ulo_number,
     'Hi — the AC in Cedar Court 103 stopped cooling last night. Bedroom is really warm.',
     'twilio', 'received', '{}'::text[], now_ts - interval '5 hours'),
    (md5('ulo-demo-msg-sarah-2')::uuid, c_sarah, demo_landlord, 'outbound',
     ulo_number, '+15555620001',
     'Hi Sarah — this is the property team at Demo Property Management. Thanks for reaching out. Can you send a photo of the thermostat if you have one?',
     'twilio', 'delivered', '{}'::text[], now_ts - interval '4 hours 50 minutes'),
    (md5('ulo-demo-msg-sarah-3')::uuid, c_sarah, demo_landlord, 'inbound',
     '+15555620001', ulo_number,
     'AC died again overnight — bedroom is 82°. Can someone come today?',
     'twilio', 'received',
     array[
       'https://images.unsplash.com/photo-1631545806604-aa4a6292c1a9?auto=format&fit=crop&w=800&q=80'
     ]::text[],
     now_ts - interval '4 minutes'),

    -- 2) Jordan — unanswered latest (unread)
    (md5('ulo-demo-msg-jordan-1')::uuid, c_jordan, demo_landlord, 'inbound',
     '+15555620009', ulo_number,
     'Water is dripping through the hallway ceiling in Oakwood 304 — need help ASAP.',
     'twilio', 'received', '{}'::text[], now_ts - interval '2 hours'),
    (md5('ulo-demo-msg-jordan-2')::uuid, c_jordan, demo_landlord, 'outbound',
     ulo_number, '+15555620009',
     'Hi Jordan — we got your message. Is water still actively leaking?',
     'twilio', 'delivered', '{}'::text[], now_ts - interval '90 minutes'),
    (md5('ulo-demo-msg-jordan-3')::uuid, c_jordan, demo_landlord, 'inbound',
     '+15555620009', ulo_number,
     'Yes — water is coming through the hallway ceiling. I shut the valve under the sink.',
     'twilio', 'received', '{}'::text[], now_ts - interval '19 minutes'),

    -- 3) David — fully answered; ends outbound (not unread)
    (md5('ulo-demo-msg-david-1')::uuid, c_david, demo_landlord, 'inbound',
     '+15555620004', ulo_number,
     'Kitchen faucet in Pine Ridge 301 keeps dripping even after I tighten the handle.',
     'twilio', 'received', '{}'::text[], now_ts - interval '10 hours'),
    (md5('ulo-demo-msg-david-2')::uuid, c_david, demo_landlord, 'outbound',
     ulo_number, '+15555620004',
     'Hi David — thanks for letting us know. Is it a steady drip or only when you use the sink?',
     'twilio', 'delivered', '{}'::text[], now_ts - interval '9 hours 40 minutes'),
    (md5('ulo-demo-msg-david-3')::uuid, c_david, demo_landlord, 'inbound',
     '+15555620004', ulo_number,
     'Steady drip all day. It''s starting to stain the basin.',
     'twilio', 'received', '{}'::text[], now_ts - interval '9 hours'),
    (md5('ulo-demo-msg-david-4')::uuid, c_david, demo_landlord, 'outbound',
     ulo_number, '+15555620004',
     'Got it — we''re sending a plumber. They''ll text you before arriving.',
     'twilio', 'delivered', '{}'::text[], now_ts - interval '8 hours'),
    (md5('ulo-demo-msg-david-5')::uuid, c_david, demo_landlord, 'inbound',
     '+15555620004', ulo_number,
     'Plumber finished — faucet is perfect now. Appreciate the quick fix.',
     'twilio', 'received', '{}'::text[], now_ts - interval '5 hours 30 minutes'),
    (md5('ulo-demo-msg-david-6')::uuid, c_david, demo_landlord, 'outbound',
     ulo_number, '+15555620004',
     'Glad it''s fixed, David. Text us anytime if anything else comes up.',
     'twilio', 'delivered', '{}'::text[], now_ts - interval '5 hours'),

    -- 4) Kim — resolved; ends inbound but closed → not unread
    (md5('ulo-demo-msg-kim-1')::uuid, c_kim, demo_landlord, 'outbound',
     ulo_number, '+15555620007',
     'Hi Kim — reminder that your unit inspection is today between 10am and noon.',
     'twilio', 'delivered', '{}'::text[], now_ts - interval '10 hours'),
    (md5('ulo-demo-msg-kim-2')::uuid, c_kim, demo_landlord, 'inbound',
     '+15555620007', ulo_number,
     'Sounds good — I''ll leave the patio door unlocked for them.',
     'twilio', 'received', '{}'::text[], now_ts - interval '9 hours'),
    (md5('ulo-demo-msg-kim-3')::uuid, c_kim, demo_landlord, 'outbound',
     ulo_number, '+15555620007',
     'Thanks Kim — they''re wrapping up now. We''ll text if anything needs a follow-up.',
     'twilio', 'delivered', '{}'::text[], now_ts - interval '4 hours'),
    (md5('ulo-demo-msg-kim-4')::uuid, c_kim, demo_landlord, 'inbound',
     '+15555620007', ulo_number,
     'Inspection went smoothly — thanks for sending someone. Everything looked good.',
     'twilio', 'received', '{}'::text[], now_ts - interval '6 hours 20 minutes'),
    (md5('ulo-demo-msg-kim-5')::uuid, c_kim, demo_landlord, 'outbound',
     ulo_number, '+15555620007',
     'Wonderful to hear, Kim — we''re marking the inspection complete.',
     'twilio', 'delivered', '{}'::text[], now_ts - interval '6 hours'),

    -- 5) Elena — confirmed visit; ends outbound (not unread)
    (md5('ulo-demo-msg-elena-1')::uuid, c_elena, demo_landlord, 'outbound',
     ulo_number, '+15555620008',
     'Hi Elena — during today''s inspection we found a loose bathroom exhaust fan cover in Oakwood 205. We''d like to send someone to secure it.',
     'twilio', 'delivered', '{}'::text[], now_ts - interval '8 hours'),
    (md5('ulo-demo-msg-elena-2')::uuid, c_elena, demo_landlord, 'inbound',
     '+15555620008', ulo_number,
     'Okay — I noticed it rattling. When can they come?',
     'twilio', 'received', '{}'::text[], now_ts - interval '7 hours 30 minutes'),
    (md5('ulo-demo-msg-elena-3')::uuid, c_elena, demo_landlord, 'outbound',
     ulo_number, '+15555620008',
     'We can do tomorrow between 1pm and 3pm if that works for you. Reply YES to confirm.',
     'twilio', 'delivered', '{}'::text[], now_ts - interval '6 hours'),
    (md5('ulo-demo-msg-elena-4')::uuid, c_elena, demo_landlord, 'inbound',
     '+15555620008', ulo_number,
     'YES — tomorrow 1–3pm works. Please text when they''re on the way.',
     'twilio', 'received', '{}'::text[], now_ts - interval '7 hours 20 minutes'),
    (md5('ulo-demo-msg-elena-5')::uuid, c_elena, demo_landlord, 'outbound',
     ulo_number, '+15555620008',
     'Confirmed for tomorrow 1–3pm. We''ll text when the tech is on the way.',
     'twilio', 'delivered', '{}'::text[], now_ts - interval '7 hours'),

    -- Marco rent — 1 failed delivery, then successful follow-up (ends outbound)
    (md5('ulo-demo-msg-maple-fail')::uuid, c_ai_maple, demo_landlord, 'outbound',
     ulo_number, '+15555620002',
     'Hi Marco — friendly reminder your rent for Maple Heights 107 was due on the 1st.',
     'twilio', 'undelivered', '{}'::text[], now_ts - interval '4 days'),
    (md5('ulo-demo-msg-maple-1')::uuid, c_ai_maple, demo_landlord, 'outbound',
     ulo_number, '+15555620002',
     'Hi Marco — trying again. Your rent for Maple Heights 107 was due on the 1st. Pay anytime at your portal link or reply if you need help.',
     'twilio', 'delivered', '{}'::text[], now_ts - interval '3 days'),
    (md5('ulo-demo-msg-maple-2')::uuid, c_ai_maple, demo_landlord, 'inbound',
     '+15555620002', ulo_number,
     'Can I do a payment plan this month? Paid half already.',
     'twilio', 'received', '{}'::text[], now_ts - interval '2 days'),
    (md5('ulo-demo-msg-maple-3')::uuid, c_ai_maple, demo_landlord, 'outbound',
     ulo_number, '+15555620002',
     'Thanks Marco — yes, we can split the balance over the next two Fridays. I''ll send the plan link shortly.',
     'twilio', 'delivered', '{}'::text[], now_ts - interval '2 days' + interval '3 hours'),

    -- Metro — tip slot 3 (latest ~48m)
    (md5('ulo-demo-msg-metro-1')::uuid, c_metro, demo_landlord, 'outbound',
     ulo_number, '+15555610008',
     'Job update — Pine Ridge 204 shut-off valve. Reply with status when you arrive.',
     'twilio', 'delivered', '{}'::text[], now_ts - interval '3 hours'),
    (md5('ulo-demo-msg-metro-2')::uuid, c_metro, demo_landlord, 'inbound',
     '+15555610008', ulo_number,
     'On site now. Old valve seized — replacing the supply line and testing before I leave.',
     'twilio', 'received', '{}'::text[], now_ts - interval '90 minutes'),
    (md5('ulo-demo-msg-metro-3')::uuid, c_metro, demo_landlord, 'outbound',
     ulo_number, '+15555610008',
     'Thanks — mark the job complete in the portal when you''re done testing.',
     'twilio', 'delivered', '{}'::text[], now_ts - interval '48 minutes'),

    (md5('ulo-demo-msg-ai-oak-1')::uuid, c_ai_oak, demo_landlord, 'outbound',
     ulo_number, ulo_number,
     'Auto-routed Oakwood 304 emergency to Rapid Plumb Co. (4.9★, nearby) — Apex Plumbing was 6+ hrs out.',
     'twilio', 'delivered', '{}'::text[], now_ts - interval '40 minutes'),

    -- Summit — tip slot 5 (latest ~3h)
    (md5('ulo-demo-msg-summit-1')::uuid, c_summit, demo_landlord, 'inbound',
     '+15555610003', ulo_number,
     'Preventive HVAC check locked for next Tuesday at 9am — Birch 410.',
     'twilio', 'received', '{}'::text[], now_ts - interval '4 hours'),
    (md5('ulo-demo-msg-summit-2')::uuid, c_summit, demo_landlord, 'outbound',
     ulo_number, '+15555610003',
     'Confirmed — Tuesday 9am at Birch 410. We''ll notify the resident.',
     'twilio', 'delivered', '{}'::text[], now_ts - interval '3 hours'),

    (md5('ulo-demo-msg-metro-402-1')::uuid, c_metro_402, demo_landlord, 'outbound',
     ulo_number, '+15555610008',
     'Job assigned — Birch Tower 402: dishwasher backing up into sink. Please propose a visit window.',
     'twilio', 'delivered', '{}'::text[], now_ts - interval '3 days'),
    (md5('ulo-demo-msg-metro-402-2')::uuid, c_metro_402, demo_landlord, 'inbound',
     '+15555610008', ulo_number,
     'Friday 1–3pm works — I''ll snake the drain and check the discharge hose.',
     'twilio', 'received', '{}'::text[], now_ts - interval '2 days 4 hours'),
    (md5('ulo-demo-msg-metro-402-3')::uuid, c_metro_402, demo_landlord, 'outbound',
     ulo_number, '+15555610008',
     'Friday 1–3pm is booked. See you then.',
     'twilio', 'delivered', '{}'::text[], now_ts - interval '2 days'),

    -- Brightline — tip slot 4 (latest ~2h)
    (md5('ulo-demo-msg-bright-1203-1')::uuid, c_bright_1203, demo_landlord, 'outbound',
     ulo_number, '+15555610004',
     'Job assigned — Birch Tower 1203: breaker panel sparking when AC kicks on. Urgent — please accept.',
     'twilio', 'delivered', '{}'::text[], now_ts - interval '5 hours'),
    (md5('ulo-demo-msg-bright-1203-2')::uuid, c_bright_1203, demo_landlord, 'inbound',
     '+15555610004', ulo_number,
     'Parts ordered for the panel. Earliest return visit is Thursday 9–11am.',
     'twilio', 'received', '{}'::text[], now_ts - interval '3 hours'),
    (md5('ulo-demo-msg-bright-1203-3')::uuid, c_bright_1203, demo_landlord, 'outbound',
     ulo_number, '+15555610004',
     'Thursday 9–11am works — we''ll confirm with the resident.',
     'twilio', 'delivered', '{}'::text[], now_ts - interval '2 hours'),

    (md5('ulo-demo-msg-bright-708-1')::uuid, c_bright_708, demo_landlord, 'outbound',
     ulo_number, '+15555610004',
     'New job — Birch Tower 708: half the living room outlets dead after the storm.',
     'twilio', 'delivered', '{}'::text[], now_ts - interval '5 days'),
    (md5('ulo-demo-msg-bright-708-2')::uuid, c_bright_708, demo_landlord, 'inbound',
     '+15555610004', ulo_number,
     'Can do Thursday afternoon — will test the GFCI chain on arrival.',
     'twilio', 'received', '{}'::text[], now_ts - interval '4 days'),
    (md5('ulo-demo-msg-bright-708-3')::uuid, c_bright_708, demo_landlord, 'outbound',
     ulo_number, '+15555610004',
     'Thursday afternoon is confirmed. Thanks.',
     'twilio', 'delivered', '{}'::text[], now_ts - interval '3 days 12 hours'),

    -- Prior-window history (answered) for response-rate / open deltas
    (md5('ulo-demo-msg-hist-1a')::uuid, c_hist_1, demo_landlord, 'inbound',
     '+15555620015', ulo_number,
     'Locked out of Cedar Court 102 — can someone help with a lockout?',
     'twilio', 'received', '{}'::text[], now_ts - interval '45 days'),
    (md5('ulo-demo-msg-hist-1b')::uuid, c_hist_1, demo_landlord, 'outbound',
     ulo_number, '+15555620015',
     'On our way — a tech will meet you at the entrance in about 25 minutes.',
     'twilio', 'delivered', '{}'::text[], now_ts - interval '45 days' + interval '20 minutes'),
    (md5('ulo-demo-msg-hist-1c')::uuid, c_hist_1, demo_landlord, 'inbound',
     '+15555620015', ulo_number,
     'I''m back in — thank you!',
     'twilio', 'received', '{}'::text[], now_ts - interval '44 days 20 hours'),
    (md5('ulo-demo-msg-hist-1d')::uuid, c_hist_1, demo_landlord, 'outbound',
     ulo_number, '+15555620015',
     'Glad you''re in. We''ll note a spare key for next time.',
     'twilio', 'delivered', '{}'::text[], now_ts - interval '44 days 19 hours'),

    (md5('ulo-demo-msg-hist-2a')::uuid, c_hist_2, demo_landlord, 'inbound',
     '+15555620011', ulo_number,
     'Smoke detector keeps chirping in Maple Heights 207 overnight.',
     'twilio', 'received', '{}'::text[], now_ts - interval '38 days'),
    (md5('ulo-demo-msg-hist-2b')::uuid, c_hist_2, demo_landlord, 'outbound',
     ulo_number, '+15555620011',
     'Thanks — usually a low battery. We can replace it tomorrow morning.',
     'twilio', 'delivered', '{}'::text[], now_ts - interval '38 days' + interval '15 minutes'),
    (md5('ulo-demo-msg-hist-2c')::uuid, c_hist_2, demo_landlord, 'inbound',
     '+15555620011', ulo_number,
     'Battery swap fixed it. All quiet now.',
     'twilio', 'received', '{}'::text[], now_ts - interval '37 days'),
    (md5('ulo-demo-msg-hist-2d')::uuid, c_hist_2, demo_landlord, 'outbound',
     ulo_number, '+15555620011',
     'Perfect — glad that solved it.',
     'twilio', 'delivered', '{}'::text[], now_ts - interval '37 days' + interval '30 minutes');

  -- Drop empty vendor/tenant shells that other flows may recreate (0 messages →
  -- "No messages yet" and they steal the tip step-6 first-five slots).
  delete from public.sms_conversations c
  where c.landlord_id = demo_landlord
    and not exists (
      select 1 from public.sms_messages m where m.conversation_id = c.id
    );

  -- Pin tip top-5: 2 tenants + 3 vendors (newest first).
  update public.sms_conversations set updated_at = now_ts - interval '4 minutes'
    where id = c_sarah;
  update public.sms_conversations set updated_at = now_ts - interval '19 minutes'
    where id = c_jordan;
  update public.sms_conversations set updated_at = now_ts - interval '48 minutes'
    where id = c_metro;
  update public.sms_conversations set updated_at = now_ts - interval '2 hours'
    where id = c_bright_1203;
  update public.sms_conversations set updated_at = now_ts - interval '3 hours'
    where id = c_summit;

  raise notice 'Seeded % demo conversations for landlord %',
    (select count(*) from public.sms_conversations where landlord_id = demo_landlord),
    demo_landlord;
end $$;
