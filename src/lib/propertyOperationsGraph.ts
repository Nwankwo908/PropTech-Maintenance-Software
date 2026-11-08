import { getActiveLandlordId } from '@/lib/activeLandlord'
import {
  formatEventTypeLabel,
  formatWorkflowTimestamp,
  hasMappedEventTypeLabel,
} from '@/lib/adminWorkflows'
import {
  isPaymentGraphEventType,
  landlordHasPayments,
} from '@shared/landlordCapabilities'
import {
  isHiddenActivationAlertTimelineEventType,
  isHiddenInternalNoteTimelineEventType,
  isHiddenOpsHeartbeatTimelineEventType,
  isHiddenPipelineTimelineEventType,
  isHiddenSmsTransportTimelineEventType,
  isPipelineOnlyLandlordFeedCopy,
  isVisibleLandlordTimelineDescription,
  landlordFeedHiddenEventTypes,
  looksLikeDiagnosticLandlordFeedCopy,
} from '@/lib/landlordFacingTimeline'
import {
  fallbackFeedLine,
  feedScopeFromSource,
  landlordFeedLine,
  shortVendorName,
  withFeedScope,
  type FeedLine,
} from '@/lib/landlordFeedCopy'
import { readLocalOnboardingState } from '@/lib/onboarding/draftStorage'
import {
  isEventInOnboardingSession,
  onboardingSessionFromState,
} from '@/lib/onboarding/session'
import { supabase } from '@/lib/supabase'
import {
  formatUnitReference,
  shouldOmitUnitReference,
} from '@shared/properties/unitLabelDisplay'
import {
  buildFeedFactSheet,
  fallbackFeedCardCopy,
  feedFactsHash,
  looksLikeEmptyTemplateFeedCopy,
  looksLikePropertyInventoryNoise,
  nonJobFeedCardCopy,
  rescheduleNeedsYouCopy,
  shouldHideFeedFactSheet,
  type FeedCardCopyCache,
  type FeedCardStatus,
  type FeedFactSheet,
  type FeedMilestoneEvent,
} from '@shared/activityFeed/feedFactSheet'

export type PropertyOperationsTimelineCategory =
  | 'spend'
  | 'vendor'
  | 'scheduling'
  | 'work_order'
  | 'equipment'
  | 'tenant'
  | 'rent'
  | 'move_in'
  | 'move_out'
  | 'inspection'
  | 'admin'

export type PropertyOperationsTimelineEvent = {
  id: string
  eventType: string
  label: string
  category: PropertyOperationsTimelineCategory
  message: string | null
  eventSource: string
  createdAt: string
  /** Visit / appointment instant from metadata when the event is about a scheduled window. */
  scheduledAt: string | null
  unitLabel: string | null
  building: string | null
  residentId?: string | null
  residentName: string | null
  vendorName: string | null
  maintenanceRequestId: string | null
  workflowRunId: string | null
  /** Linked ticket title for landlord feed lines (preferred over WO-XXXX). */
  issueHeadline?: string | null
  /** Property type for SFH unit-omit on the grey context line. */
  propertyType?: string | null
  /** Optional “Waiting on …” hint derived from ticket state. */
  waitingHint?: string | null
  /** Oldest→newest short steps when this row is a per-ticket story card. */
  storySteps?: string[] | null
  /** Setup-run stamp from metadata when present (isolates Overview during onboarding). */
  onboardingSessionId?: string | null
  /** Source payload kept for landlord copy. Not rendered on its own. */
  metadata?: Record<string, unknown> | null
  /** Full line before a window cut, for title and aria-label. */
  fullLabel?: string | null
}

export type FeedTicketEnrichment = {
  issueHeadline: string | null
  unitLabel: string | null
  building: string | null
  propertyId: string | null
  propertyType: string | null
  awaitingLandlordChoiceAt: string | null
  vendorWorkStatus: string | null
  spendStatus: string | null
  scheduleConfirmedAt: string | null
  scheduledAt: string | null
  recognizedSpendAmount: number | null
  estimateAmount?: number | null
  estimateDecision?: 'pending_approval' | 'approved' | 'rejected' | 'superseded' | null
  descriptionSummary?: string | null
  trade?: string | null
  completedAt?: string | null
  cancelledAt?: string | null
  /** Cached AI/fallback card copy from maintenance_requests.feed_card_copy. */
  feedCardCopy?: FeedCardCopyCache | null
}

function feedBadgeCategoryFromStatus(
  status: FeedCardStatus,
): PropertyOperationsTimelineCategory {
  if (status === 'estimate_pending' || status === 'invoice_pending') return 'spend'
  if (status === 'visit_scheduled') return 'scheduling'
  return 'work_order'
}

function resolveFeedCardFromTicket(
  event: PropertyOperationsTimelineEvent,
  ticket?: FeedTicketEnrichment | null,
  milestoneEvents: FeedMilestoneEvent[] = [],
): {
  facts: FeedFactSheet
  copy: { headline: string; status_line: string } | null
  hash: string
  hide: boolean
} {
  const bits = ticket ?? feedTicketBitsFromMetadata(event.metadata)
  const facts = buildFeedFactSheet(
    {
      issueHeadline: event.issueHeadline ?? bits?.issueHeadline,
      descriptionSummary: bits?.descriptionSummary,
      trade: bits?.trade,
      building: event.building ?? bits?.building,
      unitLabel: event.unitLabel ?? bits?.unitLabel,
      propertyType: event.propertyType ?? bits?.propertyType,
      vendorName: event.vendorName,
      residentName: event.residentName,
      awaitingLandlordChoiceAt: bits?.awaitingLandlordChoiceAt,
      vendorWorkStatus: bits?.vendorWorkStatus,
      spendStatus: bits?.spendStatus,
      estimateDecision: bits?.estimateDecision,
      scheduleConfirmedAt: bits?.scheduleConfirmedAt,
      scheduledAt: bits?.scheduledAt ?? event.scheduledAt,
      recognizedSpendAmount: bits?.recognizedSpendAmount,
      estimateAmount: bits?.estimateAmount,
      completedAt: bits?.completedAt,
      cancelledAt: bits?.cancelledAt,
    },
    milestoneEvents,
  )
  const hash = feedFactsHash(facts)
  if (shouldHideFeedFactSheet(facts)) {
    return { facts, copy: null, hash, hide: true }
  }
  const cached = bits?.feedCardCopy
  if (cached?.facts_hash === hash && cached.headline?.trim()) {
    return {
      facts,
      copy: { headline: cached.headline, status_line: '' },
      hash,
      hide: false,
    }
  }
  return { facts, copy: fallbackFeedCardCopy(facts), hash, hide: false }
}

export type PropertyOperationsTimelineScope =
  | { unitId: string; residentId?: string | null }
  | { residentId: string; unitId?: string | null }

export type FetchPropertyOperationsTimelineParams = {
  scope: PropertyOperationsTimelineScope
  landlordId?: string | null
  limit?: number
}

export const PROPERTY_OPERATIONS_TIMELINE_CATEGORIES: PropertyOperationsTimelineCategory[] = [
  'spend',
  'vendor',
  'scheduling',
  'work_order',
  'equipment',
  'tenant',
  'rent',
  'move_in',
  'move_out',
  'inspection',
  'admin',
]

export const TIMELINE_CATEGORY_LABELS: Record<PropertyOperationsTimelineCategory, string> = {
  spend: 'Spend',
  vendor: 'Vendor',
  scheduling: 'Scheduling',
  work_order: 'Work orders',
  equipment: 'Equipment',
  tenant: 'Tenant',
  rent: 'Rent',
  move_in: 'Move in',
  move_out: 'Move out',
  inspection: 'Inspection',
  admin: 'Admin',
}

const ADMIN_EVENT_PREFIXES = [
  'broadcast.',
  'lease.',
  'landlord.',
  'unit.',
  'tenant.',
  'sms.',
  'attention.',
]

type EnrichedGraphRow = {
  id: string
  landlord_id: string
  unit_id: string | null
  resident_id: string | null
  vendor_id: string | null
  workflow_run_id: string | null
  event_type: string
  event_source: string
  event_payload: Record<string, unknown> | null
  created_at: string
  unit_label: string | null
  building: string | null
  resident_name: string | null
  vendor_name: string | null
}

type LegacyGraphRow = {
  id: string
  landlord_id: string
  unit_id: string | null
  resident_id: string | null
  vendor_id: string | null
  workflow_run_id: string | null
  event_type: string
  event_source: string
  event_payload: Record<string, unknown> | null
  created_at: string
}

type OperationsGraphRow = {
  id: string
  landlord_id: string
  unit_id: string | null
  resident_id: string | null
  vendor_id: string | null
  workflow_run_id: string | null
  event_type: string
  source: string
  metadata: Record<string, unknown> | null
  maintenance_request_id: string | null
  created_at: string
}

