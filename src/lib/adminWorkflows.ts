import { getActiveLandlordId } from '@/lib/activeLandlord'
import { supabase } from '@/lib/supabase'

export type WorkflowRunStatus = 'active' | 'completed' | 'escalated' | 'cancelled'

export type RentCollectionClassification =
  | 'rent_due_today'
  | 'rent_overdue'
  | 'partial_payment'
  | 'paid'
  | 'payment_plan_needed'

export type AdminWorkflowTimelineEvent = {
  id: string
  eventType: string
  label: string
  message: string | null
  step: string | null
  stage: string | null
  createdAt: string
}

export type AdminWorkflowRow = {
  id: string
  templateId: string
  templateName: string
  templateType: string
  status: WorkflowRunStatus
  currentStep: string | null
  entityType: string | null
  entityId: string | null
  residentId: string | null
  residentName: string | null
  unitLabel: string | null
  propertyLabel: string | null
  startedAt: string
  completedAt: string | null
  lastEventType: string | null
  lastEventMessage: string | null
  lastEventAt: string | null
}

export type AdminRentCollectionRow = AdminWorkflowRow & {
  amountDue: number | null
  billingPeriod: string | null
  rentDueDate: string | null
  rentClassification: RentCollectionClassification | null
  isDueToday: boolean
  isOverdue: boolean
  reminderSent: boolean
  reminderSmsSent: boolean
  reminderEmailSent: boolean
  paymentStatus: string
  paymentIntent: string | null
  timeline: AdminWorkflowTimelineEvent[]
}

export type AdminRentCollectionStats = {
  dueTodayCount: number
  overdueCount: number
  reminderSentCount: number
  escalatedCount: number
}

export type AdminRentCollectionDashboard = {
  runs: AdminRentCollectionRow[]
  dueToday: AdminRentCollectionRow[]
  overdue: AdminRentCollectionRow[]
  reminderSent: AdminRentCollectionRow[]
  escalatedResidents: AdminRentCollectionRow[]
  stats: AdminRentCollectionStats
}

export type LifecycleWorkflowTemplateId = 'move_in' | 'move_out' | 'inspection'

export type AdminLifecycleRow = AdminWorkflowRow & {
  lifecycleClassification: string | null
  moveInDate: string | null
  moveOutDate: string | null
  scheduledAt: string | null
  inspectionType: string | null
  timeline: AdminWorkflowTimelineEvent[]
}

export type AdminLifecycleStats = {
  moveInCount: number
  moveOutCount: number
  inspectionCount: number
  activeCount: number
}

export type AdminLifecycleDashboard = {
  runs: AdminLifecycleRow[]
  moveIn: AdminLifecycleRow[]
  moveOut: AdminLifecycleRow[]
  inspections: AdminLifecycleRow[]
  stats: AdminLifecycleStats
}

export type AdminWorkflowDashboardData = {
  active: AdminWorkflowRow[]
  escalated: AdminWorkflowRow[]
  maintenanceRuns: AdminWorkflowRow[]
  rentCollection: AdminRentCollectionDashboard
  lifecycle: AdminLifecycleDashboard
  groups: AdminWorkflowGroupCard[]
  stats: {
    activeCount: number
    escalatedCount: number
    completedCount: number
  }
}

export type WorkflowTemplateGroupId =
  | 'maintenance'
  | 'rent_collection'
  | 'move_in'
  | 'move_out'
  | 'inspection'

export type AdminWorkflowGroupLatestEvent = {
  label: string
  at: string | null
  runId: string | null
}

export type AdminWorkflowGroupContext = {
  propertyLabel: string | null
  unitLabel: string | null
  residentName: string | null
}

export type AdminWorkflowGroupCard = {
  id: WorkflowTemplateGroupId
  title: string
  activeCount: number
  overdueCount: number
  completedCount: number
  latestEvent: AdminWorkflowGroupLatestEvent
  context: AdminWorkflowGroupContext | null
  runCount: number
}

export const WORKFLOW_TEMPLATE_GROUP_ORDER: WorkflowTemplateGroupId[] = [
  'maintenance',
  'rent_collection',
  'move_in',
  'move_out',
  'inspection',
]

