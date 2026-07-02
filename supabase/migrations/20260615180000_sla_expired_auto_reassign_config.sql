-- SLA expired: auto-reassign to next roster vendor; admin only when none exist.

update public.workflow_templates
set escalation_config = jsonb_set(
  jsonb_set(
    coalesce(escalation_config, '{}'::jsonb),
    '{on_sla_expired}',
    jsonb_build_object(
      'action', 'auto_reassign',
      'fallback', 'notify_admin',
      'field', 'due_at',
      'handler', 'sla-expired-auto-reassign',
      'label', 'SLA expires → reassign to next roster vendor (admin if none)'
    ),
    true
  ),
  '{label}',
  '"Vendor decline / no response / SLA → auto-reassign; admin when no roster vendor"'::jsonb,
  true
)
where id in ('maintenance_request', 'maintenance_intake');