export function categorizePropertyOperationsEvent(
  eventType: string,
  eventSource: string,
): PropertyOperationsTimelineCategory {
  const type = eventType.trim().toLowerCase()
  const source = eventSource.trim().toLowerCase()
  const domain = type.split('.')[0] ?? ''

  if (type.includes('spend') || type.includes('estimate') || type.includes('invoice')) return 'spend'
  if (
    type.includes('serial') ||
    type.includes('nameplate') ||
    type.includes('data_plate') ||
    type.includes('equipment')
  ) {
    return 'equipment'
  }
  if (domain === 'inspection') return 'inspection'
  if (
    type.includes('schedule') ||
    type.includes('visit') ||
    type.includes('reschedule') ||
    type.includes('availability')
  ) {
    return 'scheduling'
  }
  if (
    domain === 'vendor' ||
    type.includes('vendor_alert') ||
    type.includes('.accepted') ||
    type.includes('.declined')
  ) {
    return 'vendor'
  }
  if (domain === 'tenant' || domain === 'sms') return 'tenant'
  if (domain === 'rent') return 'rent'
  if (domain === 'move_in') return 'move_in'
  if (domain === 'move_out') return 'move_out'
  if (domain === 'maintenance' || domain === 'workflow') return 'work_order'
  if (domain === 'ask_ulo' || domain === 'document') return 'admin'
  // Landlord attention alerts about a live job are work-order outcomes, not Admin.
  if (type === 'landlord.attention_alert_sent' || domain === 'attention') return 'work_order'

  const systemSource = source === 'automation' || source === 'edge_function' || source === 'system'
  const landlordAction =
    !systemSource &&
    (source === 'dashboard' ||
      domain === 'broadcast' ||
      domain === 'landlord' ||
      domain === 'unit' ||
      domain === 'lease')
  if (landlordAction) return 'admin'
  if (domain === 'broadcast' || domain === 'landlord') return 'admin'
  return 'work_order'
}

export function formatTimelineCategoryLabel(
  category: PropertyOperationsTimelineCategory,
): string {
  return TIMELINE_CATEGORY_LABELS[category]
}

export { formatWorkflowTimestamp }

function readPayloadMessage(payload: Record<string, unknown> | null | undefined): string | null {
  if (!payload) return null

  for (const key of ['message', 'summary', 'description', 'note']) {
    const value = payload[key]
    if (typeof value === 'string' && value.trim()) {
      return value.trim()
    }
  }

  // Older landlord.attention_alert_sent rows stored copy under headline/detail only.
  const headline = typeof payload.headline === 'string' ? payload.headline.trim() : ''
  const detail = typeof payload.detail === 'string' ? payload.detail.trim() : ''
  if (headline && detail && !headline.toLowerCase().includes(detail.toLowerCase())) {
    return `${headline} · ${detail}`
  }
  if (headline) return headline
  if (detail) return detail

  return null
}

