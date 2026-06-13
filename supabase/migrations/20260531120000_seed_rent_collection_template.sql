-- Seed rent_collection workflow template (reusable workflow engine template).

insert into public.workflow_templates (
  id,
  name,
  type,
  description,
  trigger_config,
  route_config,
  escalation_config,
  active
)
values
  (
    'rent_collection',
    'Rent Collection',
    'operations',
    'Proactive rent reminders: notify residents with balance due, collect payment confirmation, escalate if no response.',
    jsonb_build_object(
      'type', 'rent_due',
      'days_before_due', 3,
      'rent_due_day', 1,
      'triggers', jsonb_build_array('cron'),
      'description', 'Resident has balance_due > 0 within reminder window'
    ),
    jsonb_build_object(
      'handler', 'rent_collection',
      'domain', 'operations',
      'classify', jsonb_build_object(
        'workflow', 'rent_collection',
        'label', 'Rent collection workflow'
      ),
      'route', jsonb_build_object(
        'action', 'send_rent_reminder',
        'channels', jsonb_build_array('sms', 'email'),
        'handler', 'sendRentCollectionOutreach',
        'label', 'Send rent reminder to tenant'
      ),
      'act', jsonb_build_object(
        'action', 'collect_payment_confirmation',
        'label', 'Collect PAID / PARTIAL / QUESTIONS reply',
        'responses', jsonb_build_array('paid', 'partial', 'questions')
      ),
      'log', jsonb_build_object(
        'action', 'store_rent_collection_outcome',
        'label', 'Store payment confirmation and escalation in workflow_events',
        'tables', jsonb_build_array('workflow_events', 'operations_graph_events')
      )
    ),
    jsonb_build_object(
      'no_response_days', 5,
      'action', 'notify_landlord',
      'label', 'No response after 5 days → notify landlord'
    ),
    true
  )
on conflict (id) do update set
  name = excluded.name,
  type = excluded.type,
  description = excluded.description,
  trigger_config = excluded.trigger_config,
  route_config = excluded.route_config,
  escalation_config = excluded.escalation_config,
  active = excluded.active;
