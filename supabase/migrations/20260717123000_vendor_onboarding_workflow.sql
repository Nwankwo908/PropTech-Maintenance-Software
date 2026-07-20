-- Vendor onboarding as a first-class workflow template (engine pattern:
-- trigger → classify → route → act → escalate → log). The invite flow creates a
-- workflow_run against this template so vendor verification is traceable in the
-- same pipeline as maintenance, rent, and lifecycle workflows — not a silo.

-- Link a verification session back to its workflow run so the vendor-verification
-- portal can advance / complete the run when the vendor submits.
alter table public.vendor_verifications
  add column if not exists workflow_run_id uuid;

create index if not exists vendor_verifications_workflow_run_id_idx
  on public.vendor_verifications (workflow_run_id);

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
    'vendor_onboarding',
    'Vendor Onboarding',
    'vendor',
    'Vendor verification onboarding: invite a vendor, collect license/COI/background/W-9 + trades and service area, verify, and add to the approved roster.',
    jsonb_build_object(
      'workflow_key', 'vendor_onboarding',
      'type', 'vendor_verification',
      'primary_trigger', 'dashboard',
      'triggers', jsonb_build_array('dashboard', 'vendor_portal'),
      'entity_types', jsonb_build_array('sms_conversation', 'user'),
      'description', 'Landlord invites a vendor to complete verification'
    ),
    jsonb_build_object(
      'workflow_key', 'vendor_onboarding',
      'handler', 'vendor_onboarding',
      'domain', 'vendor',
      'pipeline', jsonb_build_array('trigger', 'classify', 'route', 'act', 'escalate', 'log'),
      'required_steps', jsonb_build_array(
        jsonb_build_object('key', 'invite_sent', 'stage', 'trigger', 'order', 1, 'label', 'Verification invite sent'),
        jsonb_build_object('key', 'classify_channel', 'stage', 'classify', 'order', 2, 'label', 'Classify outreach channel'),
        jsonb_build_object('key', 'deliver_invite', 'stage', 'route', 'order', 3, 'label', 'Deliver invite via SMS / email'),
        jsonb_build_object('key', 'collect_verification', 'stage', 'act', 'order', 4, 'label', 'Collect license, insurance, background, W-9, trades'),
        jsonb_build_object('key', 'verify_and_roster', 'stage', 'act', 'order', 5, 'label', 'Verify documents and add to roster'),
        jsonb_build_object('key', 'append_graph_events', 'stage', 'log', 'order', 6, 'label', 'Log graph events for invite and verification')
      ),
      'status_stages', jsonb_build_array(
        jsonb_build_object('key', 'invited', 'label', 'Invited', 'order', 1, 'terminal', false),
        jsonb_build_object('key', 'in_progress', 'label', 'In progress', 'order', 2, 'terminal', false),
        jsonb_build_object('key', 'submitted', 'label', 'Submitted', 'order', 3, 'terminal', false),
        jsonb_build_object('key', 'verified', 'label', 'Verified', 'order', 4, 'terminal', true),
        jsonb_build_object('key', 'needs_review', 'label', 'Needs review', 'order', 5, 'terminal', false),
        jsonb_build_object('key', 'cancelled', 'label', 'Cancelled', 'order', 6, 'terminal', true)
      ),
      'dashboard_labels', jsonb_build_object(
        'section_title', 'Vendor Onboarding',
        'section_subtitle', 'Vendor verification invites and roster readiness',
        'empty_state', 'No active vendor onboarding workflows.',
        'columns', jsonb_build_object(
          'vendor', 'Vendor',
          'channel', 'Channel',
          'status', 'Status',
          'timeline', 'Timeline'
        )
      ),
      'classify', jsonb_build_object(
        'workflow', 'vendor_onboarding',
        'label', 'Classify outreach channel from invite request',
        'metadata_keys', jsonb_build_array('channel', 'business_name', 'contact_name', 'vendor_id'),
        'classifications', jsonb_build_array(
          jsonb_build_object('key', 'sms', 'label', 'SMS invite', 'source', 'dashboard'),
          jsonb_build_object('key', 'email', 'label', 'Email invite', 'source', 'dashboard'),
          jsonb_build_object('key', 'both', 'label', 'SMS + email invite', 'source', 'dashboard')
        ),
        'default_classification', 'both'
      ),
      'route', jsonb_build_object(
        'action', 'deliver_vendor_invite',
        'handler', 'sendVendorInvite',
        'channels', jsonb_build_array('sms', 'email'),
        'label', 'Deliver verification invite to the vendor'
      ),
      'act', jsonb_build_object(
        'action', 'collect_and_verify',
        'handler', 'vendorVerificationPortal',
        'label', 'Collect and verify vendor credentials, then add to roster'
      ),
      'log', jsonb_build_object(
        'action', 'append_graph_events',
        'label', 'Append operations_graph_events and workflow_events',
        'tables', jsonb_build_array('operations_graph_events', 'workflow_events', 'vendor_verifications'),
        'graph_event_prefix', 'vendor'
      )
    ),
    jsonb_build_object(
      'workflow_key', 'vendor_onboarding',
      'no_response_days', 5,
      'notify_landlord', true,
      'rules', jsonb_build_array(
        jsonb_build_object(
          'key', 'invite_unanswered',
          'after_days', 5,
          'when_stage', 'invited',
          'action', 'notify_landlord',
          'handler', 'escalateVendorOnboardingRuns',
          'label', 'Invite unanswered after 5 days → notify property manager'
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
