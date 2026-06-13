-- Upsert Lease Renewal workflow template with full pipeline config.
-- Safe to run after 20260526120000_workflow_engine.sql (or on its own if tables exist).

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
    'lease_renewal',
    'Lease Renewal',
    'leasing',
    'Proactive lease renewal: offer before expiry, collect signature, escalate if no response.',
    jsonb_build_object(
      'type', 'lease_expiry',
      'days_before_expiry', 60,
      'triggers', jsonb_build_array('cron'),
      'description', 'Lease expires in 60 days'
    ),
    jsonb_build_object(
      'handler', 'lease_renewal',
      'domain', 'leasing',
      'classify', jsonb_build_object(
        'workflow', 'renewal',
        'label', 'Renewal workflow'
      ),
      'route', jsonb_build_object(
        'action', 'send_renewal_offer',
        'channels', jsonb_build_array('sms', 'email'),
        'label', 'Send renewal offer to tenant'
      ),
      'act', jsonb_build_object(
        'action', 'collect_signature',
        'label', 'Collect signature'
      ),
      'log', jsonb_build_object(
        'action', 'store_renewal_outcome',
        'label', 'Store renewal outcome'
      )
    ),
    jsonb_build_object(
      'no_response_days', 7,
      'action', 'notify_landlord',
      'label', 'No response after 7 days → notify landlord'
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
