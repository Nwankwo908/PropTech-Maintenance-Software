-- Idempotent patch: Birch Tower maintenance tickets with assigned vendors.
-- Run in Supabase SQL Editor after migrations (incl. 20260630120000_fix_maintenance_enriched_unit_match.sql).
-- Safe to re-run; does not wipe other demo data.

do $$
declare
  demo_landlord uuid := 'de300000-0000-4000-8000-000000000001';
  now_ts timestamptz := now();

  v_bright uuid := md5('ulo-demo-vendor-brightline-electrical')::uuid;
  v_metro uuid := md5('ulo-demo-vendor-metro-plumbing')::uuid;

  t02 uuid := md5('ulo-demo-ticket-02')::uuid;
  t07 uuid := md5('ulo-demo-ticket-07')::uuid;
  t31 uuid := md5('ulo-demo-ticket-31')::uuid;

  wr_maint7 uuid := md5('ulo-demo-run-maint-7')::uuid;
  p_birch uuid;
  u_birch_402 uuid;
  u_birch_1203 uuid;
  u_birch_708 uuid;
  r_chen uuid := md5('ulo-demo-res-grace-chen')::uuid;
  num_main uuid := md5('ulo-demo-sms-number-main')::uuid;
  ulo_number text := '+15550100100';
  c_bright_1203 uuid := md5('ulo-demo-conv-bright-1203')::uuid;
  c_bright_708 uuid := md5('ulo-demo-conv-bright-708')::uuid;
  c_metro_402 uuid := md5('ulo-demo-conv-metro-402')::uuid;
