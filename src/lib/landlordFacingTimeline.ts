/**
 * Landlord Timeline / activity feed — property-team outcomes only.
 * Pipeline stage receipts stay off the UI.
 */

/** Engine stages. Keep `workflow.escalate` — that is a needs-attention outcome. */
export const HIDDEN_PIPELINE_TIMELINE_EVENT_TYPES = new Set([
  'workflow.trigger',
  'workflow.classify',
  'workflow.route',
  'workflow.act',
  'workflow.log',
])

/** Transport receipts. Outcomes live on domain events or collapsed onboarding. */
export const HIDDEN_SMS_TRANSPORT_TIMELINE_EVENT_TYPES = new Set([
  'sms.delivered',
  'sms.message_received',
])

/**
 * Tenant-activation ops alerts. Closing those alerts is bookkeeping — the
 * landlord-facing story is the onboarding card (or action required).
 */
export const HIDDEN_ACTIVATION_ALERT_TIMELINE_EVENT_TYPES = new Set([
  'tenant.activation_failure_resolved',
  'tenant.activation_admin_alert_sent',
  'tenant.activation_admin_alert_failed',
])

const HIDDEN_PIPELINE_TIMELINE_LABELS = new Set([
  'logged',
  'action taken',
  'workflow started',
  'classified',
  'routed',
])

export function isHiddenPipelineTimelineEventType(eventType: string | null | undefined): boolean {
  return HIDDEN_PIPELINE_TIMELINE_EVENT_TYPES.has((eventType ?? '').trim().toLowerCase())
}

export function isHiddenSmsTransportTimelineEventType(
  eventType: string | null | undefined,
): boolean {
  return HIDDEN_SMS_TRANSPORT_TIMELINE_EVENT_TYPES.has((eventType ?? '').trim().toLowerCase())
}

export function isHiddenActivationAlertTimelineEventType(
  eventType: string | null | undefined,
): boolean {
  return HIDDEN_ACTIVATION_ALERT_TIMELINE_EVENT_TYPES.has((eventType ?? '').trim().toLowerCase())
}

/** Hide engine-stage labels when a timeline row only has the plumbing copy. */
export function isVisibleLandlordTimelineDescription(description: string | null | undefined): boolean {
  return !HIDDEN_PIPELINE_TIMELINE_LABELS.has((description ?? '').trim().toLowerCase())
}