export const WORKFLOW_GROUP_TITLES: Record<WorkflowTemplateGroupId, string> = {
  maintenance: 'Maintenance',
  rent_collection: 'Rent Collection',
  move_in: 'Move Ins',
  move_out: 'Move Outs',
  inspection: 'Inspections',
}

const MAINTENANCE_TEMPLATE_IDS = new Set(['maintenance_request', 'maintenance_intake'])

export function workflowTemplateGroupId(templateId: string): WorkflowTemplateGroupId | null {
  if (MAINTENANCE_TEMPLATE_IDS.has(templateId)) return 'maintenance'
  if (templateId === 'rent_collection') return 'rent_collection'
  if (templateId === 'move_in') return 'move_in'
  if (templateId === 'move_out') return 'move_out'
  if (templateId === 'inspection' || templateId === 'unit_inspection') return 'inspection'
  return null
}

export function formatLocationContext(row: AdminWorkflowRow): AdminWorkflowGroupContext {
  return {
    propertyLabel: row.propertyLabel,
    unitLabel: row.unitLabel,
    residentName: row.residentName,
  }
}

export function formatLocationContextLabel(context: AdminWorkflowGroupContext | null): string {
  if (!context) return '—'
  const parts = [context.propertyLabel, context.unitLabel].filter(Boolean)
  const location = parts.length ? parts.join(' · ') : null
  if (location && context.residentName) {
    return `${location} · ${context.residentName}`
  }
  return location ?? context.residentName ?? '—'
}

export const LIFECYCLE_TEMPLATE_IDS: LifecycleWorkflowTemplateId[] = [
  'move_in',
  'move_out',
  'inspection',
]

export function isLifecycleTemplateId(
  templateId: string,
): templateId is LifecycleWorkflowTemplateId {
  return (LIFECYCLE_TEMPLATE_IDS as readonly string[]).includes(templateId)
}

type WorkflowRunRecord = {
  id: string
  template_id: string
  status: string
  entity_type: string | null
  entity_id: string | null
  property_id: string | null
  unit_id: string | null
  resident_id: string | null
  current_step: string | null
  started_at: string
  completed_at: string | null
  metadata: Record<string, unknown> | null
  workflow_templates?:
    | { id: string; name: string; type: string }
    | { id: string; name: string; type: string }[]
    | null
}

type WorkflowEventRecord = {
  id: string
  workflow_run_id: string
  event_type: string
  message: string | null
  step: string | null
  stage: string | null
  created_at: string
}

type ResidentRecord = {
  id: string
  full_name: string | null
  unit: string | null
  building: string | null
}

type UnitRecord = {
  id: string
  unit_label: string | null
  building: string | null
}

const TEMPLATE_LABELS: Record<string, string> = {
  maintenance_intake: 'Maintenance intake',
  maintenance_request: 'Maintenance request',
  lease_renewal: 'Lease renewal',
  rent_collection: 'Rent collection',
  move_in: 'Move in',
  move_out: 'Move out',
  inspection: 'Inspection',
  unit_inspection: 'Inspection',
  vendor_job_response: 'Vendor job response',
  identity_onboarding: 'Identity onboarding',
  landlord_command: 'Landlord command',
}

function readMetaString(
  metadata: Record<string, unknown> | null | undefined,
  key: string,
): string | null {
  const value = metadata?.[key]
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed || null
}

function embedOne<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null
  return Array.isArray(value) ? (value[0] ?? null) : value
}

function formatTemplateName(templateId: string, embeddedName?: string | null): string {
  if (embeddedName?.trim()) return embeddedName.trim()
  return TEMPLATE_LABELS[templateId] ?? templateId.replace(/_/g, ' ')
}

