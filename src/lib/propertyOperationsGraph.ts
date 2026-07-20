import { getActiveLandlordId } from '@/lib/activeLandlord'
import { formatEventTypeLabel, formatWorkflowTimestamp } from '@/lib/adminWorkflows'
import { supabase } from '@/lib/supabase'

export type PropertyOperationsTimelineCategory =
  | 'maintenance'
  | 'rent'
  | 'move_in'
  | 'move_out'
  | 'inspection'
  | 'vendor'
  | 'admin'

export type PropertyOperationsTimelineEvent = {
  id: string
  eventType: string
  label: string
  category: PropertyOperationsTimelineCategory
  message: string | null
  eventSource: string
  createdAt: string
  unitLabel: string | null
  building: string | null
  residentId?: string | null
  residentName: string | null
  vendorName: string | null
  maintenanceRequestId: string | null
  workflowRunId: string | null
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
  'maintenance',
  'rent',
  'move_in',
  'move_out',
  'inspection',
  'vendor',
  'admin',
]

export const TIMELINE_CATEGORY_LABELS: Record<PropertyOperationsTimelineCategory, string> = {
  maintenance: 'Maintenance',
  rent: 'Rent',
  move_in: 'Move in',
  move_out: 'Move out',
  inspection: 'Inspection',
  vendor: 'Vendor',
  admin: 'Admin',
}

const ADMIN_EVENT_PREFIXES = [
  'broadcast.',
  'lease.',
  'landlord.',
  'unit.',
  'tenant.',
  'sms.',
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
  const domain = eventType.split('.')[0]

  if (domain === 'maintenance') return 'maintenance'
  if (domain === 'rent') return 'rent'
  if (domain === 'move_in') return 'move_in'
  if (domain === 'move_out') return 'move_out'
  if (domain === 'inspection') return 'inspection'
  if (domain === 'vendor') return 'vendor'
  if (eventSource === 'dashboard') return 'admin'
  if (ADMIN_EVENT_PREFIXES.some((prefix) => eventType.startsWith(prefix))) return 'admin'
  if (domain === 'workflow') return 'admin'

  return 'admin'
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
    unitLabel: row.unit_label,
    building: row.building,
    residentId: row.resident_id,
    residentName: row.resident_name,
    vendorName: row.vendor_name,
    maintenanceRequestId:
      typeof payload.maintenance_request_id === 'string'
        ? payload.maintenance_request_id
        : null,
    workflowRunId: row.workflow_run_id,
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
    unitLabel: null,
    building: null,
    residentId: row.resident_id,
    residentName: null,
    vendorName: null,
    maintenanceRequestId:
      typeof payload.maintenance_request_id === 'string'
        ? payload.maintenance_request_id
        : null,
    workflowRunId: row.workflow_run_id,
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
  if (optedOut) steps.push('opted out')
  if (failed) steps.push('a delivery attempt failed')

  const who = residentName ?? 'Resident'
  const message = steps.length ? `${who}: ${steps.join(' → ')}.` : latest.message

  return {
    ...latest,
    id: `tenant-onboarding:${residentId}:${day}`,
    category: 'admin',
    label,
    message,
    residentName,
    building,
    unitLabel,
    workflowRunId,
  }
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
    unitLabel: readMetadataString(metadata, 'unit_label'),
    building: readMetadataString(metadata, 'building'),
    residentId: row.resident_id,
    residentName: readMetadataString(metadata, 'resident_name'),
    vendorName: null,
    maintenanceRequestId: row.maintenance_request_id,
    workflowRunId: row.workflow_run_id,
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
    throw new Error('Supabase is not configured.')
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
    const event = mapEnrichedGraphRow(row)
    merged.set(eventDedupeKey(event), event)
  }

  for (const row of (legacyResult.data ?? []) as LegacyGraphRow[]) {
    const event = mapLegacyBridgeRow(row)
    const key = eventDedupeKey(event)
    if (!merged.has(key)) {
      merged.set(key, event)
    }
  }

  for (const row of (supplementalResult.data ?? []) as OperationsGraphRow[]) {
    const domain = row.event_type.split('.')[0]
    const isSupplemental =
      domain === 'vendor' ||
      row.source === 'dashboard' ||
      ADMIN_EVENT_PREFIXES.some((prefix) => row.event_type.startsWith(prefix))

    if (!isSupplemental) continue

    const event = mapOperationsGraphRow(row)
    const key = eventDedupeKey(event)
    if (!merged.has(key)) {
      merged.set(key, event)
    }
  }

  return [...merged.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export async function fetchRecentPropertyOperationsEvents(
  limit = 12,
): Promise<PropertyOperationsTimelineEvent[]> {
  if (!supabase) return []

  const landlordId = defaultLandlordId()
  const rawLimit = Math.max(limit * 6, 48)

  let canonicalQuery = supabase
    .from('property_operations_graph_enriched')
    .select(
      'id, landlord_id, unit_id, resident_id, vendor_id, workflow_run_id, event_type, event_source, event_payload, created_at, unit_label, building, resident_name, vendor_name',
    )
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
    const event = mapEnrichedGraphRow(row)
    merged.set(eventDedupeKey(event), event)
  }

  for (const row of (supplementalResult.data ?? []) as OperationsGraphRow[]) {
    const event = mapOperationsGraphRow(row)
    const key = eventDedupeKey(event)
    if (!merged.has(key)) {
      merged.set(key, event)
    }
  }

  return consolidateFeedEvents([...merged.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt))).slice(
    0,
    limit,
  )
}

