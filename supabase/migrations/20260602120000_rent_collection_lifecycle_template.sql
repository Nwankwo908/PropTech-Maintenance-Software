-- Rent collection workflow template: explicit trigger → classify → route → act → escalate → log lifecycle.

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
    'Rent due lifecycle: payment reminder on due date, collect payment intent, late payment escalation, ledger + graph audit.',
    jsonb_build_object(
      'type', 'rent_due_date',
      'rent_due_day', 1,
      'triggers', jsonb_build_array('cron'),
      'description', 'Fires when the monthly rent due date arrives for residents with balance_due > 0'
    ),
    jsonb_build_object(
      'handler', 'rent_collection',
      'domain', 'operations',
      'classify', jsonb_build_object(
        'workflow', 'rent_collection',
        'intent', 'payment_reminder',
        'label', 'Classify as payment reminder for outstanding rent'
      ),
      'route', jsonb_build_object(
        'action', 'send_payment_reminder',
        'channels', jsonb_build_array('sms', 'email'),
        'handler', 'sendRentCollectionOutreach',
        'label', 'Send SMS and email payment reminder to resident'
      ),
      'act', jsonb_build_object(
        'action', 'collect_payment_or_intent',
        'handler', 'processRentCollectionPaymentIntent',
        'label', 'Collect payment confirmation or record payment intent (PAID / PARTIAL / QUESTIONS)',
        'responses', jsonb_build_array('paid', 'partial', 'questions')
      ),
      'log', jsonb_build_object(
        'action', 'update_ledger_and_graph',
        'label', 'Append ledger_events and operations_graph_events for each stage',
        'tables', jsonb_build_array('ledger_events', 'workflow_events', 'operations_graph_events')
      )
    ),
    jsonb_build_object(
      'late_payment_grace_days', 3,
      'action', 'late_payment_workflow',
      'handler', 'escalateOverdueRentCollections',
      'label', 'If unpaid after rent due date + grace period, start late payment workflow',
      'notify_landlord', true
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