function formatStepLabel(step: string | null): string {
  if (!step?.trim()) return '—'
  return step
    .trim()
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

const EVENT_LABELS: Record<string, string> = {
  'rent.due_detected': 'Rent due detected',
  'rent.reminder_sent': 'Rent reminder sent',
  'rent.payment_requested': 'Payment requested',
  'rent.payment_received': 'Payment received',
  'rent.late_escalated': 'Late payment escalated',
  'rent.ledger_updated': 'Ledger updated',
  'move_in.started': 'Move-in started',
  'move_in.checklist_sent': 'Checklist sent',
  'move_in.unit_activated': 'Unit activated',
  'move_out.started': 'Move-out started',
  'move_out.unit_vacated': 'Unit vacated',
  'inspection.started': 'Inspection started',
  'inspection.notice_sent': 'Notice sent',
  'inspection.scheduled': 'Inspection scheduled',
  'payment_requested': 'Payment requested',
  'payment_link_included': 'Payment link included',
  'workflow.trigger': 'Workflow started',
  'workflow.classify': 'Classified',
  'workflow.route': 'Routed',
  'workflow.act': 'Action taken',
  'workflow.escalate': 'Escalated',
  'workflow.log': 'Logged',
  'unit.registered': 'Unit registered',
  'tenant.sms_registered': 'Resident SMS linked',
}

const RENT_CLASSIFICATION_LABELS: Record<RentCollectionClassification, string> = {
  rent_due_today: 'Due today',
  rent_overdue: 'Overdue',
  partial_payment: 'Partial payment',
  paid: 'Paid',
  payment_plan_needed: 'Plan needed',
}

const RENT_GRAPH_EVENT_TYPES = new Set([
  'rent.due_detected',
  'rent.reminder_sent',
  'rent.payment_requested',
  'rent.payment_received',
  'rent.late_escalated',
  'rent.ledger_updated',
])

const LIFECYCLE_GRAPH_EVENT_TYPES = new Set([
  'move_in.started',
  'move_in.checklist_sent',
  'move_in.unit_activated',
  'move_out.started',
  'move_out.unit_vacated',
  'inspection.started',
  'inspection.notice_sent',
  'inspection.scheduled',
])

function readMetaNumber(
  metadata: Record<string, unknown> | null | undefined,
  key: string,
): number | null {
  const value = metadata?.[key]
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number.parseFloat(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

function readMetaBoolean(
  metadata: Record<string, unknown> | null | undefined,
  key: string,
): boolean {
  const value = metadata?.[key]
  return value === true || value === 'true'
}

function readStepState(
  metadata: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  const step = metadata?.step_state
  if (step && typeof step === 'object' && !Array.isArray(step)) {
    return step as Record<string, unknown>
  }
  return {}
}

function parseRentClassification(
  metadata: Record<string, unknown>,
): RentCollectionClassification | null {
  const value = metadata.rent_classification ?? readStepState(metadata).rent_classification
  if (
    value === 'rent_due_today' ||
    value === 'rent_overdue' ||
    value === 'partial_payment' ||
    value === 'paid' ||
    value === 'payment_plan_needed'
  ) {
    return value
  }
  return null
}

function parsePaymentIntent(metadata: Record<string, unknown>): string | null {
  const value = metadata.payment_intent ?? readStepState(metadata).payment_intent
  if (typeof value === 'string' && value.trim()) return value.trim()
  return null
}

function derivePaymentStatus(
  metadata: Record<string, unknown>,
  classification: RentCollectionClassification | null,
): string {
  const intent = parsePaymentIntent(metadata)
  if (intent === 'paid' || classification === 'paid') return 'Paid'
  if (intent === 'partial' || classification === 'partial_payment') return 'Partial'
  if (intent === 'questions' || classification === 'payment_plan_needed') {
    return 'Plan needed'
  }
  if (readMetaBoolean(metadata, 'payment_requested')) return 'Awaiting payment'
  if (classification === 'rent_overdue') return 'Overdue — unpaid'
  if (classification === 'rent_due_today') return 'Due today — unpaid'
  return 'Unpaid'
}

function deriveReminderSent(metadata: Record<string, unknown>): {
  sent: boolean
  smsSent: boolean
  emailSent: boolean
} {
  const step = readStepState(metadata)
  const smsSent =
    readMetaBoolean(metadata, 'sms_sent') ||
    step.sms_sent === true
  const emailSent =
    readMetaBoolean(metadata, 'email_sent') ||
    step.email_sent === true
  return {
    sent: smsSent || emailSent,
    smsSent,
    emailSent,
  }
}

export function formatEventTypeLabel(eventType: string): string {
  return EVENT_LABELS[eventType] ?? eventType.replace(/[._]/g, ' ')
}

export function formatRentClassificationLabel(
  classification: RentCollectionClassification | null,
): string {
  if (!classification) return '—'
  return RENT_CLASSIFICATION_LABELS[classification]
}

export function formatCurrency(amount: number | null | undefined): string {
  if (amount == null || !Number.isFinite(amount)) return '—'
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  }).format(amount)
}

export function formatRentDueDate(iso: string | null | undefined): string {
  if (!iso?.trim()) return '—'
  const date = new Date(`${iso.trim().slice(0, 10)}T12:00:00`)
  if (Number.isNaN(date.getTime())) return iso
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date)
}