begin
  if not exists (select 1 from public.landlords where id = demo_landlord) then
    raise notice 'Demo landlord missing — skip Birch vendor patch';
    return;
  end if;

  p_birch := public.derive_property_id(demo_landlord, 'Birch Tower');
  select id into u_birch_402
  from public.units
  where landlord_id = demo_landlord and building = 'Birch Tower' and unit_label = '402';
  select id into u_birch_1203
  from public.units
  where landlord_id = demo_landlord and building = 'Birch Tower' and unit_label = '1203';
  select id into u_birch_708
  from public.units
  where landlord_id = demo_landlord and building = 'Birch Tower' and unit_label = '708';

  if to_regclass('public.sms_numbers') is not null then
    insert into public.sms_numbers (id, landlord_id, phone_number, provider, status, purpose, created_at)
    values (num_main, demo_landlord, ulo_number, 'twilio', 'active', 'landlord_main', now_ts - interval '120 days')
    on conflict (id) do nothing;
  end if;

  update public.maintenance_requests
  set
    unit = 'Birch Tower · 1203',
    assigned_vendor_id = v_bright,
    vendor_work_status = 'in_progress',
    assigned_at = coalesce(assigned_at, now_ts - interval '24 hours'),
    due_at = coalesce(due_at, now_ts + interval '10 hours')
  where id = t02 and landlord_id = demo_landlord;

  update public.maintenance_requests
  set
    unit = 'Birch Tower · 708',
    assigned_vendor_id = v_bright,
    vendor_work_status = 'accepted',
    assigned_at = coalesce(assigned_at, now_ts - interval '5 days'),
    due_at = coalesce(due_at, now_ts + interval '1 day')
  where id = t07 and landlord_id = demo_landlord;

  insert into public.maintenance_requests (
    id, landlord_id, created_at, priority, urgency, severity,
    resident_name, email, resident_phone, unit, description,
    vendor_work_status, issue_category, assigned_vendor_id, assigned_at, due_at
  )
  values (
    t31, demo_landlord, now_ts - interval '2 days', 'normal', 'normal', 'normal',
    'Grace Chen', 'grace.chen@example.com', '+15555620003', 'Birch Tower · 402',
    'Dishwasher backing up into the sink — slow drain and standing water after cycles.',
    'accepted', 'plumbing', v_metro, now_ts - interval '36 hours', now_ts + interval '2 days'
  )
  on conflict (id) do update set
    unit = excluded.unit,
    assigned_vendor_id = excluded.assigned_vendor_id,
    vendor_work_status = excluded.vendor_work_status,
    assigned_at = excluded.assigned_at,
    due_at = excluded.due_at,
    description = excluded.description,
    issue_category = excluded.issue_category;

  insert into public.workflow_runs (
    id, template_id, status, entity_type, entity_id, property_id, unit_id,
    resident_id, landlord_id, trigger_type, workflow_type, current_stage,
    current_step, started_at, completed_at, metadata
  )
  values (
    wr_maint7, 'maintenance_intake', 'active', 'maintenance_request', t31,
    p_birch, u_birch_402, r_chen, demo_landlord, 'sms_inbound', 'maintenance',
    'acted', 'awaiting_vendor_schedule', now_ts - interval '2 days', null,
    jsonb_build_object(
      'landlord_id', demo_landlord,
      'unit_label', '402',
      'building', 'Birch Tower',
      'maintenance_request_id', t31,
      'issue_category', 'plumbing',
      'due_at', (now_ts + interval '2 days')::text
    )
  )
  on conflict (id) do update set
    entity_id = excluded.entity_id,
    property_id = excluded.property_id,
    unit_id = excluded.unit_id,
    resident_id = excluded.resident_id,
    status = excluded.status,
    current_stage = excluded.current_stage,
    current_step = excluded.current_step,
    metadata = excluded.metadata;

  if to_regclass('public.vendor_status_events') is not null then
    insert into public.vendor_status_events (ticket_id, created_at, from_status, to_status, source, vendor_id)
    select v.ticket_id, v.created_at, v.from_status, v.to_status, v.source, v.vendor_id
    from (
      values
        (t02, now_ts - interval '23 hours', 'pending_accept', 'accepted', 'portal', v_bright),
        (t02, now_ts - interval '22 hours', 'accepted', 'in_progress', 'portal', v_bright),
        (t07, now_ts - interval '5 days 2 hours', 'pending_accept', 'accepted', 'portal', v_bright),
        (t31, now_ts - interval '38 hours', 'pending_accept', 'accepted', 'portal', v_metro)
    ) as v(ticket_id, created_at, from_status, to_status, source, vendor_id)
    where not exists (
      select 1
      from public.vendor_status_events existing
      where existing.ticket_id = v.ticket_id
        and existing.from_status = v.from_status
        and existing.to_status = v.to_status
        and existing.created_at = v.created_at
    );
  end if;

  if to_regclass('public.sms_conversations') is not null then
    insert into public.sms_conversations (
      id, landlord_id, sms_number_id, external_phone_number,
      resident_id, vendor_id, unit_id, maintenance_request_id,
      conversation_type, status, created_at, updated_at
    )
    values
      (c_bright_1203, demo_landlord, num_main, '+15555610004',
       null, v_bright, u_birch_1203, t02,
       'vendor_alert', 'in_progress', now_ts - interval '26 hours', now_ts - interval '20 minutes'),
      (c_bright_708, demo_landlord, num_main, '+15555610004',
       null, v_bright, u_birch_708, t07,
       'vendor_alert', 'accepted', now_ts - interval '5 days', now_ts - interval '2 hours'),
      (c_metro_402, demo_landlord, num_main, '+15555610008',
       null, v_metro, u_birch_402, t31,
       'vendor_alert', 'scheduled', now_ts - interval '2 days', now_ts - interval '45 minutes')
    on conflict (id) do update set
      vendor_id = excluded.vendor_id,
      unit_id = excluded.unit_id,
      maintenance_request_id = excluded.maintenance_request_id,
      status = excluded.status,
      updated_at = excluded.updated_at;

    delete from public.sms_messages
    where landlord_id = demo_landlord
      and conversation_id in (c_bright_1203, c_bright_708, c_metro_402);

    insert into public.sms_messages (
      id, conversation_id, landlord_id, direction,
      from_number, to_number, body, provider, media_urls, created_at
    )
    values
      (md5('ulo-demo-msg-bright-1203-1')::uuid, c_bright_1203, demo_landlord, 'outbound',
       ulo_number, '+15555610004',
       'Job assigned — Birch Tower 1203: breaker panel sparking when AC kicks on. Urgent — please accept in portal.',
       'twilio', '{}'::text[], now_ts - interval '24 hours'),
      (md5('ulo-demo-msg-bright-1203-2')::uuid, c_bright_1203, demo_landlord, 'inbound',
       '+15555610004', ulo_number,
       'Accepted. Crew dispatched — ETA tomorrow 9–11am. Will shut off affected circuits before panel work.',
       'twilio', '{}'::text[], now_ts - interval '20 minutes'),
      (md5('ulo-demo-msg-bright-708-1')::uuid, c_bright_708, demo_landlord, 'outbound',
       ulo_number, '+15555610004',
       'New job — Birch Tower 708: half the living room outlets dead after storm. Please confirm availability.',
       'twilio', '{}'::text[], now_ts - interval '5 days'),
      (md5('ulo-demo-msg-bright-708-2')::uuid, c_bright_708, demo_landlord, 'inbound',
       '+15555610004', ulo_number,
       'Accepted. Can schedule Thursday afternoon — will test GFCI chain on arrival.',
       'twilio', '{}'::text[], now_ts - interval '2 hours'),
      (md5('ulo-demo-msg-metro-402-1')::uuid, c_metro_402, demo_landlord, 'outbound',
       ulo_number, '+15555610008',
       'Job assigned — Birch Tower 402: dishwasher backing up into sink. Normal priority — please accept and propose visit window.',
       'twilio', '{}'::text[], now_ts - interval '36 hours'),
      (md5('ulo-demo-msg-metro-402-2')::uuid, c_metro_402, demo_landlord, 'inbound',
       '+15555610008', ulo_number,
       'Accepted. Scheduled for Friday 1–3pm — will snake drain line and check dishwasher discharge hose.',
       'twilio', '{}'::text[], now_ts - interval '45 minutes')
    on conflict (id) do nothing;
  end if;

  raise notice 'Birch Tower vendor patch applied (t02, t07, t31 + vendor SMS).';
end $$;
