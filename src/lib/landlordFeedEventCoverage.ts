/**
 * CI contract for landlord Activity Feed copy coverage.
 * Catalog entries must be hidden from the feed or have a real sentence template.
 */

import { LANDLORD_FEED_SENTENCE_EVENT_TYPES } from '@/lib/landlordFeedCopy'
import { landlordFeedHiddenEventTypes } from '@/lib/landlordFacingTimeline'

export { LANDLORD_FEED_SENTENCE_EVENT_TYPES }

export const LANDLORD_FEED_HIDDEN_EVENT_TYPES = landlordFeedHiddenEventTypes()

/**
 * Maintained union of feed-relevant event types.
 * Add a type here only after it is hidden or has a landlordFeedLine template.
 */
export const LANDLORD_FEED_EVENT_CATALOG: readonly string[] = Array.from(
  new Set<string>([
    ...LANDLORD_FEED_HIDDEN_EVENT_TYPES,
    ...LANDLORD_FEED_SENTENCE_EVENT_TYPES,
    // Additional known feed domain keys that already have templates via the
    // sentenced list above — listed explicitly so catalog edits are reviewable.
    'maintenance.created',
    'maintenance.request_submitted',
    'vendor.alert_sent',
    'vendor.accepted',
    'vendor.declined',
    'vendor.replied',
    'maintenance.schedule_confirmed',
    'maintenance.schedule_updated',
    'maintenance.completed',
    'maintenance.spend_recorded',
    'maintenance.estimate_approved',
    'rent.reminder_sent',
    'rent.payment_received',
    'rent.due_detected',
    'rent.late_escalated',
    'landlord.attention_alert_sent',
    'tenant.activation_sms_sent',
    'tenant.activation_completed',
    'inspection.capture_session_ended',
    'inspection.serial_read',
    'maintenance.sla_auto_reassigned',
    'sms.maintenance_cancelled',
  ]),
).sort()

export function isLandlordFeedHiddenEventType(eventType: string): boolean {
  return LANDLORD_FEED_HIDDEN_EVENT_TYPES.includes(eventType)
}

export function isLandlordFeedSentenceEventType(eventType: string): boolean {
  return (LANDLORD_FEED_SENTENCE_EVENT_TYPES as readonly string[]).includes(eventType)
}

export function landlordFeedCoverageGap(eventType: string): string | null {
  if (isLandlordFeedHiddenEventType(eventType) || isLandlordFeedSentenceEventType(eventType)) {
    return null
  }
  return eventType
}