function buildTimelineEvent(event: WorkflowEventRecord): AdminWorkflowTimelineEvent {
  return {
    id: event.id,
    eventType: event.event_type,
    label: formatEventTypeLabel(event.event_type),
    message: event.message,
    step: event.step,
    stage: event.stage,
    createdAt: event.created_at,
  }
}

function buildRentCollectionRow(
  row: AdminWorkflowRow,
  metadata: Record<string, unknown>,
  timeline: AdminWorkflowTimelineEvent[],
): AdminRentCollectionRow {
  const classification = parseRentClassification(metadata)
  const reminder = deriveReminderSent(metadata)
  const reminderFromEvents = timeline.some(
    (event) => event.eventType === 'rent.reminder_sent',
  )

  return {
    ...row,
    amountDue: readMetaNumber(metadata, 'amount_due'),
    billingPeriod: readMetaString(metadata, 'billing_period'),
    rentDueDate: readMetaString(metadata, 'rent_due_date'),
    rentClassification: classification,
    isDueToday: classification === 'rent_due_today',
    isOverdue: classification === 'rent_overdue' || row.status === 'escalated',
    reminderSent: reminder.sent || reminderFromEvents,
    reminderSmsSent: reminder.smsSent,
    reminderEmailSent: reminder.emailSent,
    paymentStatus: derivePaymentStatus(metadata, classification),
    paymentIntent: parsePaymentIntent(metadata),
    timeline: timeline.filter(
      (event) =>
        RENT_GRAPH_EVENT_TYPES.has(event.eventType) ||
        event.eventType.startsWith('workflow.') ||
        event.eventType.startsWith('rent.') ||
        event.eventType === 'payment_requested' ||
        event.eventType === 'payment_link_included',
    ),
  }
}

function emptyRentCollectionDashboard(): AdminRentCollectionDashboard {
  return {
    runs: [],
    dueToday: [],
    overdue: [],
    reminderSent: [],
    escalatedResidents: [],
    stats: {
      dueTodayCount: 0,
      overdueCount: 0,
      reminderSentCount: 0,
      escalatedCount: 0,
    },
  }
}

