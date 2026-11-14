-- Staff metrics suite (20261114200000_staff_analytics_metrics.sql).
-- Seeds a known real landlord and a demo landlord, then checks that
-- get_staff_metrics() returns exact numbers for staff, excludes demo data,
-- and refuses non-staff callers. Compares against a baseline so it can run
-- on a database that already has rows. Everything is rolled back.
begin;

create temp table staff_metrics_result (label text primary key, metrics jsonb) on commit drop;

-- Baseline as platform staff.
select 'staff session' as step, set_config('request.jwt.claims', '{"email":"emeka@ulohome.io"}', true);
insert into staff_metrics_result values ('before', public.get_staff_metrics(30, false));

-- ---------------------------------------------------------------------------
-- Seed
-- ---------------------------------------------------------------------------
insert into public.landlords (id, name, is_demo, created_at, acquisition_source) values
  ('5aff0000-0000-4000-8000-000000000001', 'Metrics Real Landlord', false, now() - interval '10 days', 'referral'),
  ('5aff0000-0000-4000-8000-000000000002', 'Metrics Demo Landlord', true, now() - interval '10 days', null);

insert into public.landlord_onboarding (landlord_id, onboarding_status, completed_at) values
  ('5aff0000-0000-4000-8000-000000000001', 'completed', now() - interval '9 days');

insert into public.properties (id, landlord_id, name) values
  ('5aff0000-0000-4000-8000-0000000000a1', '5aff0000-0000-4000-8000-000000000001', 'Metrics House');

insert into public.units (id, landlord_id, property_id, unit_label) values
  ('5aff0000-0000-4000-8000-0000000000b1', '5aff0000-0000-4000-8000-000000000001', '5aff0000-0000-4000-8000-0000000000a1', '1'),
  ('5aff0000-0000-4000-8000-0000000000b2', '5aff0000-0000-4000-8000-000000000001', '5aff0000-0000-4000-8000-0000000000a1', '2');

insert into public.users (id, landlord_id, resident_id, email, full_name, activation_status, created_at) values
  ('5aff0000-0000-4000-8000-0000000000c1', '5aff0000-0000-4000-8000-000000000001', 'R-METRICS-1', 'm1@example.test', 'Resident One', 'activated', now() - interval '8 days'),
  ('5aff0000-0000-4000-8000-0000000000c2', '5aff0000-0000-4000-8000-000000000001', 'R-METRICS-2', 'm2@example.test', 'Resident Two', 'delivery_failed', now() - interval '8 days');

insert into public.vendors (id, name, landlord_id) values
  ('5aff0000-0000-4000-8000-0000000000d1', 'Metrics Plumbing', '5aff0000-0000-4000-8000-000000000001');

-- Work orders: 1 completed, 1 open emergency + overdue, 1 open + stalled,
-- 1 observation-only (excluded), 1 on the demo landlord (excluded).
insert into public.maintenance_requests (
  id, landlord_id, property_id, priority, urgency, resident_name, email, unit, description,
  category, assigned_vendor_id, vendor_work_status, created_at, assigned_at, completed_at,
  due_at, stall_follow_up_sent_at, observation_only, spend_status, recognized_spend_amount, recognized_spend_at
) values
  ('5aff0000-0000-4000-8000-0000000000e1', '5aff0000-0000-4000-8000-000000000001', '5aff0000-0000-4000-8000-0000000000a1',
   'normal', 'normal', 'Resident One', 'm1@example.test', '1', 'Leaking sink',
   'plumbing', '5aff0000-0000-4000-8000-0000000000d1', 'completed',
   now() - interval '5 days', now() - interval '5 days' + interval '2 hours', now() - interval '4 days',
   null, null, false, 'recognized', 250, now() - interval '4 days'),
  ('5aff0000-0000-4000-8000-0000000000e2', '5aff0000-0000-4000-8000-000000000001', '5aff0000-0000-4000-8000-0000000000a1',
   'emergency', 'urgent', 'Resident One', 'm1@example.test', '1', 'Sparking outlet',
   'electrical', '5aff0000-0000-4000-8000-0000000000d1', 'pending_accept',
   now() - interval '3 days', null, null,
   now() - interval '1 day', null, false, 'none', null, null),
  ('5aff0000-0000-4000-8000-0000000000e3', '5aff0000-0000-4000-8000-000000000001', '5aff0000-0000-4000-8000-0000000000a1',
   'normal', 'normal', 'Resident Two', 'm2@example.test', '2', 'Slow drain',
   'plumbing', '5aff0000-0000-4000-8000-0000000000d1', 'in_progress',
   now() - interval '2 days', now() - interval '2 days' + interval '4 hours', null,
   now() + interval '3 days', now() - interval '1 day', false, 'none', null, null),
  ('5aff0000-0000-4000-8000-0000000000e4', '5aff0000-0000-4000-8000-000000000001', null,
   'normal', 'normal', 'Resident One', 'm1@example.test', '1', 'Home Check observation',
   'hvac', null, 'unassigned',
   now() - interval '2 days', null, null, null, null, true, 'none', null, null),
  ('5aff0000-0000-4000-8000-0000000000e5', '5aff0000-0000-4000-8000-000000000002', null,
   'normal', 'normal', 'Demo Resident', 'demo@example.test', '1', 'Demo ticket',
   'plumbing', null, 'unassigned',
   now() - interval '1 day', null, null, null, null, false, 'none', null, null);

