-- Rent collection demo seed: five residents covering paid, due today, overdue,
-- missing phone, and partial payment scenarios for the admin workflow dashboard.
--
-- Run after migrations (requires rent_collection template from migrations):
--   psql "$DATABASE_URL" -f supabase/seed_rent_collection_demo.sql
-- Or paste into Supabase SQL Editor (service role / postgres).
--
-- Set seed_landlord_id to match DEFAULT_LANDLORD_ID / VITE_DEFAULT_LANDLORD_ID.

do $$
declare
  seed_landlord_id uuid := '068daf53-07e4-4493-bd7f-6106e3c8c62f';
  billing_period text := to_char(current_date, 'YYYY-MM');
  rent_today date := current_date;
  rent_overdue date := current_date - interval '12 days';
  rent_partial date := current_date - interval '5 days';
  building_name text := 'Rent Seed Tower';
  now_ts timestamptz := now();

  -- Residents
  id_paid uuid := 'aaaaaaaa-0001-4000-8000-000000000001';
  id_due_today uuid := 'aaaaaaaa-0001-4000-8000-000000000002';
  id_overdue uuid := 'aaaaaaaa-0001-4000-8000-000000000003';
  id_no_phone uuid := 'aaaaaaaa-0001-4000-8000-000000000004';
  id_partial uuid := 'aaaaaaaa-0001-4000-8000-000000000005';

  -- Workflow runs
  run_paid uuid := 'bbbbbbbb-0001-4000-8000-000000000001';
  run_due_today uuid := 'bbbbbbbb-0001-4000-8000-000000000002';
  run_overdue uuid := 'bbbbbbbb-0001-4000-8000-000000000003';
  run_no_phone uuid := 'bbbbbbbb-0001-4000-8000-000000000004';
  run_partial uuid := 'bbbbbbbb-0001-4000-8000-000000000005';

  seed_run_ids uuid[] := array[
    run_paid,
    run_due_today,
    run_overdue,
    run_no_phone,
    run_partial
  ];
