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

/**
 * Transport receipts and recognizer diagnostics. Outcomes live on domain
 * events or collapsed onboarding; how Ulo read a text is not a landlord story.
 */
export const HIDDEN_SMS_TRANSPORT_TIMELINE_EVENT_TYPES = new Set([
  'sms.delivered',
  'sms.message_received',
  'sms.intent_recognized',
  'sms.gate_miss',
  'sms.intake_seed_recovered',
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

/**
 * Automation heartbeats that are not property-team outcomes (e.g. hourly cron
 * fired with nothing to do).
 */
export const HIDDEN_OPS_HEARTBEAT_TIMELINE_EVENT_TYPES = new Set([
  'rent.collection_cron_triggered',
  // Staff digest SMS bookkeeping — not a landlord Activity Feed row.
  'ops.needs_admin_vendor_digest',
])

/**
 * Ops notes that stay in the database for audit. They are not a landlord story.
 */
export const HIDDEN_INTERNAL_NOTE_TIMELINE_EVENT_TYPES = new Set([
  'automation.message_suppressed',
  'maintenance.terminate_reason_unmapped',
  // QR session open is setup noise; the finished capture row carries the outcome.
  'inspection.capture_session_started',
  // Bookkeeping / diagnostic — not a property-team outcome.
  'maintenance.open_asks_closed',
  'maintenance.auto_reassign_loop_detected',
  'ops.ticket_unit_fk_mismatch',
  'rent.tenant_reply_while_paused',
  // Internal classification / probe — never landlord-facing card copy.
  'maintenance.classified',
  'maintenance.vendor_availability_probed',
  'vendor.availability_probed',
])

/** Landlord-visible text that is still diagnostic / internal. */
const HIDDEN_DIAGNOSTIC_COPY =
  /\b(audit|\bfk\b|mismatch|auto-reassign|auto reassign|unit\/property|rent collection is paused|open asks closed|schedule tenant ask)\b/i

/**
 * True for diagnostic / ops-internal copy that must never appear on the landlord feed.
 * Keep this keyword-based — do not treat every "maintenance …" label as diagnostic,
 * because graph rows still carry formatEventTypeLabel fallbacks before copy rewrite.
 */
export function looksLikeDiagnosticLandlordFeedCopy(text: string | null | undefined): boolean {
  const value = (text ?? '').trim()
  if (!value) return false
  return HIDDEN_DIAGNOSTIC_COPY.test(value)
}

/** Three or more snake_case segments, e.g. schedule_fsm_ttl_tenant_confirm. */
const SNAKE_CASE_TOKEN = /\b[a-z][a-z0-9]*(?:_[a-z0-9]+){2,}\b/i

/** Exact landlord-facing labels that are engine plumbing, not outcomes. */
export const HIDDEN_PIPELINE_TIMELINE_LABELS = new Set([
  'logged',
  'action taken',
  'workflow started',
  'classified',
  'routed',
])

/** True when the only copy on a feed row is pipeline plumbing. */
export function isPipelineOnlyLandlordFeedCopy(
  label: string | null | undefined,
  message?: string | null,
): boolean {
  const labelText = (label ?? '').trim()
  const messageText = (message ?? '').trim()
  const labelHidden = !labelText || !isVisibleLandlordTimelineDescription(labelText)
  if (!messageText) return labelHidden
  return labelHidden && !isVisibleLandlordTimelineDescription(messageText)
}

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

export function isHiddenOpsHeartbeatTimelineEventType(
  eventType: string | null | undefined,
): boolean {
  return HIDDEN_OPS_HEARTBEAT_TIMELINE_EVENT_TYPES.has((eventType ?? '').trim().toLowerCase())
}

export function isHiddenInternalNoteTimelineEventType(
  eventType: string | null | undefined,
): boolean {
  return HIDDEN_INTERNAL_NOTE_TIMELINE_EVENT_TYPES.has((eventType ?? '').trim().toLowerCase())
}

export function timelineDescriptionHasInternalToken(
  description: string | null | undefined,
): boolean {
  const text = (description ?? '').trim()
  if (!text) return false
  if (/^suppressed automated\b/i.test(text)) return true
  return SNAKE_CASE_TOKEN.test(text)
}

/** All event types the activity feed should not fetch (PostgREST `not in` list). */
export function landlordFeedHiddenEventTypes(): string[] {
  return [
    ...HIDDEN_PIPELINE_TIMELINE_EVENT_TYPES,
    ...HIDDEN_SMS_TRANSPORT_TIMELINE_EVENT_TYPES,
    ...HIDDEN_ACTIVATION_ALERT_TIMELINE_EVENT_TYPES,
    ...HIDDEN_OPS_HEARTBEAT_TIMELINE_EVENT_TYPES,
    ...HIDDEN_INTERNAL_NOTE_TIMELINE_EVENT_TYPES,
  ].sort()
}

/** Hide engine-stage labels when a timeline row only has the plumbing copy. */
export function isVisibleLandlordTimelineDescription(description: string | null | undefined): boolean {
  const text = (description ?? '').trim()
  if (!text) return true
  if (HIDDEN_PIPELINE_TIMELINE_LABELS.has(text.toLowerCase())) return false
  if (timelineDescriptionHasInternalToken(text)) return false
  if (looksLikeDiagnosticLandlordFeedCopy(text)) return false
  return true
}