function readScheduledAt(payload: Record<string, unknown> | null | undefined): string | null {
  if (!payload) return null
  for (const key of ['scheduled_at', 'visit_at', 'appointment_at']) {
    const value = payload[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return null
}

function upsertTimelineEvent(
  merged: Map<string, PropertyOperationsTimelineEvent>,
  event: PropertyOperationsTimelineEvent,
): void {
  for (const [key, existing] of merged) {
    if (!isDuplicateFeedEvent(existing, event)) continue
    merged.set(key, preferRicherFeedEvent(existing, event))
    return
  }
  merged.set(event.id || eventDedupeKey(event), event)
}

const SUPPLEMENTAL_GRAPH_DOMAINS = new Set([
  'vendor',
  'maintenance',
  'rent',
  'move_in',
  'move_out',
  'inspection',
])

function isSupplementalOperationsRow(row: OperationsGraphRow): boolean {
  const domain = row.event_type.split('.')[0]
  if (SUPPLEMENTAL_GRAPH_DOMAINS.has(domain)) return true
  if (row.source === 'dashboard') return true
  return ADMIN_EVENT_PREFIXES.some((prefix) => row.event_type.startsWith(prefix))
}

function eventDedupeKey(event: Pick<
  PropertyOperationsTimelineEvent,
  'eventType' | 'createdAt' | 'workflowRunId' | 'maintenanceRequestId'
>): string {
  return [
    event.eventType,
    event.createdAt,
    event.workflowRunId ?? '',
    event.maintenanceRequestId ?? '',
  ].join('|')
}

const TICKET_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Ticket id from graph payload / nested legacy metadata. */
export function ticketIdFromGraphPayload(
  payload: Record<string, unknown> | null | undefined,
): string | null {
  if (!payload) return null
  for (const key of ['maintenance_request_id', 'draft_ticket_id', 'ticket_id']) {
    const value = payload[key]
    if (typeof value === 'string' && TICKET_UUID.test(value.trim())) return value.trim()
  }
  const nested = payload.legacy_metadata
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
    return ticketIdFromGraphPayload(nested as Record<string, unknown>)
  }
  return null
}

function mapEnrichedGraphRow(row: EnrichedGraphRow): PropertyOperationsTimelineEvent {
  const payload = row.event_payload ?? {}

  return {
    id: row.id,
    eventType: row.event_type,
    label: formatEventTypeLabel(row.event_type),
    category: categorizePropertyOperationsEvent(row.event_type, row.event_source),
    message: readPayloadMessage(payload),
    eventSource: row.event_source,
    createdAt: row.created_at,
    scheduledAt: readScheduledAt(payload),
    unitLabel: row.unit_label,
    building: row.building,
    residentId: row.resident_id,
    residentName: row.resident_name,
    vendorName: row.vendor_name ?? readMetadataString(payload, 'vendor_name'),
    maintenanceRequestId: ticketIdFromGraphPayload(payload),
    workflowRunId: row.workflow_run_id,
    onboardingSessionId: readMetadataString(payload, 'onboarding_session_id'),
    metadata: payload,
  }
}

function mapLegacyBridgeRow(row: LegacyGraphRow): PropertyOperationsTimelineEvent {
  const payload = row.event_payload ?? {}

  return {
    id: row.id,
    eventType: row.event_type,
    label: formatEventTypeLabel(row.event_type),
    category: categorizePropertyOperationsEvent(row.event_type, row.event_source),
    message: readPayloadMessage(payload),
    eventSource: row.event_source,
    createdAt: row.created_at,
    scheduledAt: readScheduledAt(payload),
    unitLabel: null,
    building: null,
    residentId: row.resident_id,
    residentName: readMetadataString(payload, 'resident_name'),
    vendorName: readMetadataString(payload, 'vendor_name'),
    maintenanceRequestId: ticketIdFromGraphPayload(payload),
    workflowRunId: row.workflow_run_id,
    onboardingSessionId: readMetadataString(payload, 'onboarding_session_id'),
    metadata: payload,
  }
}

function readMetadataString(
  metadata: Record<string, unknown> | null | undefined,
  key: string,
): string | null {
  const value = metadata?.[key]
  if (typeof value === 'string' && value.trim()) return value.trim()
  return null
}

/** Batch setup events that read better as one feed line (same type, day, building). */
const CONSOLIDATED_SETUP_EVENT_TYPES = new Set([
  'unit.registered',
  'tenant.sms_registered',
])

function consolidationGroupKey(event: PropertyOperationsTimelineEvent): string | null {
  if (!CONSOLIDATED_SETUP_EVENT_TYPES.has(event.eventType)) return null
  const day = event.createdAt.slice(0, 10)
  const building = (event.building ?? 'Portfolio').trim() || 'Portfolio'
  return `${event.eventType}|${day}|${building}`
}

function consolidatedSetupLabel(eventType: string, count: number): string {
  if (eventType === 'unit.registered') {
    return count === 1 ? 'Registered a unit' : `Registered ${count} units`
  }
  if (eventType === 'tenant.sms_registered') {
    return count === 1 ? 'Linked a resident for SMS' : `Linked ${count} residents for SMS`
  }
  const base = formatEventTypeLabel(eventType)
  return count === 1 ? base : `${count} × ${base}`
}

function mergeSetupEventGroup(group: PropertyOperationsTimelineEvent[]): PropertyOperationsTimelineEvent {
  const sorted = [...group].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const latest = sorted[0]!
  const building = latest.building ?? sorted.find((event) => event.building)?.building ?? null
  const count = sorted.length

  let message = latest.message
  if (count > 1) {
    if (latest.eventType === 'tenant.sms_registered') {
      message = `Linked ${count} residents for SMS${building ? ` at ${building}` : ''}.`
    } else {
      message = `Registered ${count} units${building ? ` at ${building}` : ''}.`
    }
  }

  return {
    ...latest,
    id: `consolidated:${consolidationGroupKey(latest) ?? latest.id}`,
    label: consolidatedSetupLabel(latest.eventType, count),
    message,
    building,
    unitLabel: count === 1 ? latest.unitLabel : null,
  }
}

/**
 * Tenant onboarding lifecycle events. Activation welcome text, its delivery
 * receipt, the resident's reply, and their consent decision are all one story —
 * they collapse into a single "Tenant onboarding" feed card per resident/day.
 */
const TENANT_ONBOARDING_EVENT_TYPES = new Set([
  'tenant.activation_sms_sent',
  'tenant.activation_sms_failed',
  'tenant.sms_opted_in',
  'tenant.sms_opted_out',
  'tenant.sms_help',
  'tenant.activation_completed',
])

/** Generic SMS lifecycle events count as onboarding only when not tied to a ticket. */
const TENANT_ONBOARDING_SMS_EVENT_TYPES = new Set([
  'sms.delivered',
  'sms.delivery_failed',
  'sms.message_received',
])

function tenantOnboardingGroupKey(event: PropertyOperationsTimelineEvent): string | null {
  const residentId = event.residentId?.trim()
  if (!residentId) return null

  const isTenantEvent = TENANT_ONBOARDING_EVENT_TYPES.has(event.eventType)
  const isOnboardingSms =
    TENANT_ONBOARDING_SMS_EVENT_TYPES.has(event.eventType) && !event.maintenanceRequestId
  if (!isTenantEvent && !isOnboardingSms) return null

  const day = event.createdAt.slice(0, 10)
  return `tenant_onboarding|${residentId}|${day}`
}

function mergeTenantOnboardingGroup(
  group: PropertyOperationsTimelineEvent[],
  nameByResident: Map<string, string>,
): PropertyOperationsTimelineEvent {
  const sorted = [...group].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const latest = sorted[0]!
  const residentId = latest.residentId?.trim() ?? ''
  const day = latest.createdAt.slice(0, 10)
  const types = new Set(group.map((event) => event.eventType))

  const residentName =
    (residentId ? nameByResident.get(residentId) : null) ??
    sorted.find((event) => event.residentName)?.residentName ??
    null
  const building = sorted.find((event) => event.building)?.building ?? null
  const unitLabel = sorted.find((event) => event.unitLabel)?.unitLabel ?? null
  const workflowRunId = sorted.find((event) => event.workflowRunId)?.workflowRunId ?? null

  const sent = types.has('tenant.activation_sms_sent')
  const delivered = types.has('sms.delivered')
  const replied = types.has('sms.message_received')
  const optedIn = types.has('tenant.sms_opted_in')
  const optedOut = types.has('tenant.sms_opted_out')
  const failed =
    types.has('tenant.activation_sms_failed') || types.has('sms.delivery_failed')

  const who = residentName ?? 'Resident'
  const activated = types.has('tenant.activation_completed') || optedIn
  const label = failed && !activated
    ? `Tried to start text onboarding for ${who}`
    : activated
      ? `Finished text onboarding for ${who}`
      : `Started text onboarding for ${who}`

  const steps: string[] = []
  if (sent) steps.push('welcome text sent')
  if (delivered) steps.push('delivered')
  if (replied) steps.push('resident replied')
  if (optedIn) steps.push('opted in to SMS updates')
  if (types.has('tenant.activation_completed')) steps.push('activated')
  if (optedOut) steps.push('opted out')
  if (failed) steps.push('a delivery attempt failed')

  const message = steps.length ? `${who}: ${steps.join(' → ')}.` : latest.message

  return {
    ...latest,
    id: `tenant-onboarding:${residentId}:${day}`,
    eventType: 'tenant.onboarding_verification',
    category: 'tenant',
    label,
    message,
    residentName,
    building,
    unitLabel,
    workflowRunId,
  }
}

function isMergedLandlordFacingFeedCard(event: PropertyOperationsTimelineEvent): boolean {
  return (
    event.id.startsWith('tenant-onboarding:') ||
    event.id.startsWith('consolidated:') ||
    event.id.startsWith('ticket-story:')
  )
}

/**
 * Overview (and other landlord feeds) should show what Ulo did for the property
 * team — opened a work order, sent a welcome text, asked them to pick a vendor —
 * not engine/SMS plumbing.
 */
export function isLandlordFacingFeedEvent(event: PropertyOperationsTimelineEvent): boolean {
  if (isMergedLandlordFacingFeedCard(event)) return true
  if (isHiddenPipelineTimelineEventType(event.eventType)) return false
  if (isHiddenSmsTransportTimelineEventType(event.eventType)) return false
  if (isHiddenActivationAlertTimelineEventType(event.eventType)) return false
  if (isHiddenOpsHeartbeatTimelineEventType(event.eventType)) return false
  if (isHiddenInternalNoteTimelineEventType(event.eventType)) return false
  // Even if event_type is not a known pipeline id, Classified/Routed/Logged-only
  // copy must never surface on the landlord feed.
  if (isPipelineOnlyLandlordFeedCopy(event.label, event.message)) return false
  // Hide diagnostic copy and raw dotted-name fallbacks with nothing better to show.
  const label = event.label?.trim() || ''
  const message = event.message?.trim() || ''
  if (looksLikePropertyInventoryNoise(message) || looksLikePropertyInventoryNoise(label)) {
    return false
  }
  // Empty-template / Repair labels are stripped after applyLandlordFacingCopy,
  // once story cards have rewritten headlines from the fact sheet.
  if (looksLikeDiagnosticLandlordFeedCopy(message) || looksLikeDiagnosticLandlordFeedCopy(label)) {
    return false
  }
  if (
    looksLikeRawEventTypeLabel(event.eventType, label) &&
    !hasMappedEventTypeLabel(event.eventType)
  ) {
    if (
      !message ||
      !isVisibleLandlordTimelineDescription(message) ||
      looksLikeRawEventTypeLabel(event.eventType, message)
    ) {
      return false
    }
  }
  if (!landlordHasPayments(getActiveLandlordId()) && isPaymentGraphEventType(event.eventType)) {
    return false
  }
  return true
}

function looksLikeRawEventTypeLabel(eventType: string, label: string): boolean {
  const fallback = eventType.replace(/[._]/g, ' ')
  return label.trim().toLowerCase() === fallback.toLowerCase()
}

const DEDUPE_WINDOW_MS = 5_000
const NEAR_DUPLICATE_WINDOW_MS = 10 * 60_000
const PAIR_WINDOW_MS = 60_000

function eventTime(iso: string): number {
  const value = Date.parse(iso)
  return Number.isNaN(value) ? 0 : value
}

function withinWindow(a: string, b: string, windowMs: number): boolean {
  return Math.abs(eventTime(a) - eventTime(b)) <= windowMs
}

function normalizeFeedMessage(message: string | null | undefined): string {
  return (message ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
}

function feedRichness(event: PropertyOperationsTimelineEvent): number {
  let score = 0
  if (event.building) score += 4
  if (event.unitLabel) score += 2
  if (event.residentName) score += 2
  if (event.vendorName) score += 2
  if (event.maintenanceRequestId) score += 6
  if (event.message) score += 1
  if (event.metadata && Object.keys(event.metadata).length > 0) score += 1
  return score
}

function preferRicherFeedEvent(
  a: PropertyOperationsTimelineEvent,
  b: PropertyOperationsTimelineEvent,
): PropertyOperationsTimelineEvent {
  const primary = feedRichness(a) >= feedRichness(b) ? a : b
  const secondary = primary === a ? b : a
  const primaryMessage = primary.message?.trim() ?? ''
  const secondaryMessage = secondary.message?.trim() ?? ''
  return {
    ...primary,
    building: primary.building ?? secondary.building,
    unitLabel: primary.unitLabel ?? secondary.unitLabel,
    residentName: primary.residentName ?? secondary.residentName,
    vendorName: primary.vendorName ?? secondary.vendorName,
    maintenanceRequestId: primary.maintenanceRequestId ?? secondary.maintenanceRequestId,
    workflowRunId: primary.workflowRunId ?? secondary.workflowRunId,
    scheduledAt: primary.scheduledAt ?? secondary.scheduledAt,
    message: primaryMessage.length >= secondaryMessage.length ? primary.message : secondary.message,
    metadata: { ...(secondary.metadata ?? {}), ...(primary.metadata ?? {}) },
  }
}

function nearDuplicateMeaning(
  a: PropertyOperationsTimelineEvent,
  b: PropertyOperationsTimelineEvent,
): boolean {
  const labelA = normalizeFeedMessage(a.label || a.message)
  const labelB = normalizeFeedMessage(b.label || b.message)
  if (!labelA || !labelB) return false
  if (labelA === labelB) return true
  // Same ticket + same semantic family (response-time / accepted / capture ended).
  const families: Array<{ re: RegExp; key: string }> = [
    { re: /didn'?t reply|response time expired|no vendor reply|sla.?auto.?reassign/i, key: 'no_reply' },
    { re: /\baccepted\b/i, key: 'accepted' },
    { re: /finished .+photo|photo capture ended|equipment photo scan/i, key: 'capture_ended' },
    { re: /started .+photo|photo capture started/i, key: 'capture_started' },
  ]
  for (const family of families) {
    if (family.re.test(labelA) && family.re.test(labelB)) return true
  }
  return false
}

export function isDuplicateFeedEvent(
  a: PropertyOperationsTimelineEvent,
  b: PropertyOperationsTimelineEvent,
): boolean {
  if (a.id && a.id === b.id) return true
  if (a.workflowRunId && b.workflowRunId && a.workflowRunId !== b.workflowRunId) return false
  const ticketA = a.maintenanceRequestId ?? ''
  const ticketB = b.maintenanceRequestId ?? ''
  if (ticketA && ticketB && ticketA !== ticketB) return false

  if (a.eventType === b.eventType) {
    if (!withinWindow(a.createdAt, b.createdAt, NEAR_DUPLICATE_WINDOW_MS)) return false
    const messageA = normalizeFeedMessage(a.message)
    const messageB = normalizeFeedMessage(b.message)
    if (
      messageA &&
      messageB &&
      messageA !== messageB &&
      !messageA.startsWith(messageB) &&
      !messageB.startsWith(messageA) &&
      !nearDuplicateMeaning(a, b)
    ) {
      // Same type + ticket within 10m still collapses even when wording differs slightly.
      if (ticketA && ticketB && withinWindow(a.createdAt, b.createdAt, NEAR_DUPLICATE_WINDOW_MS)) {
        return true
      }
      if (!withinWindow(a.createdAt, b.createdAt, DEDUPE_WINDOW_MS)) return false
    }
    return true
  }

  // Near-duplicate meaning across different event types (same ticket, 10 minutes).
  if (ticketA && ticketB && withinWindow(a.createdAt, b.createdAt, NEAR_DUPLICATE_WINDOW_MS)) {
    return nearDuplicateMeaning(a, b)
  }
  return false
}

export function dedupePropertyOperationsEvents(
  events: PropertyOperationsTimelineEvent[],
): PropertyOperationsTimelineEvent[] {
  const kept: PropertyOperationsTimelineEvent[] = []
  for (const event of events) {
    const index = kept.findIndex((existing) => isDuplicateFeedEvent(existing, event))
    if (index === -1) {
      kept.push(event)
      continue
    }
    kept[index] = preferRicherFeedEvent(kept[index]!, event)
  }
  return kept
}

function sameTicket(
  a: PropertyOperationsTimelineEvent,
  b: PropertyOperationsTimelineEvent,
): boolean {
  if (a.maintenanceRequestId && b.maintenanceRequestId) {
    return a.maintenanceRequestId === b.maintenanceRequestId
  }
  return withinWindow(a.createdAt, b.createdAt, PAIR_WINDOW_MS)
}

function isWorkOrderCloseEvent(eventType: string): boolean {
  return (
    eventType === 'maintenance.work_order_terminated' ||
    eventType === 'maintenance.work_order_archived' ||
    eventType === 'maintenance.cancelled' ||
    eventType === 'sms.maintenance_cancelled'
  )
}

function nonJobLandlordFeedLine(event: PropertyOperationsTimelineEvent): FeedLine | null {
  const type = event.eventType.trim().toLowerCase()
  const vendor = event.vendorName
  const message = (event.message ?? event.label ?? '').trim()

  if (type === 'vendor.onboarding_overridden' || /activated without verification/i.test(message)) {
    const copy = nonJobFeedCardCopy({ kind: 'vendor_activated_without_docs', vendorName: vendor })
    return { line: copy.headline, full: copy.headline }
  }
  if (
    type === 'vendor.verification_invite_sent' ||
    type === 'vendor.invite_sent' ||
    /verification invite sent/i.test(message)
  ) {
    const copy = nonJobFeedCardCopy({ kind: 'vendor_invited', vendorName: vendor })
    return { line: copy.headline, full: copy.headline }
  }
  if (
    type === 'vendor.verification_verified' ||
    type === 'vendor.activated' ||
    type === 'vendor.onboarding_completed' ||
    (/activation text sent/i.test(message) && type.startsWith('vendor.')) ||
    (/activated\b/i.test(message) && type.startsWith('vendor.') && !/without/i.test(message))
  ) {
    const copy = nonJobFeedCardCopy({ kind: 'vendor_activated', vendorName: vendor })
    return { line: copy.headline, full: copy.headline }
  }
  if (
    type === 'home_check.declined' ||
    type === 'home_check.vendor_declined' ||
    (/home check/i.test(message) && /declined/i.test(message))
  ) {
    const copy = nonJobFeedCardCopy({
      kind: 'home_check_declined',
      vendorName: vendor,
    })
    return { line: copy.headline, full: copy.headline }
  }
  if (
    type === 'inspection.capture_session_ended' ||
    /photo looked fine|no repair was opened|no issues|scan finished/i.test(message)
  ) {
    const copy = nonJobFeedCardCopy({ kind: 'equipment_scan_ok' })
    return { line: copy.headline, full: copy.headline }
  }
  if (
    type === 'landlord.attention_alert_sent' ||
    /reschedule/i.test(type) ||
    /asked to reschedule|they asked for/i.test(message)
  ) {
    const reschedule = rescheduleNeedsYouCopy({
      residentName: event.residentName,
      issueHeadline: event.issueHeadline,
      vendorName: vendor,
    })
    if (reschedule) return { line: reschedule.headline, full: reschedule.headline }
    if (/they asked for/i.test(message) || /Needs you:\s*they asked for/i.test(event.label)) {
      return null
    }
  }
  return null
}

function landlordFacingEventLabel(event: PropertyOperationsTimelineEvent): FeedLine {
  const scope = feedScopeFromSource(event)
  const scoped = (line: FeedLine) => withFeedScope(line, scope)

  // Ticket story cards / enriched tickets: fact-sheet headline (cached AI or fallback).
  if (event.maintenanceRequestId && event.metadata?._feed_card_headline) {
    const headline = String(event.metadata._feed_card_headline)
    const full =
      typeof event.metadata._feed_card_full === 'string' && event.metadata._feed_card_full.trim()
        ? String(event.metadata._feed_card_full)
        : headline
    return scoped({ line: headline, full })
  }

  const nonJob = nonJobLandlordFeedLine(event)
  if (nonJob) return scoped(nonJob)

  const specific = landlordFeedLine(event)
  if (specific) return scoped(specific)

  // Consolidated / onboarding cards already chose an action label — keep it,
  // but still attach property when known.
  if (isMergedLandlordFacingFeedCard(event)) {
    return scoped({ line: event.label, full: event.label })
  }

  // Prefer stored action copy over a generic event-type label whenever we have it.
  const message = event.message?.trim()
  if (
    message &&
    message.length >= 12 &&
    /[A-Za-z]/.test(message) &&
    isVisibleLandlordTimelineDescription(message) &&
    !looksLikeRawEventTypeLabel(event.eventType, message)
  ) {
    return scoped(fallbackFeedLine(message, event.building))
  }

  if (hasMappedEventTypeLabel(event.eventType)) {
    const mapped = formatEventTypeLabel(event.eventType)
    return scoped({ line: mapped, full: mapped })
  }
  return scoped(fallbackFeedLine(event.label, event.building))
}

function mergePairedFeedStories(
  events: PropertyOperationsTimelineEvent[],
): PropertyOperationsTimelineEvent[] {
  const reasons = events.filter((event) => event.eventType === 'maintenance.terminate_reason_unmapped')
  return events
    .filter((event) => !isHiddenInternalNoteTimelineEventType(event.eventType))
    .map((event) => {
      if (!isWorkOrderCloseEvent(event.eventType)) return event
      const reason = reasons.find(
        (row) => sameTicket(row, event) && withinWindow(row.createdAt, event.createdAt, PAIR_WINDOW_MS),
      )
      if (!reason) return event
      const paired =
        readMetadataString(reason.metadata, 'reason') ??
        reason.message?.replace(/^Cancel reason needs vendor-safe copy:\s*/i, '').replace(/^"|"$/g, '') ??
        null
      return {
        ...event,
        metadata: { ...(event.metadata ?? {}), _paired_reason: paired },
      }
    })
}

function applyLandlordFacingCopy(
  event: PropertyOperationsTimelineEvent,
): PropertyOperationsTimelineEvent {
  const copy = landlordFacingEventLabel(event)
  // Keep landlord-facing action copy for tooltips even when the row label is a fit/cut version.
  const message =
    event.eventType === 'landlord.attention_alert_sent' &&
    copy.full &&
    isVisibleLandlordTimelineDescription(copy.full)
      ? copy.full
      : event.message && isVisibleLandlordTimelineDescription(event.message)
        ? event.message
        : null
  const metadata = { ...(event.metadata ?? {}) }
  delete metadata.reason
  delete metadata._paired_reason
  const badgeFromFacts =
    typeof metadata._feed_badge_category === 'string'
      ? (metadata._feed_badge_category as PropertyOperationsTimelineCategory)
      : null
  return {
    ...event,
    label: copy.line,
    fullLabel: copy.full,
    message,
    metadata,
    // Waiting hints are attached once after copy, newest ticket row only.
    waitingHint: null,
    // Job cards: badge follows ticket category (spend / scheduling / work order),
    // not whichever event happened to be newest.
    category: isMergedLandlordFacingFeedCard(event)
      ? event.category
      : badgeFromFacts ??
        categorizePropertyOperationsEvent(event.eventType, event.eventSource),
  }
}

/** Waiting line removed — needs_you / ulo_did headlines already carry the ask. */
export function attachWaitingHintsOnce(
  events: PropertyOperationsTimelineEvent[],
): PropertyOperationsTimelineEvent[] {
  return events.map((event) => ({ ...event, waitingHint: null }))
}

/** Collapse setup/onboarding noise, then keep only landlord-facing outcome lines. */
export function selectLandlordFacingFeedEvents(
  events: PropertyOperationsTimelineEvent[],
  limit: number,
  options?: {
    /** When set (in-progress setup), drop leftovers from prior runs. */
    onboardingSession?: ReturnType<typeof onboardingSessionFromState>
  },
): PropertyOperationsTimelineEvent[] {
  const session = options?.onboardingSession ?? null
  const scoped = session
    ? events.filter((event) =>
        isEventInOnboardingSession(
          {
            createdAt: event.createdAt,
            metadataSessionId: event.onboardingSessionId,
          },
          session,
        ),
      )
    : events

  const rows = attachWaitingHintsOnce(
    consolidateFeedEvents(mergePairedFeedStories(dedupePropertyOperationsEvents(scoped)))
      .filter(isLandlordFacingFeedEvent)
      .map(applyLandlordFacingCopy)
      .filter(
        (event) =>
          !looksLikeEmptyTemplateFeedCopy(event.label) &&
          !/\bRepair:\s*update\b/i.test(event.label || '') &&
          !/\bPick vendor:\s*Repair\b/i.test(event.label || ''),
      ),
  )
  return [...rows]
    .sort((a, b) => {
      const aSafety =
        a.metadata?._feed_safety === true && a.metadata?._feed_open_needs_you === true ? 1 : 0
      const bSafety =
        b.metadata?._feed_safety === true && b.metadata?._feed_open_needs_you === true ? 1 : 0
      if (aSafety !== bSafety) return bSafety - aSafety
      return b.createdAt.localeCompare(a.createdAt)
    })
    .slice(0, Math.max(limit, 0))
}

function storyStepLabel(event: PropertyOperationsTimelineEvent): string {
  const vendor = shortVendorName(event.vendorName)
  const type = event.eventType
  const amount =
    typeof event.metadata?.total_cost === 'number' || typeof event.metadata?.amount === 'number'
      ? `$${Math.round(Number(event.metadata?.total_cost ?? event.metadata?.amount)).toLocaleString('en-US')}`
      : null
  if (type === 'vendor.alert_sent') return vendor ? `Sent to ${vendor}` : 'Sent to vendor'
  if (type === 'vendor.accepted' || (type === 'vendor.replied' && /accept/i.test(String(event.metadata?.parsed_action ?? '')))) {
    return 'Accepted'
  }
  if (type === 'vendor.declined' || (type === 'vendor.replied' && /decline/i.test(String(event.metadata?.parsed_action ?? '')))) {
    return 'Declined'
  }
  if (
    type === 'maintenance.sla_auto_reassigned' ||
    type === 'maintenance.sla_expired_needs_vendor' ||
    /didn'?t reply|no reply|response time expired/i.test(event.label || event.message || '')
  ) {
    return 'No reply'
  }
  if (type === 'landlord.attention_alert_sent') return 'Asked you'
  if (type === 'maintenance.created' || type === 'maintenance.request_submitted') return 'Opened'
  if (type === 'maintenance.completed') return 'Work done'
  if (type === 'maintenance.estimate_approved') return amount ? `Estimate ${amount}` : 'Estimate ok'
  if (type === 'maintenance.estimate_declined' || type === 'maintenance.estimate_rejected') {
    return amount ? `Estimate ${amount}` : 'Estimate no'
  }
  if (type === 'maintenance.spend_recorded') return amount ? `Invoice ${amount}` : 'Invoice'
  if (type.startsWith('inspection.capture')) return 'Scan'
  if (type.includes('schedule')) return 'Visit set'
  const mapped = hasMappedEventTypeLabel(type) ? formatEventTypeLabel(type) : null
  if (mapped && !looksLikeRawEventTypeLabel(type, mapped)) {
    return mapped.split(/\s+/).slice(0, 3).join(' ')
  }
  return (event.label || type).replace(/\s+/g, ' ').trim().split(/\s+/).slice(0, 3).join(' ')
}

/** Keep ≤3 trail steps (1–3 words each); collapse older history as "+N". */
export function compactFeedTrailSteps(steps: string[]): string[] | null {
  const cleaned = steps
    .map((step) => step.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .map((step) => step.split(/\s+/).slice(0, 3).join(' '))
  if (cleaned.length <= 1) return null
  if (cleaned.length <= 3) return cleaned
  const kept = cleaned.slice(0, 2)
  const overflow = cleaned.length - kept.length
  return [...kept, `+${overflow}`]
}

/** Infer live ticket fields from the event group when enrichment is thin (tests / offline). */
function inferTicketBitsFromEventGroup(
  group: PropertyOperationsTimelineEvent[],
  base: FeedTicketEnrichment | null,
): FeedTicketEnrichment {
  const bits: FeedTicketEnrichment = {
    issueHeadline: base?.issueHeadline ?? null,
    unitLabel: base?.unitLabel ?? null,
    building: base?.building ?? null,
    propertyId: base?.propertyId ?? null,
    propertyType: base?.propertyType ?? null,
    awaitingLandlordChoiceAt: base?.awaitingLandlordChoiceAt ?? null,
    vendorWorkStatus: base?.vendorWorkStatus ?? null,
    spendStatus: base?.spendStatus ?? null,
    scheduleConfirmedAt: base?.scheduleConfirmedAt ?? null,
    scheduledAt: base?.scheduledAt ?? null,
    recognizedSpendAmount: base?.recognizedSpendAmount ?? null,
    estimateAmount: base?.estimateAmount ?? null,
    completedAt: base?.completedAt ?? null,
    cancelledAt: base?.cancelledAt ?? null,
    feedCardCopy: base?.feedCardCopy ?? null,
  }

  for (const row of group) {
    const type = row.eventType.trim().toLowerCase()
    const meta = row.metadata ?? {}
    const amount =
      asOptionalNumber(meta.total_cost) ??
      asOptionalNumber(meta.amount) ??
      asOptionalNumber(meta.estimate_amount)
    if (type.includes('spend') || type.includes('invoice')) {
      bits.spendStatus = bits.spendStatus ?? 'invoice_pending'
      if (amount != null) bits.recognizedSpendAmount = bits.recognizedSpendAmount ?? amount
    }
    if (type.includes('estimate') && (type.includes('pending') || type.includes('submitted'))) {
      bits.estimateDecision = bits.estimateDecision ?? 'pending_approval'
      if (amount != null) bits.estimateAmount = bits.estimateAmount ?? amount
    }
    if (type.includes('estimate') && (type.includes('declined') || type.includes('rejected'))) {
      // Current estimate is rejected — landlord needs a new vendor, not approval.
      bits.estimateDecision = 'rejected'
      if (amount != null) bits.estimateAmount = bits.estimateAmount ?? amount
      bits.awaitingLandlordChoiceAt = bits.awaitingLandlordChoiceAt ?? row.createdAt
    }
    if (type.includes('estimate') && type.includes('approved')) {
      bits.estimateDecision = bits.estimateDecision === 'rejected' ? bits.estimateDecision : 'approved'
      if (amount != null) bits.estimateAmount = bits.estimateAmount ?? amount
    }
    if (
      type === 'vendor.accepted' ||
      (type === 'vendor.replied' &&
        String(meta.parsed_action ?? '').toLowerCase() === 'accept')
    ) {
      bits.vendorWorkStatus = bits.vendorWorkStatus ?? 'accepted'
    }
    if (
      type === 'vendor.declined' ||
      (type === 'vendor.replied' &&
        String(meta.parsed_action ?? '').toLowerCase() === 'decline')
    ) {
      bits.vendorWorkStatus = bits.vendorWorkStatus ?? 'declined'
      bits.awaitingLandlordChoiceAt = bits.awaitingLandlordChoiceAt ?? row.createdAt
    }
    if (
      type === 'maintenance.sla_auto_reassigned' ||
      type === 'maintenance.sla_expired_needs_vendor' ||
      type === 'landlord.attention_alert_sent'
    ) {
      bits.awaitingLandlordChoiceAt = bits.awaitingLandlordChoiceAt ?? row.createdAt
    }
    if (type.includes('schedule') && type.includes('confirm')) {
      bits.scheduleConfirmedAt = bits.scheduleConfirmedAt ?? row.createdAt
      bits.scheduledAt = bits.scheduledAt ?? row.scheduledAt ?? row.createdAt
    }
    if (type.includes('completed')) {
      bits.completedAt = bits.completedAt ?? row.createdAt
    }
    if (
      type.includes('terminat') ||
      type.includes('cancel') ||
      type.includes('archiv')
    ) {
      bits.cancelledAt = bits.cancelledAt ?? row.createdAt
    }
    if (!bits.issueHeadline && row.issueHeadline) bits.issueHeadline = row.issueHeadline
  }
  return bits
}

function homeCheckDeclineCopy(
  group: PropertyOperationsTimelineEvent[],
): { headline: string; full: string } | null {
  for (const row of group) {
    const paired =
      typeof row.metadata?._paired_reason === 'string' ? row.metadata._paired_reason : null
    const reason =
      paired ||
      (typeof row.metadata?.reason === 'string' ? row.metadata.reason : null) ||
      row.message ||
      ''
    if (/home check/i.test(reason)) {
      const copy = nonJobFeedCardCopy({
        kind: 'home_check_declined',
        vendorName: row.vendorName,
      })
      return { headline: copy.headline, full: copy.headline }
    }
  }
  return null
}

/** One Activity Feed card per work order: fact-sheet headline (no arrow trails). */
export function groupTicketFeedStories(
  events: PropertyOperationsTimelineEvent[],
): PropertyOperationsTimelineEvent[] {
  const passthrough: PropertyOperationsTimelineEvent[] = []
  const byTicket = new Map<string, PropertyOperationsTimelineEvent[]>()

  for (const event of events) {
    const ticketId = event.maintenanceRequestId?.trim()
    if (!ticketId || isMergedLandlordFacingFeedCard(event)) {
      passthrough.push(event)
      continue
    }
    const list = byTicket.get(ticketId) ?? []
    list.push(event)
    byTicket.set(ticketId, list)
  }

  const stories: PropertyOperationsTimelineEvent[] = []
  for (const [ticketId, group] of byTicket) {
    const newestFirst = [...group].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    const oldestFirst = [...newestFirst].reverse()
    const latest = preferRicherFeedEvent(
      newestFirst[0]!,
      newestFirst.reduce((best, row) => preferRicherFeedEvent(best, row), newestFirst[0]!),
    )
    const milestoneEvents: FeedMilestoneEvent[] = oldestFirst.map((row) => ({
      eventType: row.eventType,
      label: row.label,
      message: row.message,
      vendorName: row.vendorName,
      createdAt: row.createdAt,
      metadata: row.metadata ?? null,
    }))
    const ticketBits = inferTicketBitsFromEventGroup(
      oldestFirst,
      feedTicketBitsFromMetadata(latest.metadata),
    )
    const homeCheck = homeCheckDeclineCopy(oldestFirst)
    const { facts, copy, hide } = resolveFeedCardFromTicket(latest, ticketBits, milestoneEvents)
    if (!homeCheck && (hide || !copy?.headline)) {
      continue
    }
    const badge = homeCheck ? ('work_order' as const) : feedBadgeCategoryFromStatus(facts.status)
    const headline = homeCheck?.headline ?? copy!.headline
    if (looksLikeEmptyTemplateFeedCopy(headline)) continue

    stories.push({
      ...latest,
      id: group.length === 1 ? latest.id : `ticket-story:${ticketId}`,
      eventType: newestFirst[0]!.eventType,
      createdAt: newestFirst[0]!.createdAt,
      // Trails removed from feed cards — milestones stay in View detail only.
      storySteps: null,
      category: badge,
      building: latest.building ?? newestFirst.find((row) => row.building)?.building ?? null,
      unitLabel: latest.unitLabel ?? newestFirst.find((row) => row.unitLabel)?.unitLabel ?? null,
      propertyType:
        latest.propertyType ?? newestFirst.find((row) => row.propertyType)?.propertyType ?? null,
      issueHeadline:
        latest.issueHeadline ?? newestFirst.find((row) => row.issueHeadline)?.issueHeadline ?? null,
      vendorName: latest.vendorName ?? newestFirst.find((row) => row.vendorName)?.vendorName ?? null,
      residentName:
        latest.residentName ?? newestFirst.find((row) => row.residentName)?.residentName ?? null,
      metadata: {
        ...(latest.metadata ?? {}),
        _story_event_ids: newestFirst.map((row) => row.id),
        _feed_card_headline: headline,
        _feed_status_line: '',
        _feed_milestones: facts.milestones,
        _feed_badge_category: badge,
        _feed_facts_issue: facts.issue,
        _feed_kind: facts.kind,
        _feed_safety: facts.safety,
        _feed_open_needs_you: facts.kind === 'needs_you' && facts.status !== 'done',
        ...(homeCheck ? { _feed_card_full: homeCheck.full } : {}),
      },
    })
  }

  return [...passthrough, ...stories].sort((a, b) => {
    const aSafety =
      a.metadata?._feed_safety === true && a.metadata?._feed_open_needs_you === true ? 1 : 0
    const bSafety =
      b.metadata?._feed_safety === true && b.metadata?._feed_open_needs_you === true ? 1 : 0
    if (aSafety !== bSafety) return bSafety - aSafety
    return b.createdAt.localeCompare(a.createdAt)
  })
}

/** Collapse repetitive setup logs (e.g. onboarding registering many units). */
export function consolidateFeedEvents(
  events: PropertyOperationsTimelineEvent[],
): PropertyOperationsTimelineEvent[] {
  const passthrough: PropertyOperationsTimelineEvent[] = []
  const setupGroups = new Map<string, PropertyOperationsTimelineEvent[]>()
  const onboardingGroups = new Map<string, PropertyOperationsTimelineEvent[]>()

  // Resolve resident names from any event that carries both id + name so the
  // merged card can show the resident even when the SMS rows only have an id.
  const nameByResident = new Map<string, string>()
  for (const event of events) {
    const residentId = event.residentId?.trim()
    if (residentId && event.residentName && !nameByResident.has(residentId)) {
      nameByResident.set(residentId, event.residentName)
    }
  }

  for (const event of events) {
    const onboardingKey = tenantOnboardingGroupKey(event)
    if (onboardingKey) {
      const list = onboardingGroups.get(onboardingKey) ?? []
      list.push(event)
      onboardingGroups.set(onboardingKey, list)
      continue
    }
    const key = consolidationGroupKey(event)
    if (!key) {
      passthrough.push(event)
      continue
    }
    const list = setupGroups.get(key) ?? []
    list.push(event)
    setupGroups.set(key, list)
  }

  const consolidatedSetup = [...setupGroups.values()].map(mergeSetupEventGroup)
  const consolidatedOnboarding = [...onboardingGroups.values()].flatMap((group) =>
    // A lone event isn't a group — keep it as-is so single logs read naturally.
    group.length > 1 ? [mergeTenantOnboardingGroup(group, nameByResident)] : group,
  )

  const merged = [...passthrough, ...consolidatedSetup, ...consolidatedOnboarding].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  )
  return groupTicketFeedStories(merged)
}

function mapOperationsGraphRow(row: OperationsGraphRow): PropertyOperationsTimelineEvent {
  const metadata = row.metadata ?? {}

  return {
    id: row.id,
    eventType: row.event_type,
    label: formatEventTypeLabel(row.event_type),
    category: categorizePropertyOperationsEvent(row.event_type, row.source),
    message: readPayloadMessage(metadata),
    eventSource: row.source,
    createdAt: row.created_at,
    scheduledAt: readScheduledAt(metadata),
    unitLabel: readMetadataString(metadata, 'unit_label'),
    building: readMetadataString(metadata, 'building'),
    residentId: row.resident_id,
    residentName: readMetadataString(metadata, 'resident_name'),
    vendorName: readMetadataString(metadata, 'vendor_name'),
    maintenanceRequestId: row.maintenance_request_id?.trim() || ticketIdFromGraphPayload(metadata),
    workflowRunId: row.workflow_run_id,
    onboardingSessionId: readMetadataString(metadata, 'onboarding_session_id'),
    metadata,
  }
}

function applyScopeFilter<T extends { eq: (col: string, val: string) => T; or: (filters: string) => T }>(
  query: T,
  scope: PropertyOperationsTimelineScope,
): T {
  const unitId = 'unitId' in scope ? scope.unitId?.trim() : undefined
  const residentId = scope.residentId?.trim()

  if (unitId && residentId) {
    return query.or(`unit_id.eq.${unitId},resident_id.eq.${residentId}`)
  }
  if (unitId) {
    return query.eq('unit_id', unitId)
  }
  if (residentId) {
    return query.eq('resident_id', residentId)
  }

  return query
}

function defaultLandlordId(): string | undefined {
  return getActiveLandlordId()
}

export async function fetchPropertyOperationsTimeline(
  params: FetchPropertyOperationsTimelineParams,
): Promise<PropertyOperationsTimelineEvent[]> {
  if (!supabase) {
    throw new Error("We can't reach the server right now. Please try again in a moment.")
  }

  const unitId = 'unitId' in params.scope ? params.scope.unitId?.trim() : undefined
  const residentId = params.scope.residentId?.trim()

  if (!unitId && !residentId) {
    return []
  }

  const limit = params.limit ?? 100
  const landlordId = params.landlordId?.trim() || defaultLandlordId()

  let canonicalQuery = supabase
    .from('property_operations_graph_enriched')
    .select(
      'id, landlord_id, unit_id, resident_id, vendor_id, workflow_run_id, event_type, event_source, event_payload, created_at, unit_label, building, resident_name, vendor_name',
    )
    .order('created_at', { ascending: false })
    .limit(limit)

  if (landlordId) {
    canonicalQuery = canonicalQuery.eq('landlord_id', landlordId)
  }
  canonicalQuery = applyScopeFilter(canonicalQuery, params.scope)

  let legacyBridgeQuery = supabase
    .from('operations_graph_events_legacy_bridge')
    .select(
      'id, landlord_id, unit_id, resident_id, vendor_id, workflow_run_id, event_type, event_source, event_payload, created_at',
    )
    .order('created_at', { ascending: false })
    .limit(limit)

  if (landlordId) {
    legacyBridgeQuery = legacyBridgeQuery.eq('landlord_id', landlordId)
  }
  legacyBridgeQuery = applyScopeFilter(legacyBridgeQuery, params.scope)

  let supplementalQuery = supabase
    .from('operations_graph_events')
    .select(
      'id, landlord_id, unit_id, resident_id, vendor_id, workflow_run_id, event_type, source, metadata, maintenance_request_id, created_at',
    )
    .order('created_at', { ascending: false })
    .limit(limit)

  if (landlordId) {
    supplementalQuery = supplementalQuery.eq('landlord_id', landlordId)
  }
  supplementalQuery = applyScopeFilter(supplementalQuery, params.scope)

  const [canonicalResult, legacyResult, supplementalResult] = await Promise.all([
    canonicalQuery,
    legacyBridgeQuery,
    supplementalQuery,
  ])

  if (canonicalResult.error) {
    console.error(
      '[propertyOperationsGraph] property_operations_graph_enriched',
      canonicalResult.error.message,
    )
  }
  if (legacyResult.error) {
    console.error(
      '[propertyOperationsGraph] operations_graph_events_legacy_bridge',
      legacyResult.error.message,
    )
  }
  if (supplementalResult.error) {
    console.error(
      '[propertyOperationsGraph] operations_graph_events',
      supplementalResult.error.message,
    )
  }

  const merged = new Map<string, PropertyOperationsTimelineEvent>()

  for (const row of (canonicalResult.data ?? []) as EnrichedGraphRow[]) {
    upsertTimelineEvent(merged, mapEnrichedGraphRow(row))
  }

  for (const row of (legacyResult.data ?? []) as LegacyGraphRow[]) {
    upsertTimelineEvent(merged, mapLegacyBridgeRow(row))
  }

  for (const row of (supplementalResult.data ?? []) as OperationsGraphRow[]) {
    if (!isSupplementalOperationsRow(row)) continue
    upsertTimelineEvent(merged, mapOperationsGraphRow(row))
  }

  return [...merged.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

type MaintenanceTicketFeedRow = {
  id: string
  issue_headline: string | null
  description?: string | null
  issue_category?: string | null
  unit: string | null
  unit_id: string | null
  property_id: string | null
  awaiting_landlord_choice_at: string | null
  vendor_work_status: string | null
  spend_status: string | null
  schedule_confirmed_at: string | null
  scheduled_at: string | null
  recognized_spend_amount: number | string | null
  estimate_amount?: number | string | null
  completed_at?: string | null
  cancelled_at?: string | null
  feed_card_copy?: FeedCardCopyCache | Record<string, unknown> | null
}

type EstimateFeedRow = {
  maintenance_request_id: string
  status: string | null
  total_cost: number | string | null
  created_at: string | null
}

type PropertyFeedRow = {
  id: string
  name: string | null
  address: string | null
  property_type: string | null
}

function asOptionalString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed || null
}

function asOptionalNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value.replace(/[$,]/g, ''))
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

/** Batch-load ticket fields used by landlord feed copy, place, and waiting hints. */
export async function enrichTicketsForFeed(
  ticketIds: string[],
): Promise<Map<string, FeedTicketEnrichment>> {
  const out = new Map<string, FeedTicketEnrichment>()
  const ids = [...new Set(ticketIds.map((id) => id.trim()).filter(Boolean))]
  if (!supabase || ids.length === 0) return out

  const { data, error } = await supabase
    .from('maintenance_requests')
    .select(
      'id, issue_headline, description, issue_category, unit, unit_id, property_id, awaiting_landlord_choice_at, vendor_work_status, spend_status, schedule_confirmed_at, scheduled_at, recognized_spend_amount, estimate_amount, completed_at, cancelled_at, feed_card_copy',
    )
    .in('id', ids)

  if (error) {
    console.error('[propertyOperationsGraph] feed ticket enrich', error.message)
    return out
  }

  const rows = (data ?? []) as MaintenanceTicketFeedRow[]
  const propertyIds = [
    ...new Set(
      rows
        .map((row) => asOptionalString(row.property_id))
        .filter((id): id is string => Boolean(id)),
    ),
  ]

  const propertyById = new Map<string, PropertyFeedRow>()
  if (propertyIds.length > 0) {
    const { data: properties, error: propertyError } = await supabase
      .from('properties')
      .select('id, name, address, property_type')
      .in('id', propertyIds)
    if (propertyError) {
      console.error('[propertyOperationsGraph] feed property enrich', propertyError.message)
    } else {
      for (const row of (properties ?? []) as PropertyFeedRow[]) {
        propertyById.set(String(row.id), row)
      }
    }
  }

  // Latest estimate record per ticket — source of truth for estimate pending vs rejected.
  const estimateByTicket = new Map<
    string,
    { decision: FeedTicketEnrichment['estimateDecision']; amount: number | null }
  >()
  const { data: estimates, error: estimateError } = await supabase
    .from('maintenance_estimates')
    .select('maintenance_request_id, status, total_cost, created_at')
    .in('maintenance_request_id', ids)
    .order('created_at', { ascending: false })
  if (estimateError) {
    console.error('[propertyOperationsGraph] feed estimate enrich', estimateError.message)
  } else {
    for (const row of (estimates ?? []) as EstimateFeedRow[]) {
      const ticketId = String(row.maintenance_request_id)
      if (estimateByTicket.has(ticketId)) continue
      const status = asOptionalString(row.status)
      const decision =
        status === 'pending_approval' ||
        status === 'approved' ||
        status === 'rejected' ||
        status === 'superseded'
          ? status
          : null
      estimateByTicket.set(ticketId, {
        decision,
        amount: asOptionalNumber(row.total_cost),
      })
    }
  }

  for (const row of rows) {
    const property = row.property_id ? propertyById.get(row.property_id) : undefined
    const building =
      asOptionalString(property?.name) ||
      asOptionalString(property?.address) ||
      null
    const feedCardCopy =
      row.feed_card_copy && typeof row.feed_card_copy === 'object' && !Array.isArray(row.feed_card_copy)
        ? (row.feed_card_copy as FeedCardCopyCache)
        : null
    const estimate = estimateByTicket.get(String(row.id))
    out.set(String(row.id), {
      issueHeadline: asOptionalString(row.issue_headline),
      descriptionSummary: asOptionalString(row.description),
      trade: asOptionalString(row.issue_category),
      unitLabel: asOptionalString(row.unit),
      building,
      propertyId: asOptionalString(row.property_id),
      propertyType: asOptionalString(property?.property_type),
      awaitingLandlordChoiceAt: asOptionalString(row.awaiting_landlord_choice_at),
      vendorWorkStatus: asOptionalString(row.vendor_work_status),
      spendStatus: asOptionalString(row.spend_status),
      estimateDecision: estimate?.decision ?? null,
      scheduleConfirmedAt: asOptionalString(row.schedule_confirmed_at),
      scheduledAt: asOptionalString(row.scheduled_at),
      recognizedSpendAmount: asOptionalNumber(row.recognized_spend_amount),
      estimateAmount: estimate?.amount ?? asOptionalNumber(row.estimate_amount),
      completedAt: asOptionalString(row.completed_at),
      cancelledAt: asOptionalString(row.cancelled_at),
      feedCardCopy,
    })
  }

  return out
}

function feedTicketBitsFromMetadata(
  metadata: Record<string, unknown> | null | undefined,
): FeedTicketEnrichment | null {
  const raw = metadata?._feed_ticket
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const row = raw as Record<string, unknown>
  const feedCardCopy =
    row.feedCardCopy && typeof row.feedCardCopy === 'object' && !Array.isArray(row.feedCardCopy)
      ? (row.feedCardCopy as FeedCardCopyCache)
      : null
  const estimateDecisionRaw = asOptionalString(row.estimateDecision)
  const estimateDecision =
    estimateDecisionRaw === 'pending_approval' ||
    estimateDecisionRaw === 'approved' ||
    estimateDecisionRaw === 'rejected' ||
    estimateDecisionRaw === 'superseded'
      ? estimateDecisionRaw
      : null
  return {
    issueHeadline: asOptionalString(row.issueHeadline),
    descriptionSummary: asOptionalString(row.descriptionSummary),
    trade: asOptionalString(row.trade),
    unitLabel: asOptionalString(row.unitLabel),
    building: asOptionalString(row.building),
    propertyId: null,
    propertyType: asOptionalString(row.propertyType),
    awaitingLandlordChoiceAt: asOptionalString(row.awaitingLandlordChoiceAt),
    vendorWorkStatus: asOptionalString(row.vendorWorkStatus),
    spendStatus: asOptionalString(row.spendStatus),
    estimateDecision,
    scheduleConfirmedAt: asOptionalString(row.scheduleConfirmedAt),
    scheduledAt: asOptionalString(row.scheduledAt),
    recognizedSpendAmount: asOptionalNumber(row.recognizedSpendAmount),
    estimateAmount: asOptionalNumber(row.estimateAmount),
    completedAt: asOptionalString(row.completedAt),
    cancelledAt: asOptionalString(row.cancelledAt),
    feedCardCopy,
  }
}

/**
 * Thin “Waiting on …” subtitle from live ticket state.
 * Only when someone is clearly blocked; null otherwise.
 */
/** @deprecated Waiting line removed from feed cards — always null. */
export function feedWaitingHint(
  _event: Pick<
    PropertyOperationsTimelineEvent,
    'eventType' | 'vendorName' | 'residentName' | 'metadata'
  >,
  _ticket?: FeedTicketEnrichment | null,
): string | null {
  return null
}

/** Attach ticket enrichments onto timeline events before landlord copy runs. */
export function applyFeedTicketEnrichment(
  events: PropertyOperationsTimelineEvent[],
  tickets: Map<string, FeedTicketEnrichment>,
): PropertyOperationsTimelineEvent[] {
  if (tickets.size === 0) return events
  return events.map((event) => {
    const ticketId = event.maintenanceRequestId?.trim()
    if (!ticketId) return event
    const ticket = tickets.get(ticketId)
    if (!ticket) return event
    const next: PropertyOperationsTimelineEvent = {
      ...event,
      issueHeadline: event.issueHeadline?.trim() || ticket.issueHeadline,
      propertyType: event.propertyType?.trim() || ticket.propertyType,
      building: event.building?.trim() || ticket.building,
      unitLabel: event.unitLabel?.trim() || ticket.unitLabel,
      metadata: {
        ...(event.metadata ?? {}),
        ...(ticket.issueHeadline ? { issue_headline: ticket.issueHeadline } : {}),
        _feed_ticket: {
          issueHeadline: ticket.issueHeadline,
          descriptionSummary: ticket.descriptionSummary ?? null,
          trade: ticket.trade ?? null,
          unitLabel: ticket.unitLabel,
          building: ticket.building,
          propertyType: ticket.propertyType,
          awaitingLandlordChoiceAt: ticket.awaitingLandlordChoiceAt,
          vendorWorkStatus: ticket.vendorWorkStatus,
          spendStatus: ticket.spendStatus,
          estimateDecision: ticket.estimateDecision ?? null,
          scheduleConfirmedAt: ticket.scheduleConfirmedAt,
          scheduledAt: ticket.scheduledAt,
          recognizedSpendAmount: ticket.recognizedSpendAmount,
          estimateAmount: ticket.estimateAmount ?? null,
          completedAt: ticket.completedAt ?? null,
          cancelledAt: ticket.cancelledAt ?? null,
          feedCardCopy: ticket.feedCardCopy ?? null,
        },
      },
    }
    // Waiting hints are applied once later (newest row / story card only).
    return { ...next, waitingHint: null }
  })
}

export async function fetchRecentPropertyOperationsEvents(
  limit = 12,
): Promise<PropertyOperationsTimelineEvent[]> {
  if (!supabase) return []

  const landlordId = defaultLandlordId()
  const rawLimit = Math.max(limit * 6, 48)
  // Exclude pipeline/transport/heartbeat rows at query time so hourly cron
  // noise cannot bury landlord-facing outcomes in the raw window.
  const hiddenTypes = landlordFeedHiddenEventTypes()
  const hiddenInFilter = `(${hiddenTypes.map((t) => `"${t}"`).join(',')})`

  let canonicalQuery = supabase
    .from('property_operations_graph_enriched')
    .select(
      'id, landlord_id, unit_id, resident_id, vendor_id, workflow_run_id, event_type, event_source, event_payload, created_at, unit_label, building, resident_name, vendor_name',
    )
    .not('event_type', 'in', hiddenInFilter)
    .order('created_at', { ascending: false })
    .limit(rawLimit)

  if (landlordId) {
    canonicalQuery = canonicalQuery.eq('landlord_id', landlordId)
  }

  let supplementalQuery = supabase
    .from('operations_graph_events')
    .select(
      'id, landlord_id, unit_id, resident_id, vendor_id, workflow_run_id, event_type, source, metadata, maintenance_request_id, created_at',
    )
    .not('event_type', 'in', hiddenInFilter)
    .order('created_at', { ascending: false })
    .limit(rawLimit)

  if (landlordId) {
    supplementalQuery = supplementalQuery.eq('landlord_id', landlordId)
  }

  const [canonicalResult, supplementalResult] = await Promise.all([
    canonicalQuery,
    supplementalQuery,
  ])

  if (canonicalResult.error) {
    console.error(
      '[propertyOperationsGraph] recent events (canonical)',
      canonicalResult.error.message,
    )
  }
  if (supplementalResult.error) {
    console.error(
      '[propertyOperationsGraph] recent events (supplemental)',
      supplementalResult.error.message,
    )
  }

  const merged = new Map<string, PropertyOperationsTimelineEvent>()

  for (const row of (canonicalResult.data ?? []) as EnrichedGraphRow[]) {
    upsertTimelineEvent(merged, mapEnrichedGraphRow(row))
  }

  for (const row of (supplementalResult.data ?? []) as OperationsGraphRow[]) {
    upsertTimelineEvent(merged, mapOperationsGraphRow(row))
  }

  const sorted = [...merged.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const ticketIds = sorted
    .map((event) => event.maintenanceRequestId?.trim())
    .filter((id): id is string => Boolean(id))
  const tickets = await enrichTicketsForFeed(ticketIds)
  const enriched = applyFeedTicketEnrichment(sorted, tickets)

  const localState = landlordId ? readLocalOnboardingState(landlordId) : null
  const session =
    localState?.onboardingStatus === 'in_progress'
      ? onboardingSessionFromState(localState)
      : null

  return selectLandlordFacingFeedEvents(enriched, limit, { onboardingSession: session })
}

function contextPerson(event: PropertyOperationsTimelineEvent): string | null {
  const vendor = event.vendorName?.trim() || null
  const resident = event.residentName?.trim() || null
  const type = event.eventType
  // Job cards keep place = property (+ unit). Vendor/resident names belong in the
  // headline or Waiting line — not bolted onto the grey context row.
  if (event.category === 'work_order' || event.category === 'scheduling') {
    return resident
  }
  const aboutVendor =
    event.category === 'vendor' ||
    event.category === 'spend' ||
    type.startsWith('vendor.') ||
    type.includes('spend') ||
    type.includes('invoice') ||
    type.includes('estimate')
  if (aboutVendor) return vendor ?? resident
  return resident ?? vendor
}

/** Grey context place: "Property, Unit X" when both exist; SFH / Home sentinel omits unit. */
export function formatTimelinePlace(
  event: Pick<PropertyOperationsTimelineEvent, 'building' | 'unitLabel' | 'propertyType'>,
): string | null {
  const building = (event.building ?? '').trim() || null
  const unitRaw = (event.unitLabel ?? '').trim() || null
  const omitUnit = shouldOmitUnitReference({
    unitLabel: unitRaw,
    propertyType: event.propertyType,
  })
  // Never show a bare unit number without a property.
  if (!building) return null
  if (omitUnit) return building
  const unitRef = formatUnitReference(unitRaw, event.propertyType)
  if (!unitRef) return building
  if (building.toLowerCase().includes(unitRef.toLowerCase())) return building
  return `${building} · ${unitRef}`
}

export function formatTimelineContextLine(
  event: PropertyOperationsTimelineEvent,
): string | null {
  // Job-related rows: always show property · unit on the second line.
  if (event.maintenanceRequestId || event.metadata?._feed_facts_issue) {
    return formatTimelinePlace(event)
  }
  const place = formatTimelinePlace(event)
  const label = (event.fullLabel ?? event.label ?? '').toLowerCase()
  const placeAlreadyInLabel =
    Boolean(place) &&
    (label.includes(place!.toLowerCase()) ||
      Boolean(event.building?.trim() && label.includes(event.building.trim().toLowerCase())))
  return placeAlreadyInLabel ? null : place
}

export type TimelineResidentOption = {
  id: string
  full_name: string
  unit: string | null
  building: string | null
}

export async function loadResidentsForTimelinePicker(): Promise<TimelineResidentOption[]> {
  if (!supabase) return []

  const landlordId = defaultLandlordId()
  let query = supabase
    .from('users')
    .select('id, full_name, unit, building')
    .order('full_name', { ascending: true })
    .limit(200)

  if (landlordId) {
    query = query.eq('landlord_id', landlordId)
  }

  const { data, error } = await query

  if (error) {
    console.error('[propertyOperationsGraph] residents picker', error.message)
    return []
  }

  return (data ?? []).map((row) => ({
    id: String(row.id),
    full_name: String(row.full_name ?? 'Resident'),
    unit: row.unit == null ? null : String(row.unit),
    building: row.building == null ? null : String(row.building),
  }))
}