function parseLifecycleClassification(
  metadata: Record<string, unknown>,
  templateId: string,
): string | null {
  const keys = [
    'move_in_classification',
    'move_out_classification',
    'inspection_classification',
  ]
  for (const key of keys) {
    const value = metadata[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  if (templateId === 'inspection') {
    const type = metadata.inspection_type
    if (typeof type === 'string' && type.trim()) return type.trim()
  }
  return null
}

function buildLifecycleRow(
  row: AdminWorkflowRow,
  metadata: Record<string, unknown>,
  timeline: AdminWorkflowTimelineEvent[],
): AdminLifecycleRow {
  const domainPrefix = row.templateId.replace(/_/g, '_')

  return {
    ...row,
    lifecycleClassification: parseLifecycleClassification(metadata, row.templateId),
    moveInDate: readMetaString(metadata, 'move_in_date'),
    moveOutDate: readMetaString(metadata, 'move_out_date'),
    scheduledAt: readMetaString(metadata, 'scheduled_at'),
    inspectionType: readMetaString(metadata, 'inspection_type'),
    timeline: timeline.filter(
      (event) =>
        LIFECYCLE_GRAPH_EVENT_TYPES.has(event.eventType) ||
        event.eventType.startsWith('workflow.') ||
        event.eventType.startsWith(`${domainPrefix}.`) ||
        event.eventType.startsWith('move_in.') ||
        event.eventType.startsWith('move_out.') ||
        event.eventType.startsWith('inspection.'),
    ),
  }
}

function emptyLifecycleDashboard(): AdminLifecycleDashboard {
  return {
    runs: [],
    moveIn: [],
    moveOut: [],
    inspections: [],
    stats: {
      moveInCount: 0,
      moveOutCount: 0,
      inspectionCount: 0,
      activeCount: 0,
    },
  }
}

function isPastIsoDate(iso: string | null | undefined): boolean {
  if (!iso?.trim()) return false
  const value = iso.trim()
  const date = value.includes('T')
    ? new Date(value)
    : new Date(`${value.slice(0, 10)}T23:59:59`)
  if (Number.isNaN(date.getTime())) return false
  return date.getTime() < Date.now()
}

function isMaintenanceOverdue(
  row: AdminWorkflowRow,
  metadata: Record<string, unknown>,
): boolean {
  if (row.status === 'escalated') return true
  if (row.status !== 'active') return false
  const dueAt = readMetaString(metadata, 'due_at')
  return isPastIsoDate(dueAt)
}

function isLifecycleOverdue(
  row: AdminWorkflowRow,
  metadata: Record<string, unknown>,
  templateId: string,
): boolean {
  if (row.status === 'escalated') return true
  if (row.status !== 'active') return false

  if (templateId === 'move_in') {
    return isPastIsoDate(readMetaString(metadata, 'move_in_date'))
  }
  if (templateId === 'move_out') {
    return isPastIsoDate(readMetaString(metadata, 'move_out_date'))
  }
  if (templateId === 'inspection' || templateId === 'unit_inspection') {
    return isPastIsoDate(readMetaString(metadata, 'scheduled_at'))
  }
  return false
}

function pickLatestRun(runs: AdminWorkflowRow[]): AdminWorkflowRow | null {
  if (!runs.length) return null

  return runs.reduce((latest, row) => {
    const latestTs = latest.lastEventAt ?? latest.startedAt
    const rowTs = row.lastEventAt ?? row.startedAt
    return rowTs.localeCompare(latestTs) > 0 ? row : latest
  })
}

function buildWorkflowGroupCard(
  id: WorkflowTemplateGroupId,
  runs: AdminWorkflowRow[],
  metadataByRunId: Map<string, Record<string, unknown>>,
  isOverdue: (row: AdminWorkflowRow, metadata: Record<string, unknown>) => boolean,
): AdminWorkflowGroupCard {
  const activeCount = runs.filter((row) => row.status === 'active').length
  const completedCount = runs.filter((row) => row.status === 'completed').length
  const overdueCount = runs.filter((row) =>
    isOverdue(row, metadataByRunId.get(row.id) ?? {})
  ).length
  const latestRun = pickLatestRun(runs)

  return {
    id,
    title: WORKFLOW_GROUP_TITLES[id],
    activeCount,
    overdueCount,
    completedCount,
    latestEvent: {
      label: latestRun ? formatEventLabel(latestRun) : 'No events yet',
      at: latestRun?.lastEventAt ?? latestRun?.startedAt ?? null,
      runId: latestRun?.id ?? null,
    },
    context: latestRun ? formatLocationContext(latestRun) : null,
    runCount: runs.length,
  }
}

function emptyWorkflowGroups(): AdminWorkflowGroupCard[] {
  return WORKFLOW_TEMPLATE_GROUP_ORDER.map((id) => ({
    id,
    title: WORKFLOW_GROUP_TITLES[id],
    activeCount: 0,
    overdueCount: 0,
    completedCount: 0,
    latestEvent: { label: 'No events yet', at: null, runId: null },
    context: null,
    runCount: 0,
  }))
}

function formatEventLabel(row: AdminWorkflowRow): string {
  if (row.lastEventMessage?.trim()) return row.lastEventMessage.trim()
  if (row.lastEventType?.trim()) {
    return EVENT_LABELS[row.lastEventType] ?? row.lastEventType.trim()
  }
  return '—'
}

export function formatWorkflowTimestamp(iso: string | null | undefined): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
}

export { formatStepLabel, formatEventLabel }

export async function fetchAdminWorkflowDashboard(): Promise<AdminWorkflowDashboardData> {
  if (!supabase) {
    return {
      active: [],
      escalated: [],
      maintenanceRuns: [],
      rentCollection: emptyRentCollectionDashboard(),
      lifecycle: emptyLifecycleDashboard(),
      groups: emptyWorkflowGroups(),
      stats: { activeCount: 0, escalatedCount: 0, completedCount: 0 },
    }
  }

  const { data: runsRaw, error: runsError } = await supabase
    .from('workflow_runs')
    .select(
      `
      id,
      template_id,
      status,
      entity_type,
      entity_id,
      property_id,
      unit_id,
      resident_id,
      current_step,
      started_at,
      completed_at,
      metadata,
      workflow_templates ( id, name, type )
    `,
    )
    .eq('landlord_id', getActiveLandlordId())
    .order('started_at', { ascending: false })
    .limit(250)

  if (runsError) {
    console.error('[admin-workflows] workflow_runs fetch', runsError.message)
    throw new Error(runsError.message)
  }

  const runs = (runsRaw ?? []) as WorkflowRunRecord[]
  const runIds = runs.map((run) => run.id)

  const residentIds = [
    ...new Set(
      runs
        .map((run) => run.resident_id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0),
    ),
  ]

  const unitIds = [
    ...new Set(
      runs
        .map((run) => run.unit_id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0),
    ),
  ]

  const [eventsResult, residentsResult, unitsResult] = await Promise.all([
    runIds.length
      ? supabase
          .from('workflow_events')
          .select('id, workflow_run_id, event_type, message, step, stage, created_at')
          .in('workflow_run_id', runIds)
          .order('created_at', { ascending: true })
      : Promise.resolve({ data: [], error: null }),
    residentIds.length
      ? supabase
          .from('users')
          .select('id, full_name, unit, building')
          .in('id', residentIds)
      : Promise.resolve({ data: [], error: null }),
    unitIds.length
      ? supabase
          .from('units')
          .select('id, unit_label, building')
          .in('id', unitIds)
      : Promise.resolve({ data: [], error: null }),
  ])

  if (eventsResult.error) {
    console.error('[admin-workflows] workflow_events fetch', eventsResult.error.message)
  }
  if (residentsResult.error) {
    console.error('[admin-workflows] residents fetch', residentsResult.error.message)
  }
  if (unitsResult.error) {
    console.error('[admin-workflows] units fetch', unitsResult.error.message)
  }

  const latestEventByRun = new Map<string, WorkflowEventRecord>()
  const timelineByRun = new Map<string, AdminWorkflowTimelineEvent[]>()

  for (const event of (eventsResult.data ?? []) as WorkflowEventRecord[]) {
    const timelineEvent = buildTimelineEvent(event)
    const existingTimeline = timelineByRun.get(event.workflow_run_id) ?? []
    existingTimeline.push(timelineEvent)
    timelineByRun.set(event.workflow_run_id, existingTimeline)
    latestEventByRun.set(event.workflow_run_id, event)
  }

  const residentById = new Map<string, ResidentRecord>()
  for (const resident of (residentsResult.data ?? []) as ResidentRecord[]) {
    residentById.set(String(resident.id), resident)
  }

  const unitById = new Map<string, UnitRecord>()
  for (const unit of (unitsResult.data ?? []) as UnitRecord[]) {
    unitById.set(String(unit.id), unit)
  }

  const rows: AdminWorkflowRow[] = runs.map((run) => {
    const template = embedOne(run.workflow_templates)
    const metadata = run.metadata ?? {}
    const resident = run.resident_id ? residentById.get(run.resident_id) : null
    const unit = run.unit_id ? unitById.get(run.unit_id) : null
    const latestEvent = latestEventByRun.get(run.id)

    const unitLabel =
      readMetaString(metadata, 'unit_label') ??
      unit?.unit_label ??
      resident?.unit ??
      null

    const propertyLabel =
      readMetaString(metadata, 'building') ??
      unit?.building ??
      resident?.building ??
      null

    return {
      id: run.id,
      templateId: run.template_id,
      templateName: formatTemplateName(run.template_id, template?.name),
      templateType: template?.type ?? 'other',
      status: run.status as WorkflowRunStatus,
      currentStep: run.current_step,
      entityType: run.entity_type,
      entityId: run.entity_id,
      residentId: run.resident_id,
      residentName: resident?.full_name?.trim() ?? null,
      unitLabel,
      propertyLabel,
      startedAt: run.started_at,
      completedAt: run.completed_at,
      lastEventType: latestEvent?.event_type ?? null,
      lastEventMessage: latestEvent?.message ?? null,
      lastEventAt: latestEvent?.created_at ?? null,
    }
  })

  const active = rows.filter(
    (row) =>
      row.status === 'active' &&
      row.templateId !== 'rent_collection' &&
      !isLifecycleTemplateId(row.templateId),
  )
  const escalated = rows.filter(
    (row) =>
      row.status === 'escalated' &&
      row.templateId !== 'rent_collection' &&
      !isLifecycleTemplateId(row.templateId),
  )
  const completedCount = rows.filter((row) => row.status === 'completed').length

  const rentRuns = runs
    .filter((run) => run.template_id === 'rent_collection')
    .map((run) => {
      const baseRow = rows.find((row) => row.id === run.id)
      if (!baseRow) return null
      return buildRentCollectionRow(
        baseRow,
        run.metadata ?? {},
        timelineByRun.get(run.id) ?? [],
      )
    })
    .filter((row): row is AdminRentCollectionRow => row !== null)

  const rentActive = rentRuns.filter((row) => row.status === 'active')
  const rentEscalated = rentRuns.filter((row) => row.status === 'escalated')

  const dueToday = rentActive.filter((row) => row.isDueToday)
  const overdue = rentActive.filter((row) => row.isOverdue)
  const reminderSent = rentRuns.filter((row) => row.reminderSent)

  const lifecycleRuns = runs
    .filter((run) => isLifecycleTemplateId(run.template_id))
    .map((run) => {
      const baseRow = rows.find((row) => row.id === run.id)
      if (!baseRow) return null
      return buildLifecycleRow(
        baseRow,
        run.metadata ?? {},
        timelineByRun.get(run.id) ?? [],
      )
    })
    .filter((row): row is AdminLifecycleRow => row !== null)

  const lifecycleActive = lifecycleRuns.filter((row) => row.status === 'active')

  const metadataByRunId = new Map<string, Record<string, unknown>>()
  for (const run of runs) {
    metadataByRunId.set(run.id, run.metadata ?? {})
  }

  const maintenanceRows = rows.filter((row) =>
    MAINTENANCE_TEMPLATE_IDS.has(row.templateId)
  )

  const groups: AdminWorkflowGroupCard[] = [
    buildWorkflowGroupCard(
      'maintenance',
      maintenanceRows,
      metadataByRunId,
      isMaintenanceOverdue,
    ),
    buildWorkflowGroupCard(
      'rent_collection',
      rentRuns,
      metadataByRunId,
      (row) => {
        const rentRow = rentRuns.find((rent) => rent.id === row.id)
        return rentRow?.isOverdue === true || row.status === 'escalated'
      },
    ),
    buildWorkflowGroupCard(
      'move_in',
      lifecycleRuns.filter((row) => row.templateId === 'move_in'),
      metadataByRunId,
      (row, metadata) => isLifecycleOverdue(row, metadata, row.templateId),
    ),
    buildWorkflowGroupCard(
      'move_out',
      lifecycleRuns.filter((row) => row.templateId === 'move_out'),
      metadataByRunId,
      (row, metadata) => isLifecycleOverdue(row, metadata, row.templateId),
    ),
    buildWorkflowGroupCard(
      'inspection',
      lifecycleRuns.filter(
        (row) => row.templateId === 'inspection' || row.templateId === 'unit_inspection',
      ),
      metadataByRunId,
      (row, metadata) => isLifecycleOverdue(row, metadata, row.templateId),
    ),
  ]

  return {
    active,
    escalated,
    maintenanceRuns: maintenanceRows,
    rentCollection: {
      runs: rentRuns,
      dueToday,
      overdue,
      reminderSent,
      escalatedResidents: rentEscalated,
      stats: {
        dueTodayCount: dueToday.length,
        overdueCount: overdue.length,
        reminderSentCount: reminderSent.length,
        escalatedCount: rentEscalated.length,
      },
    },
    lifecycle: {
      runs: lifecycleRuns,
      moveIn: lifecycleRuns.filter((row) => row.templateId === 'move_in'),
      moveOut: lifecycleRuns.filter((row) => row.templateId === 'move_out'),
      inspections: lifecycleRuns.filter((row) => row.templateId === 'inspection'),
      stats: {
        moveInCount: lifecycleRuns.filter((row) => row.templateId === 'move_in').length,
        moveOutCount: lifecycleRuns.filter((row) => row.templateId === 'move_out').length,
        inspectionCount: lifecycleRuns.filter((row) => row.templateId === 'inspection').length,
        activeCount: lifecycleActive.length,
      },
    },
    groups,
    stats: {
      activeCount: active.length,
      escalatedCount: escalated.length,
      completedCount,
    },
  }
}