export function formatTimelineContextLine(
  event: PropertyOperationsTimelineEvent,
): string | null {
  const locationParts = [event.unitLabel, event.building].filter(Boolean)
  const location = locationParts.length ? locationParts.join(' · ') : null
  const people = [event.residentName, event.vendorName].filter(Boolean)

  if (location && people.length) {
    return `${location} · ${people.join(' · ')}`
  }
  return location ?? (people.length ? people.join(' · ') : null)
}

/**
 * Temporary overview feed samples so every category badge is visible for UI review.
 * Does not change event taxonomy — showcase rows only.
 */
export function buildOverviewFeedBadgeShowcase(
  nowMs: number = Date.now(),
): PropertyOperationsTimelineEvent[] {
  const minutesAgo = (minutes: number) =>
    new Date(nowMs - minutes * 60_000).toISOString()

  return [
    {
      id: 'showcase-maintenance-sla-reassign',
      eventType: 'maintenance.sla_auto_reassigned',
      label: "Vendor didn't respond in time. The job was reassigned.",
      category: 'maintenance',
      message: null,
      eventSource: 'showcase',
      createdAt: minutesAgo(12),
      unitLabel: 'Unit 207',
      building: 'Maple Heights',
      residentName: 'Jordan Lee',
      vendorName: 'Summit HVAC',
      maintenanceRequestId: null,
      workflowRunId: null,
    },
    {
      id: 'showcase-vendor-external-assign',
      eventType: 'vendor.external_assigned',
      label: 'External vendor assigned',
      category: 'vendor',
      message: null,
      eventSource: 'showcase',
      createdAt: minutesAgo(28),
      unitLabel: 'Unit 12B',
      building: 'Cedar Court',
      residentName: null,
      vendorName: 'All-City Plumbing',
      maintenanceRequestId: null,
      workflowRunId: null,
    },
    {
      id: 'showcase-rent-reminder',
      eventType: 'rent.reminder_sent',
      label: 'Rent reminder sent',
      category: 'rent',
      message: null,
      eventSource: 'showcase',
      createdAt: minutesAgo(45),
      unitLabel: 'Unit 4A',
      building: 'River Park',
      residentName: 'Sam Ortiz',
      vendorName: null,
      maintenanceRequestId: null,
      workflowRunId: null,
    },
    {
      id: 'showcase-move-in-checklist',
      eventType: 'move_in.checklist_sent',
      label: 'Checklist sent',
      category: 'move_in',
      message: null,
      eventSource: 'showcase',
      createdAt: minutesAgo(70),
      unitLabel: 'Unit 301',
      building: 'Oak Street',
      residentName: 'Avery Chen',
      vendorName: null,
      maintenanceRequestId: null,
      workflowRunId: null,
    },
    {
      id: 'showcase-move-out-started',
      eventType: 'move_out.started',
      label: 'Move-out started',
      category: 'move_out',
      message: null,
      eventSource: 'showcase',
      createdAt: minutesAgo(95),
      unitLabel: 'Unit 8C',
      building: 'Maple Heights',
      residentName: 'Taylor Brooks',
      vendorName: null,
      maintenanceRequestId: null,
      workflowRunId: null,
    },
    {
      id: 'showcase-inspection-scheduled',
      eventType: 'inspection.scheduled',
      label: 'Inspection scheduled',
      category: 'inspection',
      message: null,
      eventSource: 'showcase',
      createdAt: minutesAgo(130),
      unitLabel: 'Unit 15',
      building: 'Cedar Court',
      residentName: null,
      vendorName: null,
      maintenanceRequestId: null,
      workflowRunId: null,
    },
    {
      id: 'showcase-admin-unit-registered',
      eventType: 'unit.registered',
      label: 'Unit registered',
      category: 'admin',
      message: null,
      eventSource: 'showcase',
      createdAt: minutesAgo(180),
      unitLabel: 'Unit 22',
      building: 'River Park',
      residentName: null,
      vendorName: null,
      maintenanceRequestId: null,
      workflowRunId: null,
    },
  ]
}

/**
 * Attach real workflow run IDs to showcase feed rows (by category) so the info
 * icon can open a matching workflow card for admin verification.
 */
export function linkShowcaseFeedEventsToWorkflowRuns(
  events: PropertyOperationsTimelineEvent[],
  runIdsByCategory: Partial<Record<PropertyOperationsTimelineCategory, string[]>>,
): PropertyOperationsTimelineEvent[] {
  const queues: Partial<Record<PropertyOperationsTimelineCategory, string[]>> = {}
  for (const category of PROPERTY_OPERATIONS_TIMELINE_CATEGORIES) {
    const ids = runIdsByCategory[category]
    if (ids?.length) queues[category] = [...ids]
  }
  const used = new Set<string>()

  const takeNext = (category: PropertyOperationsTimelineCategory): string | null => {
    const categoryQueue = queues[category]
    while (categoryQueue?.length) {
      const nextId = categoryQueue.shift()!
      if (used.has(nextId)) continue
      used.add(nextId)
      return nextId
    }
    for (const fallbackCategory of PROPERTY_OPERATIONS_TIMELINE_CATEGORIES) {
      if (fallbackCategory === category) continue
      const fallbackQueue = queues[fallbackCategory]
      while (fallbackQueue?.length) {
        const nextId = fallbackQueue.shift()!
        if (used.has(nextId)) continue
        used.add(nextId)
        return nextId
      }
    }
    return null
  }

  return events.map((event) => {
    if (event.workflowRunId || event.eventSource !== 'showcase') return event
    // Unit registration opens the property card, not a workflow run.
    if (event.eventType === 'unit.registered') return event
    const nextId = takeNext(event.category)
    if (!nextId) return event
    return { ...event, workflowRunId: nextId }
  })
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
