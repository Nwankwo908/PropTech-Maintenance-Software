-- Upsert Maintenance Request workflow template (full lifecycle + SMS intake alias).
-- Maps existing maintenance flow into trigger → classify → route → act → escalate → log.

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
    'maintenance_request',
    'Maintenance Request',
    'maintenance',
    'End-to-end maintenance: resident submission, AI classification, vendor assignment, job lifecycle, escalation, and audit log.',
    jsonb_build_object(
      'type', 'resident_submission',
      'triggers', jsonb_build_array('dashboard', 'sms_inbound', 'webhook'),
      'channels', jsonb_build_array('web_form', 'sms'),
      'description', 'Resident submits maintenance issue'
    ),
    jsonb_build_object(
      'handler', 'maintenance_request',
      'domain', 'maintenance',
      'classify', jsonb_build_object(
        'workflow', 'maintenance',
        'label', 'AI categorizes issue as plumbing, electrical, appliance, general, etc.',
        'provider', 'classify_issue_sla',
        'fallback', 'rule_based_intake',
        'categories', jsonb_build_array(
          'plumbing', 'electrical', 'appliance', 'HVAC', 'leak', 'pest', 'lock', 'general', 'other'
        )
      ),
      'route', jsonb_build_object(
        'action', 'assign_vendor',
        'handler', 'assignVendorAndNotify',
        'matcher', 'issue_category',
        'label', 'Assign to best vendor'
      ),
      'act', jsonb_build_object(
        'action', 'vendor_lifecycle',
        'label', 'Vendor accepts, updates status, completes job',
        'statuses', jsonb_build_array(
          'unassigned', 'pending_accept', 'accepted', 'in_progress', 'completed', 'declined'
        ),
        'handlers', jsonb_build_array(
          'vendor_workflow', 'vendor-respond', 'vendor-update-job-status'
        )
      ),
      'log', jsonb_build_object(
        'action', 'store_status_and_notifications',
        'label', 'Store all status changes and notifications in workflow_events',
        'tables', jsonb_build_array(
          'workflow_events', 'vendor_status_events', 'resident_notification_log', 'operations_graph_events'
        )
      )
    ),
    jsonb_build_object(
      'on_vendor_decline', jsonb_build_object(
        'action', 'auto_reassign',
        'handler', 'tryAutoReassignAfterDecline',
        'label', 'Vendor declines → reassign to next vendor'
      ),
      'on_sla_expired', jsonb_build_object(
        'action', 'notify_admin',
        'field', 'due_at',
        'label', 'SLA expires → notify admin'
      ),
      'on_vendor_no_response_hours', 48,
      'on_vendor_no_response', jsonb_build_object(
        'action', 'reassign',
        'handler', 'vendor-delayed-auto-reassign',
        'label', 'No vendor response → reassign'
      ),
      'label', 'If vendor declines or SLA expires, notify admin or reassign'
    ),
    true
  ),
  (
    'maintenance_intake',
    'Maintenance Request',
    'maintenance',
    'SMS/web intake step for maintenance_request workflow (collects issue before ticket creation).',
    jsonb_build_object(
      'type', 'resident_submission',
      'triggers', jsonb_build_array('sms_inbound', 'dashboard', 'webhook'),
      'channels', jsonb_build_array('sms', 'web_form'),
      'parent_template', 'maintenance_request',
      'description', 'Resident submits maintenance issue'
    ),
    jsonb_build_object(
      'handler', 'maintenance_intake',
      'parent_template', 'maintenance_request',
      'domain', 'maintenance',
      'classify', jsonb_build_object(
        'workflow', 'maintenance',
        'label', 'AI categorizes issue as plumbing, electrical, appliance, general, etc.',
        'provider', 'classify_issue_sla',
        'fallback', 'rule_based_intake',
        'categories', jsonb_build_array(
          'plumbing', 'electrical', 'appliance', 'HVAC', 'leak', 'pest', 'lock', 'general', 'other'
        )
      ),
      'route', jsonb_build_object(
        'action', 'collect_intake',
        'handler', 'processResidentMaintenanceIntake',
        'label', 'Collect issue details via SMS wizard'
      ),
      'act', jsonb_build_object(
        'action', 'submit_ticket',
        'handler', 'submitSmsMaintenanceRequest',
        'label', 'Create ticket and start vendor lifecycle'
      ),
      'log', jsonb_build_object(
        'action', 'store_status_and_notifications',
        'label', 'Store all status changes and notifications in workflow_events',
        'tables', jsonb_build_array(
          'workflow_events', 'vendor_status_events', 'resident_notification_log', 'operations_graph_events'
        )
      )
    ),
    jsonb_build_object(
      'on_vendor_decline', jsonb_build_object(
        'action', 'auto_reassign',
        'handler', 'tryAutoReassignAfterDecline'
      ),
      'on_sla_expired', jsonb_build_object(
        'action', 'notify_admin',
        'field', 'due_at'
      ),
      'on_vendor_no_response_hours', 48,
      'on_vendor_no_response', jsonb_build_object(
        'action', 'reassign',
        'handler', 'vendor-delayed-auto-reassign'
      ),
      'label', 'If vendor declines or SLA expires, notify admin or reassign'
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
