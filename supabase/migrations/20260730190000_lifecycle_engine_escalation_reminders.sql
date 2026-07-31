-- Align move_in / move_out / inspection escalation_config with engine reminder policy.
-- reminder_days → resident SMS reminder; no_response_days → landlord alert / escalate.

update public.workflow_templates
set escalation_config = coalesce(escalation_config, '{}'::jsonb) || jsonb_build_object(
  'reminder_days', 2,
  'no_response_days', 5,
  'notify_landlord', true
)
where id = 'move_in';

update public.workflow_templates
set escalation_config = coalesce(escalation_config, '{}'::jsonb) || jsonb_build_object(
  'reminder_days', 3,
  'no_response_days', 7,
  'notify_landlord', true
)
where id = 'move_out';

update public.workflow_templates
set escalation_config = coalesce(escalation_config, '{}'::jsonb) || jsonb_build_object(
  'reminder_days', 1,
  'no_response_days', 3,
  'notify_landlord', true
)
where id = 'inspection';
