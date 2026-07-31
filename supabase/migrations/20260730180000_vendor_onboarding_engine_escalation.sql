-- Enrich vendor_onboarding escalation: remind after 2 days, escalate after 5.
update public.workflow_templates
set
  escalation_config = jsonb_build_object(
    'workflow_key', 'vendor_onboarding',
    'reminder_days', 2,
    'no_response_days', 5,
    'notify_landlord', true,
    'rules', jsonb_build_array(
      jsonb_build_object(
        'key', 'invite_reminder',
        'after_days', 2,
        'when_stage', 'invited',
        'action', 'remind_vendor',
        'handler', 'escalateVendorOnboardingRun',
        'label', 'Invite unanswered after 2 days → remind vendor'
      ),
      jsonb_build_object(
        'key', 'invite_unanswered',
        'after_days', 5,
        'when_stage', 'invited',
        'action', 'notify_landlord',
        'handler', 'escalateVendorOnboardingRun',
        'label', 'Invite unanswered after 5 days → notify property manager'
      )
    )
  ),
  updated_at = now()
where id = 'vendor_onboarding';