insert into public.maintenance_work_order_reopens (landlord_id, maintenance_request_id, previous_status, new_status, triggered_by, reopened_at)
values ('5aff0000-0000-4000-8000-000000000001', '5aff0000-0000-4000-8000-0000000000e1', 'completed', 'pending_accept', 'system', now() - interval '3 days');

-- Vendor offers: accepted after 30 min, declined after 90 min, accepted after 10 min.
insert into public.vendor_status_events (ticket_id, vendor_id, to_status, created_at) values
  ('5aff0000-0000-4000-8000-0000000000e1', '5aff0000-0000-4000-8000-0000000000d1', 'pending_accept', now() - interval '5 days'),
  ('5aff0000-0000-4000-8000-0000000000e1', '5aff0000-0000-4000-8000-0000000000d1', 'accepted', now() - interval '5 days' + interval '30 minutes'),
  ('5aff0000-0000-4000-8000-0000000000e2', '5aff0000-0000-4000-8000-0000000000d1', 'pending_accept', now() - interval '3 days'),
  ('5aff0000-0000-4000-8000-0000000000e2', '5aff0000-0000-4000-8000-0000000000d1', 'declined', now() - interval '3 days' + interval '90 minutes'),
  ('5aff0000-0000-4000-8000-0000000000e3', '5aff0000-0000-4000-8000-0000000000d1', 'pending_accept', now() - interval '2 days'),
  ('5aff0000-0000-4000-8000-0000000000e3', '5aff0000-0000-4000-8000-0000000000d1', 'accepted', now() - interval '2 days' + interval '10 minutes');

insert into public.vendor_feedback (landlord_id, vendor_id, maintenance_request_id, rating, submitted_at) values
  ('5aff0000-0000-4000-8000-000000000001', '5aff0000-0000-4000-8000-0000000000d1', '5aff0000-0000-4000-8000-0000000000e1', 4, now() - interval '4 days'),
  ('5aff0000-0000-4000-8000-000000000001', '5aff0000-0000-4000-8000-0000000000d1', '5aff0000-0000-4000-8000-0000000000e3', 5, now() - interval '1 day');

insert into public.ledger_events (landlord_id, event_type, direction, amount, created_at) values
  ('5aff0000-0000-4000-8000-000000000001', 'rent_due', 'debit', 1000, now() - interval '6 days'),
  ('5aff0000-0000-4000-8000-000000000001', 'rent_payment_stripe', 'credit', 600, now() - interval '5 days'),
  ('5aff0000-0000-4000-8000-000000000001', 'rent_payment_reported', 'credit', 400, now() - interval '4 days'),
  ('5aff0000-0000-4000-8000-000000000001', 'rent_late', 'debit', 0, now() - interval '2 days');

insert into public.maintenance_invoices (landlord_id, maintenance_request_id, vendor_id, labor_cost, status, submitted_at, approved_at) values
  ('5aff0000-0000-4000-8000-000000000001', '5aff0000-0000-4000-8000-0000000000e1', '5aff0000-0000-4000-8000-0000000000d1', 250, 'approved', now() - interval '4 days', now() - interval '4 days'),
  ('5aff0000-0000-4000-8000-000000000001', '5aff0000-0000-4000-8000-0000000000e3', '5aff0000-0000-4000-8000-0000000000d1', 120, 'submitted', now() - interval '1 day', null);

