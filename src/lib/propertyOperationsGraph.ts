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
  isVisibleLandlordTimelineDescription,
  landlordFeedHiddenEventTypes,
} from '@/lib/landlordFacingTimeline'
import { fallbackFeedLine, landlordFeedLine, type FeedLine } from '@/lib/landlordFeedCopy'
import { readLocalOnboardingState } from '@/lib/onboarding/draftStorage'
import {
  isEventInOnboardingSession,
  onboardingSessionFromState,
} from '@/lib/onboarding/session'
import { supabase } from '@/lib/supabase'

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
  /** Setup-run stamp from metadata when present (isolates Overview during onboarding). */
  onboardingSessionId?: string | null
  /** Source payload kept for landlord copy. Not rendered on its own. */
  metadata?: Record<string, unknown> | null
  /** Full line before a window cut, for title and aria-label. */
  fullLabel?: string | null
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

  const systemSource = source === 'automation' || source === 'edge_function' || source === 'system'
  const landlordAction =
    !systemSource &&
    (source === 'dashboard' ||
      domain === 'broadcast' ||
      domain === 'landlord' ||
      domain === 'unit' ||
      domain === 'attention' ||
      domain === 'lease')
  if (landlordAction) return 'admin'
  if (domain === 'broadcast' || domain === 'landlord' || domain === 'attention') return 'admin'
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
    maintenanceRequestId:
      typeof payload.maintenance_request_id === 'string'
        ? payload.maintenance_request_id
        : null,
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
    maintenanceRequestId:
      typeof payload.maintenance_request_id === 'string'
        ? payload.maintenance_request_id
        : null,
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
    return count === 1 ? 'Unit registered' : `${count} units registered`
  }
  if (eventType === 'tenant.sms_registered') {
    return count === 1 ? 'Resident SMS linked' : `${count} residents linked for SMS`
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
      message = `${count} residents linked for SMS${building ? ` at ${building}` : ''}.`
    } else {
      message = `${count} units linked to Ulo SMS${building ? ` at ${building}` : ''}.`
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

  const label = 'Tenant onboarding verification'

  const steps: string[] = []
  if (sent) steps.push('welcome text sent')
  if (delivered) steps.push('delivered')
  if (replied) steps.push('resident replied')
  if (optedIn) steps.push('opted in to SMS updates')
  if (types.has('tenant.activation_completed')) steps.push('activated')
  if (optedOut) steps.push('opted out')
  if (failed) steps.push('a delivery attempt failed')

  const who = residentName ?? 'Resident'
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
  return event.id.startsWith('tenant-onboarding:') || event.id.startsWith('consolidated:')
}

/**
 * Overview (and other landlord feeds) should show what happened — a work order
 * opened, a vendor accepted, a welcome text sent — not engine/SMS plumbing.
 */
export function isLandlordFacingFeedEvent(event: PropertyOperationsTimelineEvent): boolean {
  if (isMergedLandlordFacingFeedCard(event)) return true
  if (isHiddenPipelineTimelineEventType(event.eventType)) return false
  if (isHiddenSmsTransportTimelineEventType(event.eventType)) return false
  if (isHiddenActivationAlertTimelineEventType(event.eventType)) return false
  if (isHiddenOpsHeartbeatTimelineEventType(event.eventType)) return false
  if (isHiddenInternalNoteTimelineEventType(event.eventType)) return false
  if (
    !isVisibleLandlordTimelineDescription(event.label) &&
    (!event.message || !isVisibleLandlordTimelineDescription(event.message))
  ) {
    return false
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
  if (event.maintenanceRequestId) score += 1
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

export function isDuplicateFeedEvent(
  a: PropertyOperationsTimelineEvent,
  b: PropertyOperationsTimelineEvent,
): boolean {
  if (a.id && a.id === b.id) return true
  if (a.eventType !== b.eventType) return false
  if (a.workflowRunId && b.workflowRunId && a.workflowRunId !== b.workflowRunId) return false
  const ticketA = a.maintenanceRequestId ?? ''
  const ticketB = b.maintenanceRequestId ?? ''
  if (ticketA && ticketB && ticketA !== ticketB) return false
  if (!withinWindow(a.createdAt, b.createdAt, DEDUPE_WINDOW_MS)) return false
  const messageA = normalizeFeedMessage(a.message)
  const messageB = normalizeFeedMessage(b.message)
  if (messageA && messageB && messageA !== messageB && !messageA.startsWith(messageB) && !messageB.startsWith(messageA)) {
    return false
  }
  return true
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

function landlordFacingEventLabel(event: PropertyOperationsTimelineEvent): FeedLine {
  const specific = landlordFeedLine(event)
  if (specific) return specific
  if (hasMappedEventTypeLabel(event.eventType) || isMergedLandlordFacingFeedCard(event)) {
    return { line: event.label, full: event.label }
  }
  const message = event.message?.trim()
  if (
    message &&
    message.length >= 12 &&
    /[A-Za-z]/.test(message) &&
    looksLikeRawEventTypeLabel(event.eventType, event.label) &&
    isVisibleLandlordTimelineDescription(message)
  ) {
    return fallbackFeedLine(message, event.building)
  }
  return fallbackFeedLine(event.label, event.building)
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
  const message =
    event.message && isVisibleLandlordTimelineDescription(event.message) && copy.line === event.label
      ? event.message
      : null
  const metadata = { ...(event.metadata ?? {}) }
  delete metadata.reason
  delete metadata._paired_reason
  return {
    ...event,
    label: copy.line,
    fullLabel: copy.full,
    message,
    metadata,
    category: isMergedLandlordFacingFeedCard(event)
      ? event.category
      : categorizePropertyOperationsEvent(event.eventType, event.eventSource),
  }
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

  return consolidateFeedEvents(mergePairedFeedStories(dedupePropertyOperationsEvents(scoped)))
    .filter(isLandlordFacingFeedEvent)
    .map(applyLandlordFacingCopy)
    .slice(0, Math.max(limit, 0))
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

  return [...passthrough, ...consolidatedSetup, ...consolidatedOnboarding].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  )
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
    maintenanceRequestId: row.maintenance_request_id,
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

  const localState = landlordId ? readLocalOnboardingState(landlordId) : null
  const session =
    localState?.onboardingStatus === 'in_progress'
      ? onboardingSessionFromState(localState)
      : null

  return selectLandlordFacingFeedEvents(
    [...merged.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    limit,
    { onboardingSession: session },
  )
}

function contextPerson(event: PropertyOperationsTimelineEvent): string | null {
  const vendor = event.vendorName?.trim() || null
  const resident = event.residentName?.trim() || null
  const type = event.eventType
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

export function formatTimelineContextLine(
  event: PropertyOperationsTimelineEvent,
): string | null {
  const place = (event.building || event.unitLabel || '').trim() || null
  const person = contextPerson(event)
  if (place && person) return `${place} · ${person}`
  return place ?? person
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