begin
  if not exists (
    select 1 from public.workflow_templates where id = 'rent_collection'
  ) then
    raise exception 'rent_collection template missing — run migrations first';
  end if;

  -- -------------------------------------------------------------------------
  -- Residents (users.balance_due drives classification in the engine)
  -- -------------------------------------------------------------------------
  insert into public.users (
    id, resident_id, full_name, email, phone, unit, building, status, balance_due
  )
  values
    (
      id_paid,
      'rent-seed-paid',
      'Jordan Reyes',
      'rent-seed-paid@example.com',
      '+15555551001',
      '101',
      building_name,
      'active',
      0
    ),
    (
      id_due_today,
      'rent-seed-due-today',
      'Sam Chen',
      'rent-seed-due-today@example.com',
      '+15555551002',
      '102',
      building_name,
      'active',
      1200
    ),
    (
      id_overdue,
      'rent-seed-overdue',
      'Riley Brooks',
      'rent-seed-overdue@example.com',
      '+15555551003',
      '103',
      building_name,
      'active',
      1350
    ),
    (
      id_no_phone,
      'rent-seed-no-phone',
      'Casey Kim',
      'rent-seed-no-phone@example.com',
      null,
      '104',
      building_name,
      'active',
      1200
    ),
    (
      id_partial,
      'rent-seed-partial',
      'Morgan Lee',
      'rent-seed-partial@example.com',
      '+15555551005',
      '105',
      building_name,
      'active',
      600
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

  delete from public.workflow_events
  where workflow_run_id = any (seed_run_ids);

  -- -------------------------------------------------------------------------
  -- Workflow runs
  -- -------------------------------------------------------------------------
  insert into public.workflow_runs (
    id,
    template_id,
    status,
    entity_type,
    entity_id,
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
      run_paid,
      'rent_collection',
      'completed',
      'user',
      id_paid,
      id_paid,
      seed_landlord_id,
      'cron',
      'rent_collection',
      'completed',
      'completed',
      now_ts - interval '8 days',
      now_ts - interval '2 days',
      jsonb_build_object(
        'landlord_id', seed_landlord_id,
        'trigger_type', 'cron',
        'amount_due', 0,
        'billing_period', billing_period,
        'rent_due_date', rent_today::text,
        'due_at', (rent_today + interval '5 days')::timestamptz,
        'unit_label', '101',
        'building', building_name,
        'rent_classification', 'paid',
        'classified_at', (now_ts - interval '2 days')::text,
        'classification_source', 'balance_and_due_date',
        'payment_intent', 'paid',
        'sms_sent', true,
        'email_sent', true,
        'payment_requested', false,
        'route_channels', jsonb_build_array('sms', 'email')
      )
    ),
    (
      run_due_today,
      'rent_collection',
      'active',
      'user',
      id_due_today,
      id_due_today,
      seed_landlord_id,
      'cron',
      'rent_collection',
      'awaiting_response',
      'awaiting_response',
      now_ts - interval '3 days',
      null,
      jsonb_build_object(
        'landlord_id', seed_landlord_id,
        'trigger_type', 'cron',
        'amount_due', 1200,
        'billing_period', billing_period,
        'rent_due_date', rent_today::text,
        'due_at', (rent_today + interval '5 days')::timestamptz,
        'unit_label', '102',
        'building', building_name,
        'rent_classification', 'rent_due_today',
        'classified_at', now_ts::text,
        'classification_source', 'balance_and_due_date',
        'sms_sent', true,
        'email_sent', true,
        'payment_requested', true,
        'route_channels', jsonb_build_array('sms', 'email')
      )
    ),
    (
      run_overdue,
      'rent_collection',
      'active',
      'user',
      id_overdue,
      id_overdue,
      seed_landlord_id,
      'cron',
      'rent_collection',
      'awaiting_response',
      'awaiting_response',
      now_ts - interval '18 days',
      null,
      jsonb_build_object(
        'landlord_id', seed_landlord_id,
        'trigger_type', 'cron',
        'amount_due', 1350,
        'billing_period', billing_period,
        'rent_due_date', rent_overdue::text,
        'due_at', (rent_overdue + interval '5 days')::timestamptz,
        'unit_label', '103',
        'building', building_name,
        'rent_classification', 'rent_overdue',
        'classified_at', now_ts::text,
        'classification_source', 'balance_and_due_date',
        'sms_sent', true,
        'email_sent', true,
        'payment_requested', true,
        'route_channels', jsonb_build_array('sms', 'email')
      )
    ),
    (
      run_no_phone,
      'rent_collection',
      'active',
      'user',
      id_no_phone,
      id_no_phone,
      seed_landlord_id,
      'cron',
      'rent_collection',
      'awaiting_response',
      'awaiting_response',
      now_ts - interval '3 days',
      null,
      jsonb_build_object(
        'landlord_id', seed_landlord_id,
        'trigger_type', 'cron',
        'amount_due', 1200,
        'billing_period', billing_period,
        'rent_due_date', rent_today::text,
        'due_at', (rent_today + interval '5 days')::timestamptz,
        'unit_label', '104',
        'building', building_name,
        'rent_classification', 'rent_due_today',
        'classified_at', now_ts::text,
        'classification_source', 'balance_and_due_date',
        'sms_sent', false,
        'email_sent', true,
        'payment_requested', true,
        'route_channels', jsonb_build_array('email'),
        'missing_phone', true
      )
    ),
    (
      run_partial,
      'rent_collection',
      'active',
      'user',
      id_partial,
      id_partial,
      seed_landlord_id,
      'cron',
      'rent_collection',
      'awaiting_response',
      'awaiting_response',
      now_ts - interval '10 days',
      null,
      jsonb_build_object(
        'landlord_id', seed_landlord_id,
        'trigger_type', 'cron',
        'amount_due', 600,
        'billing_period', billing_period,
        'rent_due_date', rent_partial::text,
        'due_at', (rent_partial + interval '5 days')::timestamptz,
        'unit_label', '105',
        'building', building_name,
        'rent_classification', 'partial_payment',
        'classified_at', (now_ts - interval '1 day')::text,
        'classification_source', 'payment_intent',
        'payment_intent', 'partial',
        'sms_sent', true,
        'email_sent', true,
        'payment_requested', true,
        'route_channels', jsonb_build_array('sms', 'email')
      )
    )
  on conflict (id) do update set
    template_id = excluded.template_id,
    status = excluded.status,
    entity_type = excluded.entity_type,
    entity_id = excluded.entity_id,
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
  -- Timeline events (admin dashboard + expandable per-resident history)
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
    -- Paid resident
    (
      'cccccccc-0001-4000-8000-000000000101',
      run_paid,
      'rent.due_detected',
      'trigger',
      'trigger',
      'system',
      'Rent due detected for Jordan Reyes (Unit 101).',
      seed_landlord_id,
      'rent_collection',
      now_ts - interval '8 days'
    ),
    (
      'cccccccc-0001-4000-8000-000000000102',
      run_paid,
      'rent.reminder_sent',
      'route',
      'route',
      'system',
      'Rent reminder sent via SMS and email.',
      seed_landlord_id,
      'rent_collection',
      now_ts - interval '7 days'
    ),
    (
      'cccccccc-0001-4000-8000-000000000103',
      run_paid,
      'rent.payment_received',
      'act',
      'act',
      'resident',
      'Resident confirmed rent paid in full.',
      seed_landlord_id,
      'rent_collection',
      now_ts - interval '2 days'
    ),
    -- Due today
    (
      'cccccccc-0001-4000-8000-000000000201',
      run_due_today,
      'rent.due_detected',
      'trigger',
      'trigger',
      'system',
      'Rent due today for Sam Chen (Unit 102).',
      seed_landlord_id,
      'rent_collection',
      now_ts - interval '3 days'
    ),
    (
      'cccccccc-0001-4000-8000-000000000202',
      run_due_today,
      'rent.reminder_sent',
      'route',
      'route',
      'system',
      'Rent reminder sent via SMS and email.',
      seed_landlord_id,
      'rent_collection',
      now_ts - interval '2 days'
    ),
    (
      'cccccccc-0001-4000-8000-000000000203',
      run_due_today,
      'rent.payment_requested',
      'act',
      'act',
      'system',
      'Payment link included in outreach.',
      seed_landlord_id,
      'rent_collection',
      now_ts - interval '1 day'
    ),
    -- Overdue
    (
      'cccccccc-0001-4000-8000-000000000301',
      run_overdue,
      'rent.due_detected',
      'trigger',
      'trigger',
      'system',
      'Rent overdue for Riley Brooks (Unit 103).',
      seed_landlord_id,
      'rent_collection',
      now_ts - interval '18 days'
    ),
    (
      'cccccccc-0001-4000-8000-000000000302',
      run_overdue,
      'rent.reminder_sent',
      'route',
      'route',
      'system',
      'Rent reminder sent via SMS and email.',
      seed_landlord_id,
      'rent_collection',
      now_ts - interval '17 days'
    ),
    (
      'cccccccc-0001-4000-8000-000000000303',
      run_overdue,
      'rent.payment_requested',
      'act',
      'act',
      'system',
      'Payment requested; balance remains unpaid.',
      seed_landlord_id,
      'rent_collection',
      now_ts - interval '10 days'
    ),
    -- Missing phone (email-only route)
    (
      'cccccccc-0001-4000-8000-000000000401',
      run_no_phone,
      'rent.due_detected',
      'trigger',
      'trigger',
      'system',
      'Rent due today for Casey Kim (Unit 104). No phone on file.',
      seed_landlord_id,
      'rent_collection',
      now_ts - interval '3 days'
    ),
    (
      'cccccccc-0001-4000-8000-000000000402',
      run_no_phone,
      'rent.reminder_sent',
      'route',
      'route',
      'system',
      'Rent reminder sent via email only (no phone number).',
      seed_landlord_id,
      'rent_collection',
      now_ts - interval '2 days'
    ),
    (
      'cccccccc-0001-4000-8000-000000000403',
      run_no_phone,
      'rent.payment_requested',
      'act',
      'act',
      'system',
      'Payment link emailed; SMS skipped.',
      seed_landlord_id,
      'rent_collection',
      now_ts - interval '1 day'
    ),
    -- Partial payment
    (
      'cccccccc-0001-4000-8000-000000000501',
      run_partial,
      'rent.due_detected',
      'trigger',
      'trigger',
      'system',
      'Rent due for Morgan Lee (Unit 105).',
      seed_landlord_id,
      'rent_collection',
      now_ts - interval '10 days'
    ),
    (
      'cccccccc-0001-4000-8000-000000000502',
      run_partial,
      'rent.reminder_sent',
      'route',
      'route',
      'system',
      'Rent reminder sent via SMS and email.',
      seed_landlord_id,
      'rent_collection',
      now_ts - interval '9 days'
    ),
    (
      'cccccccc-0001-4000-8000-000000000503',
      run_partial,
      'rent.payment_received',
      'act',
      'act',
      'resident',
      'Resident reported partial payment; $600.00 remaining.',
      seed_landlord_id,
      'rent_collection',
      now_ts - interval '1 day'
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

  raise notice 'Rent collection demo seed complete (landlord %, billing %).', seed_landlord_id, billing_period;
end $$;