-- SMS rows need a provisioned number and conversation; the suite only checks
-- the metric math, so skip those foreign keys for these rows.
set local session_replication_role = replica;
insert into public.sms_messages (landlord_id, conversation_id, direction, from_number, to_number, provider, provider_status, created_at) values
  ('5aff0000-0000-4000-8000-000000000001', gen_random_uuid(), 'inbound', '+15550000001', '+15550000002', 'twilio', 'received', now() - interval '2 days'),
  ('5aff0000-0000-4000-8000-000000000001', gen_random_uuid(), 'outbound', '+15550000002', '+15550000001', 'twilio', 'delivered', now() - interval '2 days'),
  ('5aff0000-0000-4000-8000-000000000001', gen_random_uuid(), 'outbound', '+15550000002', '+15550000001', 'twilio', 'delivered', now() - interval '2 days'),
  ('5aff0000-0000-4000-8000-000000000001', gen_random_uuid(), 'outbound', '+15550000002', '+15550000001', 'twilio', 'undelivered', now() - interval '2 days');
set local session_replication_role = origin;

insert into public.ai_classification_log (landlord_id, pipeline_version, raw_message, sanitized_description, llm_provider, confidence_band, was_correct, created_at) values
  ('5aff0000-0000-4000-8000-000000000001', 't', 'x', 'x', 'openai', 'high', true, now() - interval '5 days'),
  ('5aff0000-0000-4000-8000-000000000001', 't', 'x', 'x', 'openai', 'high', false, now() - interval '3 days'),
  ('5aff0000-0000-4000-8000-000000000001', 't', 'x', 'x', 'openai', 'low', null, now() - interval '2 days'),
  ('5aff0000-0000-4000-8000-000000000001', 't', 'x', 'x', null, 'medium', null, now() - interval '2 days');

insert into public.ask_ulo_evals (landlord_id, intent, gate_status, refused, prompt_tokens, completion_tokens, estimated_cost_usd, latency_ms, created_at) values
  ('5aff0000-0000-4000-8000-000000000001', 'maintenance', 'ok', false, 1000, 200, 0.01, 1200, now() - interval '2 days'),
  ('5aff0000-0000-4000-8000-000000000001', 'legal', 'refuse', true, 500, 50, 0.02, 800, now() - interval '1 day');

insert into public.operations_graph_events (landlord_id, event_type, source, created_at)
values ('5aff0000-0000-4000-8000-000000000001', 'ops.ticket_unit_fk_mismatch', 'edge_function', now() - interval '1 day');

insert into staff_metrics_result values ('after', public.get_staff_metrics(30, false));
insert into staff_metrics_result values ('after_with_demo', public.get_staff_metrics(30, true));

-- ---------------------------------------------------------------------------
-- Assertions
-- ---------------------------------------------------------------------------
do $$
declare
  b jsonb := (select metrics from staff_metrics_result where label = 'before');
  a jsonb := (select metrics from staff_metrics_result where label = 'after');
  d jsonb := (select metrics from staff_metrics_result where label = 'after_with_demo');
  mismatches text;
