-- Reusable lifecycle workflow_templates: move_in, move_out, inspection.
-- Defines workflow key, triggers, required steps, classification metadata,
-- escalation rules, dashboard labels, and status stages (engine pattern).
-- Supersedes minimal unit_inspection seed with canonical id `inspection`.

update public.workflow_templates
set active = false
where id = 'unit_inspection';

-- ---------------------------------------------------------------------------
-- Shared helper: lifecycle template route_config shape
-- pipeline: trigger → classify → route → act → escalate → log
-- ---------------------------------------------------------------------------

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
    'move_in',
    'Move In',
    'leasing',
    'Tenant move-in lifecycle: register occupancy, send checklist, confirm readiness, escalate incomplete checklists.',
    jsonb_build_object(
      'workflow_key', 'move_in',
      'type', 'unit_activation',
      'primary_trigger', 'dashboard',
      'triggers', jsonb_build_array('dashboard', 'automation'),
      'entity_types', jsonb_build_array('unit', 'occupancy', 'user'),
      'description', 'Unit activated with new tenant occupancy'
    ),
    jsonb_build_object(
      'workflow_key', 'move_in',
      'handler', 'move_in',
      'domain', 'leasing',
      'pipeline', jsonb_build_array('trigger', 'classify', 'route', 'act', 'escalate', 'log'),
      'required_steps', jsonb_build_array(
        jsonb_build_object('key', 'unit_activation_detected', 'stage', 'trigger', 'order', 1, 'label', 'Unit activation detected'),
        jsonb_build_object('key', 'classify_move_in', 'stage', 'classify', 'order', 2, 'label', 'Classify move-in scenario'),
        jsonb_build_object('key', 'send_welcome_outreach', 'stage', 'route', 'order', 3, 'label', 'Send welcome + checklist outreach'),
        jsonb_build_object('key', 'create_checklist_tasks', 'stage', 'act', 'order', 4, 'label', 'Create move-in checklist tasks'),
        jsonb_build_object('key', 'confirm_readiness', 'stage', 'act', 'order', 5, 'label', 'Confirm keys, utilities, and unit readiness'),
        jsonb_build_object('key', 'append_graph_and_tasks', 'stage', 'log', 'order', 6, 'label', 'Log graph events and task completion')
      ),
      'status_stages', jsonb_build_array(
        jsonb_build_object('key', 'initiated', 'label', 'Initiated', 'order', 1, 'terminal', false),
        jsonb_build_object('key', 'occupancy_registered', 'label', 'Occupancy registered', 'order', 2, 'terminal', false),
        jsonb_build_object('key', 'checklist_sent', 'label', 'Checklist sent', 'order', 3, 'terminal', false),
        jsonb_build_object('key', 'awaiting_confirm', 'label', 'Awaiting confirmation', 'order', 4, 'terminal', false),
        jsonb_build_object('key', 'utilities_confirmed', 'label', 'Utilities confirmed', 'order', 5, 'terminal', false),
        jsonb_build_object('key', 'completed', 'label', 'Move-in complete', 'order', 6, 'terminal', true),
        jsonb_build_object('key', 'escalated', 'label', 'Escalated', 'order', 7, 'terminal', true),
        jsonb_build_object('key', 'cancelled', 'label', 'Cancelled', 'order', 8, 'terminal', true)
      ),
      'dashboard_labels', jsonb_build_object(
        'section_title', 'Move Ins',
        'section_subtitle', 'Active move-in workflows by unit and resident',
        'empty_state', 'No active move-in workflows.',
        'stat_cards', jsonb_build_object(
          'active', 'Active move-ins',
          'awaiting_confirm', 'Awaiting confirmation',
          'escalated', 'Escalated',
          'completed', 'Completed (30d)'
        ),
        'status_labels', jsonb_build_object(
          'initiated', 'Initiated',
          'occupancy_registered', 'Occupancy registered',
          'checklist_sent', 'Checklist sent',
          'awaiting_confirm', 'Awaiting confirmation',
          'utilities_confirmed', 'Utilities confirmed',
          'completed', 'Complete',
          'escalated', 'Escalated',
          'cancelled', 'Cancelled'
        ),
        'classification_labels', jsonb_build_object(
          'new_occupancy', 'New occupancy',
          'skip_registration', 'Registration skipped',
          'checklist_complete', 'Checklist complete',
          'checklist_incomplete', 'Checklist incomplete'
        ),
        'columns', jsonb_build_object(
          'resident', 'Resident / unit',
          'move_in_date', 'Move-in date',
          'checklist', 'Checklist',
          'status', 'Status',
          'timeline', 'Timeline'
        )
      ),
      'classify', jsonb_build_object(
        'workflow', 'move_in',
        'label', 'Classify move-in scenario from unit activation or resident reply',
        'metadata_keys', jsonb_build_array(
          'move_in_date', 'occupancy_id', 'unit_id', 'resident_id',
          'move_in_classification', 'classified_at', 'classification_source'
        ),
        'classifications', jsonb_build_array(
          jsonb_build_object('key', 'new_occupancy', 'label', 'New occupancy', 'source', 'unit_activation'),
          jsonb_build_object('key', 'skip_registration', 'label', 'Registration skipped', 'source', 'unit_activation'),
          jsonb_build_object('key', 'checklist_complete', 'label', 'Checklist complete', 'source', 'resident_reply'),
          jsonb_build_object('key', 'checklist_incomplete', 'label', 'Checklist incomplete', 'source', 'balance_and_tasks')
        ),
        'default_classification', 'new_occupancy'
      ),
      'route', jsonb_build_object(
        'action', 'send_move_in_checklist',
        'handler', 'sendMoveInOutreach',
        'channels', jsonb_build_array('sms', 'email'),
        'label', 'Send welcome message and move-in checklist'
      ),
      'act', jsonb_build_object(
        'action', 'complete_move_in_tasks',
        'handler', 'processMoveInChecklist',
        'label', 'Track checklist items and unit readiness',
        'task_types', jsonb_build_array(
          'move_in_welcome', 'move_in_keys', 'move_in_utilities', 'move_in_inspection_prep'
        )
      ),
      'log', jsonb_build_object(
        'action', 'append_graph_and_tasks',
        'label', 'Append operations_graph_events, operations_tasks, workflow_events',
        'tables', jsonb_build_array('operations_graph_events', 'operations_tasks', 'workflow_events'),
        'graph_event_prefix', 'move_in'
      )
    ),
    jsonb_build_object(
      'workflow_key', 'move_in',
      'no_response_days', 5,
      'notify_landlord', true,
      'rules', jsonb_build_array(
        jsonb_build_object(
          'key', 'checklist_incomplete',
          'after_days', 5,
          'when_stage', 'awaiting_confirm',
          'action', 'notify_landlord',
          'handler', 'escalateMoveInRuns',
          'label', 'Checklist incomplete after 5 days → notify property manager'
        )
      )
    ),
    true
  ),
  (
    'move_out',
    'Move Out',
    'leasing',
    'Tenant move-out lifecycle: instructions, turnover tasks, vacancy, move-out inspection, deposit follow-up.',
    jsonb_build_object(
      'workflow_key', 'move_out',
      'type', 'occupancy_end',
      'primary_trigger', 'dashboard',
      'triggers', jsonb_build_array('dashboard', 'sms_inbound', 'cron', 'automation'),
      'entity_types', jsonb_build_array('unit', 'occupancy', 'user'),
      'description', 'Resident vacates, lease ends, or unit is marked vacant'
    ),
    jsonb_build_object(
      'workflow_key', 'move_out',
      'handler', 'move_out',
      'domain', 'leasing',
      'pipeline', jsonb_build_array('trigger', 'classify', 'route', 'act', 'escalate', 'log'),
      'required_steps', jsonb_build_array(
        jsonb_build_object('key', 'vacancy_or_notice_detected', 'stage', 'trigger', 'order', 1, 'label', 'Move-out or vacancy detected'),
        jsonb_build_object('key', 'classify_move_out', 'stage', 'classify', 'order', 2, 'label', 'Classify move-out scenario'),
        jsonb_build_object('key', 'send_move_out_instructions', 'stage', 'route', 'order', 3, 'label', 'Send move-out instructions'),
        jsonb_build_object('key', 'run_turnover_tasks', 'stage', 'act', 'order', 4, 'label', 'Run turnover checklist'),
        jsonb_build_object('key', 'mark_unit_vacant', 'stage', 'act', 'order', 5, 'label', 'End occupancy and mark unit vacant'),
        jsonb_build_object('key', 'schedule_move_out_inspection', 'stage', 'act', 'order', 6, 'label', 'Schedule move-out inspection'),
        jsonb_build_object('key', 'append_graph_and_tasks', 'stage', 'log', 'order', 7, 'label', 'Log graph events and turnover tasks')
      ),
      'status_stages', jsonb_build_array(
        jsonb_build_object('key', 'initiated', 'label', 'Initiated', 'order', 1, 'terminal', false),
        jsonb_build_object('key', 'notice_sent', 'label', 'Instructions sent', 'order', 2, 'terminal', false),
        jsonb_build_object('key', 'awaiting_vacate', 'label', 'Awaiting vacate', 'order', 3, 'terminal', false),
        jsonb_build_object('key', 'turnover_in_progress', 'label', 'Turnover in progress', 'order', 4, 'terminal', false),
        jsonb_build_object('key', 'unit_vacated', 'label', 'Unit vacated', 'order', 5, 'terminal', false),
        jsonb_build_object('key', 'inspection_scheduled', 'label', 'Inspection scheduled', 'order', 6, 'terminal', false),
        jsonb_build_object('key', 'deposit_pending', 'label', 'Deposit pending', 'order', 7, 'terminal', false),
        jsonb_build_object('key', 'completed', 'label', 'Move-out complete', 'order', 8, 'terminal', true),
        jsonb_build_object('key', 'escalated', 'label', 'Escalated', 'order', 9, 'terminal', true),
        jsonb_build_object('key', 'cancelled', 'label', 'Cancelled', 'order', 10, 'terminal', true)
      ),
      'dashboard_labels', jsonb_build_object(
        'section_title', 'Move Outs',
        'section_subtitle', 'Turnover and vacancy workflows by unit',
        'empty_state', 'No active move-out workflows.',
        'stat_cards', jsonb_build_object(
          'active', 'Active move-outs',
          'awaiting_vacate', 'Awaiting vacate',
          'turnover', 'Turnover in progress',
          'escalated', 'Escalated'
        ),
        'status_labels', jsonb_build_object(
          'initiated', 'Initiated',
          'notice_sent', 'Instructions sent',
          'awaiting_vacate', 'Awaiting vacate',
          'turnover_in_progress', 'Turnover in progress',
          'unit_vacated', 'Unit vacated',
          'inspection_scheduled', 'Inspection scheduled',
          'deposit_pending', 'Deposit pending',
          'completed', 'Complete',
          'escalated', 'Escalated',
          'cancelled', 'Cancelled'
        ),
        'classification_labels', jsonb_build_object(
          'voluntary_move_out', 'Voluntary move-out',
          'lease_end', 'Lease end',
          'eviction', 'Eviction',
          'turnover_complete', 'Turnover complete',
          'turnover_overdue', 'Turnover overdue'
        ),
        'columns', jsonb_build_object(
          'resident', 'Resident / unit',
          'vacate_date', 'Vacate date',
          'turnover', 'Turnover',
          'status', 'Status',
          'timeline', 'Timeline'
        )
      ),
      'classify', jsonb_build_object(
        'workflow', 'move_out',
        'label', 'Classify move-out from vacancy action, lease end, or resident SMS',
        'metadata_keys', jsonb_build_array(
          'move_out_date', 'occupancy_id', 'unit_id', 'resident_id',
          'move_out_classification', 'classified_at', 'classification_source'
        ),
        'classifications', jsonb_build_array(
          jsonb_build_object('key', 'voluntary_move_out', 'label', 'Voluntary move-out', 'source', 'resident_reply'),
          jsonb_build_object('key', 'lease_end', 'label', 'Lease end', 'source', 'cron'),
          jsonb_build_object('key', 'eviction', 'label', 'Eviction', 'source', 'dashboard'),
          jsonb_build_object('key', 'turnover_complete', 'label', 'Turnover complete', 'source', 'task_completion'),
          jsonb_build_object('key', 'turnover_overdue', 'label', 'Turnover overdue', 'source', 'balance_and_due_date')
        ),
        'default_classification', 'voluntary_move_out'
      ),
      'route', jsonb_build_object(
        'action', 'send_move_out_instructions',
        'handler', 'sendMoveOutOutreach',
        'channels', jsonb_build_array('sms', 'email'),
        'label', 'Send move-out instructions and inspection scheduling link'
      ),
      'act', jsonb_build_object(
        'action', 'complete_turnover',
        'handler', 'processMoveOutTurnover',
        'label', 'End occupancy, mark vacant, create turnover tasks',
        'task_types', jsonb_build_array(
          'move_out_notice', 'move_out_cleaning', 'move_out_keys_return', 'move_out_inspection_prep'
        ),
        'spawns_workflow', 'inspection'
      ),
      'log', jsonb_build_object(
        'action', 'append_graph_and_tasks',
        'label', 'Append operations_graph_events, operations_tasks, workflow_events',
        'tables', jsonb_build_array('operations_graph_events', 'operations_tasks', 'workflow_events'),
        'graph_event_prefix', 'move_out'
      )
    ),
    jsonb_build_object(
      'workflow_key', 'move_out',
      'no_response_days', 7,
      'notify_landlord', true,
      'rules', jsonb_build_array(
        jsonb_build_object(
          'key', 'turnover_overdue',
          'after_days', 7,
          'when_stage', 'awaiting_vacate',
          'action', 'escalate_turnover',
          'handler', 'escalateMoveOutRuns',
          'label', 'Resident has not vacated after 7 days → escalate to property manager'
        ),
        jsonb_build_object(
          'key', 'deposit_follow_up',
          'after_days', 14,
          'when_stage', 'deposit_pending',
          'action', 'notify_landlord',
          'handler', 'escalateMoveOutDeposit',
          'label', 'Deposit review pending after 14 days → notify property manager'
        )
      )
    ),
    true
  ),
  (
    'inspection',
    'Inspection',
    'operations',
    'Inspection lifecycle: schedule, send legally required notice, record outcome, reschedule or escalate no-shows.',
    jsonb_build_object(
      'workflow_key', 'inspection',
      'type', 'inspection_scheduled',
      'primary_trigger', 'dashboard',
      'triggers', jsonb_build_array('dashboard', 'cron', 'automation'),
      'entity_types', jsonb_build_array('unit', 'inspection', 'user'),
      'description', 'Scheduled or ad-hoc unit / common-area inspection',
      'inspection_types', jsonb_build_array('move_in', 'move_out', 'periodic', 'annual', 'common_area'),
      'notice_hours_before', 72
    ),
    jsonb_build_object(
      'workflow_key', 'inspection',
      'handler', 'inspection',
      'domain', 'operations',
      'pipeline', jsonb_build_array('trigger', 'classify', 'route', 'act', 'escalate', 'log'),
      'required_steps', jsonb_build_array(
        jsonb_build_object('key', 'inspection_scheduled', 'stage', 'trigger', 'order', 1, 'label', 'Inspection scheduled'),
        jsonb_build_object('key', 'classify_inspection', 'stage', 'classify', 'order', 2, 'label', 'Classify inspection type and scope'),
        jsonb_build_object('key', 'send_inspection_notice', 'stage', 'route', 'order', 3, 'label', 'Send inspection notice'),
        jsonb_build_object('key', 'record_inspection_outcome', 'stage', 'act', 'order', 4, 'label', 'Record inspection results'),
        jsonb_build_object('key', 'create_follow_up_tasks', 'stage', 'act', 'order', 5, 'label', 'Create follow-up maintenance or move tasks'),
        jsonb_build_object('key', 'append_graph_and_inspections', 'stage', 'log', 'order', 6, 'label', 'Log graph events and unit_inspections row')
      ),
      'status_stages', jsonb_build_array(
        jsonb_build_object('key', 'initiated', 'label', 'Initiated', 'order', 1, 'terminal', false),
        jsonb_build_object('key', 'scheduled', 'label', 'Scheduled', 'order', 2, 'terminal', false),
        jsonb_build_object('key', 'notice_sent', 'label', 'Notice sent', 'order', 3, 'terminal', false),
        jsonb_build_object('key', 'awaiting_resident', 'label', 'Awaiting resident', 'order', 4, 'terminal', false),
        jsonb_build_object('key', 'in_progress', 'label', 'In progress', 'order', 5, 'terminal', false),
        jsonb_build_object('key', 'completed', 'label', 'Completed', 'order', 6, 'terminal', true),
        jsonb_build_object('key', 'rescheduled', 'label', 'Rescheduled', 'order', 7, 'terminal', false),
        jsonb_build_object('key', 'no_show', 'label', 'No show', 'order', 8, 'terminal', false),
        jsonb_build_object('key', 'escalated', 'label', 'Escalated', 'order', 9, 'terminal', true),
        jsonb_build_object('key', 'cancelled', 'label', 'Cancelled', 'order', 10, 'terminal', true)
      ),
      'dashboard_labels', jsonb_build_object(
        'section_title', 'Inspections',
        'section_subtitle', 'Scheduled inspections and notice delivery by unit',
        'empty_state', 'No active inspection workflows.',
        'stat_cards', jsonb_build_object(
          'scheduled', 'Scheduled',
          'notice_sent', 'Notice sent',
          'awaiting_resident', 'Awaiting resident',
          'escalated', 'Escalated'
        ),
        'status_labels', jsonb_build_object(
          'initiated', 'Initiated',
          'scheduled', 'Scheduled',
          'notice_sent', 'Notice sent',
          'awaiting_resident', 'Awaiting resident',
          'in_progress', 'In progress',
          'completed', 'Completed',
          'rescheduled', 'Rescheduled',
          'no_show', 'No show',
          'escalated', 'Escalated',
          'cancelled', 'Cancelled'
        ),
        'classification_labels', jsonb_build_object(
          'move_in', 'Move-in inspection',
          'move_out', 'Move-out inspection',
          'periodic', 'Periodic inspection',
          'annual', 'Annual inspection',
          'common_area', 'Common area inspection'
        ),
        'columns', jsonb_build_object(
          'unit', 'Unit / property',
          'type', 'Inspection type',
          'scheduled_at', 'Scheduled',
          'notice', 'Notice',
          'status', 'Status',
          'timeline', 'Timeline'
        )
      ),
      'classify', jsonb_build_object(
        'workflow', 'inspection',
        'label', 'Classify inspection type and affected units',
        'metadata_keys', jsonb_build_array(
          'inspection_id', 'inspection_type', 'scheduled_at', 'notice_sent_at',
          'unit_id', 'resident_id', 'property_id',
          'inspection_classification', 'classified_at', 'classification_source'
        ),
        'classifications', jsonb_build_array(
          jsonb_build_object('key', 'move_in', 'label', 'Move-in inspection', 'source', 'workflow_spawn'),
          jsonb_build_object('key', 'move_out', 'label', 'Move-out inspection', 'source', 'workflow_spawn'),
          jsonb_build_object('key', 'periodic', 'label', 'Periodic inspection', 'source', 'dashboard'),
          jsonb_build_object('key', 'annual', 'label', 'Annual inspection', 'source', 'cron'),
          jsonb_build_object('key', 'common_area', 'label', 'Common area inspection', 'source', 'dashboard')
        ),
        'default_classification', 'periodic'
      ),
      'route', jsonb_build_object(
        'action', 'send_inspection_notice',
        'handler', 'sendInspectionNotice',
        'channels', jsonb_build_array('sms', 'email'),
        'label', 'Send legally required inspection notice to affected residents',
        'notice_hours_before', 72
      ),
      'act', jsonb_build_object(
        'action', 'record_inspection_outcome',
        'handler', 'processInspectionOutcome',
        'label', 'Capture pass/fail items and spawn follow-up tasks',
        'outcomes', jsonb_build_array('passed', 'failed', 'partial', 'rescheduled', 'no_show')
      ),
      'log', jsonb_build_object(
        'action', 'append_graph_and_inspections',
        'label', 'Append operations_graph_events, unit_inspections, workflow_events',
        'tables', jsonb_build_array('operations_graph_events', 'unit_inspections', 'workflow_events'),
        'graph_event_prefix', 'inspection'
      )
    ),
    jsonb_build_object(
      'workflow_key', 'inspection',
      'notice_hours_before', 72,
      'no_show_days', 3,
      'notify_landlord', true,
      'rules', jsonb_build_array(
        jsonb_build_object(
          'key', 'notice_overdue',
          'before_hours', 72,
          'when_stage', 'scheduled',
          'action', 'send_notice',
          'handler', 'sendInspectionNotice',
          'label', 'Send notice at least 72 hours before scheduled inspection'
        ),
        jsonb_build_object(
          'key', 'no_show',
          'after_days', 3,
          'when_stage', 'awaiting_resident',
          'action', 'reschedule_or_escalate',
          'handler', 'escalateInspectionRuns',
          'label', 'No show after 3 days → reschedule or notify admin'
        )
      )
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
