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

/** Hide engine-stage labels when a timeline row only has the plumbing copy. */
export function isVisibleLandlordTimelineDescription(description: string | null | undefined): boolean {
  return !HIDDEN_PIPELINE_TIMELINE_LABELS.has((description ?? '').trim().toLowerCase())
}