begin
  -- Helper: delta between after and before for a numeric path.
  create temp table checks (name text, got numeric, expected numeric) on commit drop;

  insert into checks values
    ('growth.landlords_total +1 (demo excluded)', (a#>>'{growth,landlords_total}')::numeric - (b#>>'{growth,landlords_total}')::numeric, 1),
    ('growth.properties +1', (a#>>'{growth,properties}')::numeric - (b#>>'{growth,properties}')::numeric, 1),
    ('growth.units +2', (a#>>'{growth,units}')::numeric - (b#>>'{growth,units}')::numeric, 2),
    ('growth.residents +2', (a#>>'{growth,residents}')::numeric - (b#>>'{growth,residents}')::numeric, 2),
    ('growth.residents_activated +1', (a#>>'{growth,residents_activated}')::numeric - (b#>>'{growth,residents_activated}')::numeric, 1),
    ('growth.funnel.onboarding_completed +1', (a#>>'{growth,funnel,onboarding_completed}')::numeric - (b#>>'{growth,funnel,onboarding_completed}')::numeric, 1),
    ('growth.funnel.first_work_order +1', (a#>>'{growth,funnel,first_work_order}')::numeric - (b#>>'{growth,funnel,first_work_order}')::numeric, 1),
    ('growth.landlords_active +1', (a#>>'{growth,landlords_active}')::numeric - (b#>>'{growth,landlords_active}')::numeric, 1),

    ('maintenance.created +3 (observation + demo excluded)', (a#>>'{maintenance,created}')::numeric - (b#>>'{maintenance,created}')::numeric, 3),
    ('maintenance.completed +1', (a#>>'{maintenance,completed}')::numeric - (b#>>'{maintenance,completed}')::numeric, 1),
    ('maintenance.open_now +2', (a#>>'{maintenance,open_now}')::numeric - (b#>>'{maintenance,open_now}')::numeric, 2),
    ('maintenance.overdue_now +1', (a#>>'{maintenance,overdue_now}')::numeric - (b#>>'{maintenance,overdue_now}')::numeric, 1),
    ('maintenance.stalled_now +1', (a#>>'{maintenance,stalled_now}')::numeric - (b#>>'{maintenance,stalled_now}')::numeric, 1),
    ('maintenance.emergencies +1', (a#>>'{maintenance,emergencies}')::numeric - (b#>>'{maintenance,emergencies}')::numeric, 1),
    ('maintenance.reopened +1', (a#>>'{maintenance,reopened}')::numeric - (b#>>'{maintenance,reopened}')::numeric, 1),

    ('vendors.offers +3', (a#>>'{vendors,offers}')::numeric - (b#>>'{vendors,offers}')::numeric, 3),
    ('vendors.accepted +2', (a#>>'{vendors,accepted}')::numeric - (b#>>'{vendors,accepted}')::numeric, 2),
    ('vendors.declined +1', (a#>>'{vendors,declined}')::numeric - (b#>>'{vendors,declined}')::numeric, 1),
    ('vendors.ratings +2', (a#>>'{vendors,ratings}')::numeric - (b#>>'{vendors,ratings}')::numeric, 2),

    ('money.rent_due +1000', (a#>>'{money,rent_due}')::numeric - (b#>>'{money,rent_due}')::numeric, 1000),
    ('money.rent_collected_online +600', (a#>>'{money,rent_collected_online}')::numeric - (b#>>'{money,rent_collected_online}')::numeric, 600),
    ('money.rent_reported_by_tenants +400', (a#>>'{money,rent_reported_by_tenants}')::numeric - (b#>>'{money,rent_reported_by_tenants}')::numeric, 400),
    ('money.rent_late_events +1', (a#>>'{money,rent_late_events}')::numeric - (b#>>'{money,rent_late_events}')::numeric, 1),
    ('money.maintenance_spend +250', (a#>>'{money,maintenance_spend}')::numeric - (b#>>'{money,maintenance_spend}')::numeric, 250),
    ('money.invoices_approved_total +250', (a#>>'{money,invoices_approved_total}')::numeric - (b#>>'{money,invoices_approved_total}')::numeric, 250),
    ('money.invoices_waiting_total +120', (a#>>'{money,invoices_waiting_total}')::numeric - (b#>>'{money,invoices_waiting_total}')::numeric, 120),

    ('sms.inbound +1', (a#>>'{sms,inbound}')::numeric - (b#>>'{sms,inbound}')::numeric, 1),
    ('sms.outbound +3', (a#>>'{sms,outbound}')::numeric - (b#>>'{sms,outbound}')::numeric, 3),
    ('sms.outbound_failed +1', (a#>>'{sms,outbound_failed}')::numeric - (b#>>'{sms,outbound_failed}')::numeric, 1),
    ('sms.residents_activation_failed +1', (a#>>'{sms,residents_activation_failed}')::numeric - (b#>>'{sms,residents_activation_failed}')::numeric, 1),

    ('ai.classifications +4', (a#>>'{ai,classifications}')::numeric - (b#>>'{ai,classifications}')::numeric, 4),
    ('ai.classification_low_confidence +1', (a#>>'{ai,classification_low_confidence}')::numeric - (b#>>'{ai,classification_low_confidence}')::numeric, 1),
    ('ai.classifications_reviewed +2', (a#>>'{ai,classifications_reviewed}')::numeric - (b#>>'{ai,classifications_reviewed}')::numeric, 2),
    ('ai.ask_ulo_answers +2', (a#>>'{ai,ask_ulo_answers}')::numeric - (b#>>'{ai,ask_ulo_answers}')::numeric, 2),
    ('ai.ask_ulo_refused +1', (a#>>'{ai,ask_ulo_refused}')::numeric - (b#>>'{ai,ask_ulo_refused}')::numeric, 1),
    ('ai.ask_ulo_tokens +1750', (a#>>'{ai,ask_ulo_tokens}')::numeric - (b#>>'{ai,ask_ulo_tokens}')::numeric, 1750),
    ('ai.ask_ulo_cost_usd +0.03', (a#>>'{ai,ask_ulo_cost_usd}')::numeric - (b#>>'{ai,ask_ulo_cost_usd}')::numeric, 0.03),

    ('data_health.unit_mismatch_findings_7d +1', (a#>>'{data_health,unit_mismatch_findings_7d}')::numeric - (b#>>'{data_health,unit_mismatch_findings_7d}')::numeric, 1),

    ('include_demo adds every demo landlord',
      (d#>>'{growth,landlords_total}')::numeric - (a#>>'{growth,landlords_total}')::numeric,
      (select count(*) from public.landlords where coalesce(is_demo, false))),
    ('include_demo adds demo work orders',
      (d#>>'{maintenance,created}')::numeric - (a#>>'{maintenance,created}')::numeric,
      (select count(*) from analytics.work_orders where is_demo and created_at >= now() - interval '30 days'));

  -- Exact values when the baseline had no rows of that kind.
  if (b#>>'{vendors,offers}')::numeric = 0 then
    insert into checks values
      ('vendors.acceptance_rate = 0.6667', (a#>>'{vendors,acceptance_rate}')::numeric, 0.6667),
      ('vendors.median_minutes_to_respond = 30', (a#>>'{vendors,median_minutes_to_respond}')::numeric, 30),
      ('vendors.average_rating = 4.5', (a#>>'{vendors,average_rating}')::numeric, 4.5);
  end if;
  if (b#>>'{maintenance,created}')::numeric = 0 then
    insert into checks values
      ('maintenance.median_hours_to_assign = 3', (a#>>'{maintenance,median_hours_to_assign}')::numeric, 3),
      ('maintenance.median_hours_to_complete = 24', (a#>>'{maintenance,median_hours_to_complete}')::numeric, 24);
  end if;
  if (b#>>'{ai,classifications}')::numeric = 0 then
    insert into checks values
      ('ai.classification_rules_only_rate = 0.25', (a#>>'{ai,classification_rules_only_rate}')::numeric, 0.25),
      ('ai.classification_review_accuracy = 0.5', (a#>>'{ai,classification_review_accuracy}')::numeric, 0.5);
  end if;
  if (b#>>'{sms,outbound}')::numeric = 0 then
    insert into checks values
      ('sms.outbound_failure_rate = 0.3333', (a#>>'{sms,outbound_failure_rate}')::numeric, 0.3333);
  end if;

  select string_agg(format('%s: got %s, expected %s', name, coalesce(got::text, 'null'), expected), E'\n')
  into mismatches
  from checks
  where got is distinct from expected;

  if mismatches is not null then
    raise exception E'staff metrics mismatches:\n%', mismatches;
  end if;
  raise notice 'staff metrics: % checks passed', (select count(*) from checks);
end $$;

-- ---------------------------------------------------------------------------
-- Access: landlord accounts and anonymous callers are refused.
-- ---------------------------------------------------------------------------
do $$
begin
  perform set_config('request.jwt.claims', '{"email":"ceorentalsnj@gmail.com"}', true);
  begin
    perform public.get_staff_metrics(30, false);
    raise exception 'landlord account must not read staff metrics';
  exception when insufficient_privilege then
    null;
  end;

  perform set_config('request.jwt.claims', '{}', true);
  begin
    perform public.get_staff_metrics(30, false);
    raise exception 'anonymous caller must not read staff metrics';
  exception when insufficient_privilege then
    null;
  end;

  if has_schema_privilege('authenticated', 'analytics', 'usage') then
    raise exception 'authenticated must not have direct access to the analytics schema';
  end if;
  if has_function_privilege('anon', 'public.get_staff_metrics(integer, boolean)', 'execute') then
    raise exception 'anon must not execute get_staff_metrics';
  end if;
  raise notice 'staff metrics: access checks passed';
end $$;

rollback;
