import { formatUnitReference } from '@shared/properties/unitLabelDisplay'
import { getActiveLandlordId } from '@/lib/activeLandlord'
import { buildingsLikelySamePlace, normalizeBuildingKey } from '@/lib/propertyHealth'
import { formatLandlordCurrency, formatLandlordDate } from '@/lib/landlordWorkspace'
import { supabase } from '@/lib/supabase'
import {
  isOnboardingImportLeaseRenewalRun,
  retireOnboardingImportLeaseRenewals,
} from '@/lib/onboardingImportLeaseRenewal'
import { formatWorkOrderRefFromTicketId } from '@/lib/vendorCallFlow'
import {
  shouldShowStandaloneInspectionActiveTask,
  standaloneInspectionActiveTaskTitle,
  standaloneInspectionNextStep,
  standaloneInspectionTaskRowId,
} from '@shared/maintenance/standaloneInspectionTask'

/** Plain checklist label from a ticket description (HQS fail: Room - Issue → Room — Issue). */
export function checklistLabelFromTicketDescription(
  description: string | null | undefined,
): string {
  const first = String(description ?? '').split('\n')[0]?.trim() || ''
  const hqs = first.match(/^HQS fail:\s*(.+)$/i)
  if (hqs?.[1]) {
    return hqs[1].replace(/\s+-\s+/g, ' — ').trim() || 'Inspection item'
  }
  return first || 'Repair item'
}

/** Short inspection report reference for UI (IR-8AC8). */
export function formatInspectionReportRef(reportId: string): string {
  const compact = reportId.replace(/-/g, '').slice(0, 4).toUpperCase()
  return compact ? `IR-${compact}` : 'Inspection visit'
}

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
  /** workflow_runs.property_id when present. */
  propertyId?: string | null
  /** workflow_runs.unit_id when present. */
  unitId?: string | null
  residentId: string | null
  residentName: string | null
  unitLabel: string | null
  propertyLabel: string | null
  startedAt: string
  completedAt: string | null
  lastEventType: string | null
  lastEventMessage: string | null
  lastEventAt: string | null
  /** From workflow_runs.metadata.escalation_reason when escalated. */
  escalationReason: string | null
  /** From linked ticket `issue_category`, else workflow_runs.metadata.issue_category. */
  issueCategory: string | null
  /** Linked ticket description (or intake metadata) for Active Tasks card blurbs. */
  issueDescription?: string | null
  /**
   * From linked `maintenance_requests.vendor_work_status` when the run targets a ticket.
   * Drives Operations kanban: New Intake → Assigned → In Progress → Completed.
   */
  vendorWorkStatus: string | null
  /** From linked `maintenance_requests.assigned_vendor_id` when present. */
  assignedVendorId: string | null
  /**
   * HQS / inspection letter grouping. When set, Active Tasks collapses sibling
   * tickets into one visit card.
   */
  inspectionReportId?: string | null
  /**
   * All fail items under the same inspection_report_id (populated for every
   * sibling row; kanban dedupe keeps one representative with this list).
   */
  inspectionGroupItems?: InspectionGroupTicketItem[] | null
  /** Step log for escalated run review rails. */
  timeline?: AdminWorkflowTimelineEvent[]
}

/** One fail item inside an inspection-report visit group. */
export type InspectionGroupTicketItem = {
  ticketId: string
  workOrderRef: string
  label: string
  vendorWorkStatus: string | null
  runId: string | null
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
  /** True after dashboard payment-plan SMS was delivered to the resident thread. */
  paymentPlanSmsSent: boolean
  /** True after dashboard late-fee waiver SMS was delivered to the resident thread. */
  lateFeeWaiverSmsSent: boolean
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
  /** Zero-checklist inspection_reports (tenant notices) as standalone Active Tasks. */
  standaloneInspectionTasks: AdminWorkflowRow[]
  rentCollection: AdminRentCollectionDashboard
  lifecycle: AdminLifecycleDashboard
  groups: AdminWorkflowGroupCard[]
  runMetadata: Record<string, Record<string, unknown>>
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

/** Ticket id on a maintenance run: entity id, or intake metadata when the run is still conversation-keyed. */
export function maintenanceTicketIdFromWorkflowRun(run: {
  templateId?: string | null
  entityType?: string | null
  entityId?: string | null
  metadata?: Record<string, unknown> | null
}): string | null {
  const entityId = typeof run.entityId === 'string' ? run.entityId.trim() : ''
  if (
    entityId &&
    (run.entityType === 'maintenance_request' || run.templateId === 'maintenance_request')
  ) {
    return entityId
  }
  const meta = run.metadata && typeof run.metadata === 'object' ? run.metadata : {}
  for (const key of ['draft_ticket_id', 'maintenance_request_id'] as const) {
    const value = meta[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return null
}

/** Cancelled/archived work orders must not appear as open Active Tasks, even if the run row is still `active`. */
export function isCancelledOnActiveTasks(row: {
  status?: string | null
  vendorWorkStatus?: string | null
}): boolean {
  const run = (row.status ?? '').trim().toLowerCase()
  if (run === 'cancelled') return true
  const vws = (row.vendorWorkStatus ?? '').trim().toLowerCase()
  return vws === 'cancelled' || vws === 'archived'
}

/** Completed repairs belong in Active Tasks Completed — not Needs Your Attention. */
export function isCompletedOnActiveTasks(row: {
  status?: string | null
  vendorWorkStatus?: string | null
}): boolean {
  if ((row.status ?? '').trim().toLowerCase() === 'completed') return true
  return (row.vendorWorkStatus ?? '').trim().toLowerCase() === 'completed'
}

export function isSettledOnActiveTasks(row: {
  status?: string | null
  vendorWorkStatus?: string | null
}): boolean {
  return isCancelledOnActiveTasks(row) || isCompletedOnActiveTasks(row)
}

/**
 * Scope a workflow run to one property: property_id / unit_id first, then building
 * label. Never treat bare unit labels as a property key.
 */
export function workflowMatchesPropertyScope(
  row: Pick<AdminWorkflowRow, 'propertyId' | 'unitId' | 'propertyLabel' | 'entityType' | 'entityId'>,
  opts: {
    building: string
    propertyId?: string | null
    unitIds?: ReadonlySet<string>
    /** maintenance_request entity id → property_id */
    ticketPropertyById?: ReadonlyMap<string, string | null | undefined>
  },
): boolean {
  const propertyId = opts.propertyId?.trim() || null
  if (propertyId && row.propertyId?.trim() && row.propertyId === propertyId) return true
  if (row.unitId && opts.unitIds?.has(row.unitId)) return true
  if (
    propertyId &&
    row.entityType === 'maintenance_request' &&
    row.entityId &&
    opts.ticketPropertyById?.get(row.entityId) === propertyId
  ) {
    return true
  }
  const rowBuilding = row.propertyLabel?.trim()
  if (!rowBuilding) return false
  return (
    normalizeBuildingKey(rowBuilding) === normalizeBuildingKey(opts.building) ||
    buildingsLikelySamePlace(rowBuilding, opts.building)
  )
}

export function workflowTemplateGroupId(templateId: string): WorkflowTemplateGroupId | null {
  if (MAINTENANCE_TEMPLATE_IDS.has(templateId)) return 'maintenance'
  if (templateId === 'rent_collection') return 'rent_collection'
  if (templateId === 'move_in') return 'move_in'
  if (templateId === 'move_out') return 'move_out'
  if (templateId === 'inspection' || templateId === 'inspection_notice_task') {
    return 'inspection'
  }
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
  const unitDisplay = formatUnitReference(String(context.unitLabel ?? ''))
  const parts = [context.propertyLabel, unitDisplay].filter(Boolean)
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
  property_id?: string | null
}

const TEMPLATE_LABELS: Record<string, string> = {
  maintenance_intake: 'Maintenance intake',
  maintenance_request: 'Maintenance request',
  lease_renewal: 'Lease renewal',
  rent_collection: 'Rent collection',
  move_in: 'Move in',
  move_out: 'Move out',
  inspection: 'Inspection',
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
  'maintenance.created': 'Work order opened',
  'maintenance.request_submitted': 'Repair reported',
  'maintenance.schedule_confirmed': 'Visit confirmed',
  'maintenance.schedule_updated': 'Visit time updated',
  'maintenance.completed': 'Repair completed',
  'vendor.accepted': 'Vendor accepted the job',
  'vendor.declined': 'Vendor declined the job',
  'tenant.activation_sms_sent': 'Welcome text sent',
  'tenant.activation_sms_failed': 'Welcome text could not be sent',
  'tenant.sms_opted_in': 'Resident opted in to texts',
  'tenant.sms_opted_out': 'Resident opted out of texts',
  'tenant.sms_help': 'Resident asked for help over text',
  'tenant.activation_completed': 'Resident activated',
  'tenant.onboarding_verification': 'Tenant onboarding verification',
  'sms.delivery_failed': 'Text could not be delivered',
  'maintenance.sla_auto_reassigned':
    "Vendor didn't respond in time. The job was reassigned.",
  'maintenance.external_vendor_reassigned': 'External vendor assigned',
  'vendor.thumbtack_message_sent': 'Vendor contacted on Thumbtack',
  'vendor.thumbtack_replied': 'External vendor replied',
  'maintenance.sla_expired_needs_vendor': 'Vendor Needed, Response Time Expired',
  'unit.registered': 'Unit registered',
  'tenant.sms_registered': 'Resident SMS linked',
  'sms.intake_handed_off': 'Resident text handed off to the property team',
  'sms.routed_to_landlord': 'Resident text routed to the property team',
  'lease.info_answered': 'Lease details shared over text',
  'sms.lease_info_missing': 'Leasing information is missing',
  'sms.rent_balance_answered': 'Rent balance shared over text',
  'sms.rent_payment_status_answered': 'Rent payment status shared over text',
  'sms.rent_late_noted': 'Resident said rent will be late',
  'sms.maintenance_status_answered': 'Repair status shared over text',
  'sms.maintenance_update_noted': 'Repair update noted, waiting for confirm',
  'sms.maintenance_update_applied': 'Repair update added to the work order',
  'sms.maintenance_followup_clarify': 'Asked which open request the resident meant',
  'sms.maintenance_update_declined': 'Resident chose not to add a repair update',
  'sms.maintenance_reopened': 'Repair reopened after resident said it was not fixed',
  'sms.maintenance_cancel_noted': 'Repair cancel request noted, waiting for confirm',
  'sms.maintenance_cancelled': 'Repair cancelled from resident text',
  'sms.maintenance_cancel_declined': 'Resident chose not to cancel the repair',
  'sms.maintenance_cancel_needs_review': 'Repair cancel needs the property team',
  'sms.schedule_change_requested': 'Resident asked to change a visit time',
  'sms.access_instruction_saved': 'Access notes saved from resident text',
  'sms.move_out_noted': 'Move-out request noted from resident text',
  'sms.move_out_started': 'Move-out started from resident text',
  'sms.move_out_declined': 'Resident chose not to start a move-out',
  'attention.dismissed': 'Removed from Needs Your Attention',
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

export function hasMappedEventTypeLabel(eventType: string): boolean {
  return Object.prototype.hasOwnProperty.call(EVENT_LABELS, eventType)
}

export function formatRentClassificationLabel(
  classification: RentCollectionClassification | null,
): string {
  if (!classification) return '—'
  return RENT_CLASSIFICATION_LABELS[classification]
}

export function formatCurrency(amount: number | null | undefined): string {
  return formatLandlordCurrency(amount)
}

export function formatRentDueDate(iso: string | null | undefined): string {
  return formatLandlordDate(iso)
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
    paymentPlanSmsSent: readMetaBoolean(metadata, 'payment_plan_sms_sent'),
    lateFeeWaiverSmsSent:
      readMetaBoolean(metadata, 'late_fee_waiver_sms_sent') ||
      readMetaBoolean(metadata, 'late_fee_waived'),
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
  if (templateId === 'inspection') {
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
  const activeCount = runs.filter(
    (row) => row.status === 'active' && !isCancelledOnActiveTasks(row),
  ).length
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

export function emptyAdminWorkflowDashboardData(): AdminWorkflowDashboardData {
  return {
    active: [],
    escalated: [],
    maintenanceRuns: [],
    standaloneInspectionTasks: [],
    rentCollection: emptyRentCollectionDashboard(),
    lifecycle: emptyLifecycleDashboard(),
    groups: emptyWorkflowGroups(),
    runMetadata: {},
    stats: { activeCount: 0, escalatedCount: 0, completedCount: 0 },
  }
}

/**
 * Open inspection_reports with no itemized checklist (tenant notices, etc.)
 * as standalone Active Tasks rows. Never links or absorbs work orders.
 */
export async function loadStandaloneInspectionTaskRows(
  landlordId: string,
  options?: { residentId?: string | null },
): Promise<AdminWorkflowRow[]> {
  if (!supabase || !landlordId.trim()) return []

  const { data: reports, error } = await supabase
    .from('inspection_reports')
    .select(
      'id, letter_type, inspection_date, status, unit_id, property_id, source_document_id, emergency_item_count, standard_item_count, created_at, conversation_id',
    )
    .eq('landlord_id', landlordId)
    .in('status', ['open', 'in_progress'])
    .order('inspection_date', { ascending: true, nullsFirst: false })
    .limit(80)

  if (error || !reports?.length) return []

  const reportIds = reports.map((r) => String(r.id))
  const unitIds = [
    ...new Set(
      reports
        .map((r) => (r.unit_id == null ? '' : String(r.unit_id).trim()))
        .filter(Boolean),
    ),
  ]

  const sourceDocIds = [
    ...new Set(
      reports
        .map((r) =>
          r.source_document_id == null ? '' : String(r.source_document_id).trim(),
        )
        .filter(Boolean),
    ),
  ]

  const [{ data: linkedTickets }, { data: units }, { data: sourceDocs }] =
    await Promise.all([
      supabase
        .from('maintenance_requests')
        .select('id, inspection_report_id')
        .eq('landlord_id', landlordId)
        .in('inspection_report_id', reportIds),
      unitIds.length
        ? supabase
            .from('units')
            .select('id, unit_label, building, property_id')
            .in('id', unitIds)
        : Promise.resolve({ data: [] as Array<Record<string, unknown>> }),
      sourceDocIds.length
        ? supabase
            .from('inspection_source_documents')
            .select('id, file_name')
            .in('id', sourceDocIds)
        : Promise.resolve({ data: [] as Array<Record<string, unknown>> }),
    ])

  const linkedCountByReport = new Map<string, number>()
  for (const ticket of linkedTickets ?? []) {
    const rid =
      typeof ticket.inspection_report_id === 'string'
        ? ticket.inspection_report_id.trim()
        : ''
    if (!rid) continue
    linkedCountByReport.set(rid, (linkedCountByReport.get(rid) ?? 0) + 1)
  }

  const unitById = new Map<
    string,
    { unitLabel: string | null; building: string | null; propertyId: string | null }
  >()
  for (const u of units ?? []) {
    unitById.set(String(u.id), {
      unitLabel: u.unit_label == null ? null : String(u.unit_label),
      building: u.building == null ? null : String(u.building),
      propertyId: u.property_id == null ? null : String(u.property_id),
    })
  }

  const docNameById = new Map<string, string>()
  for (const d of sourceDocs ?? []) {
    if (d.file_name) docNameById.set(String(d.id), String(d.file_name))
  }

  // Optional resident filter: only notices on units where that resident is active.
  let allowedUnitIds: Set<string> | null = null
  const residentId = options?.residentId?.trim() || null
  if (residentId) {
    const { data: occ } = await supabase
      .from('occupancy')
      .select('unit_id')
      .eq('landlord_id', landlordId)
      .eq('resident_id', residentId)
      .eq('status', 'active')
    allowedUnitIds = new Set(
      (occ ?? [])
        .map((row) => (row.unit_id == null ? '' : String(row.unit_id).trim()))
        .filter(Boolean),
    )
  }

  const rows: AdminWorkflowRow[] = []
  for (const report of reports) {
    const reportId = String(report.id)
    const linked = linkedCountByReport.get(reportId) ?? 0
    if (
      !shouldShowStandaloneInspectionActiveTask({
        letterType: report.letter_type == null ? null : String(report.letter_type),
        emergencyItemCount: Number(report.emergency_item_count ?? 0),
        standardItemCount: Number(report.standard_item_count ?? 0),
        linkedWorkOrderCount: linked,
      })
    ) {
      continue
    }

    const unitId = report.unit_id == null ? null : String(report.unit_id)
    if (allowedUnitIds && (!unitId || !allowedUnitIds.has(unitId))) continue

    const unit = unitId ? unitById.get(unitId) : null
    const sourceId =
      report.source_document_id == null ? null : String(report.source_document_id)
    const sourceName = sourceId ? docNameById.get(sourceId) : null
    const title = standaloneInspectionActiveTaskTitle({
      letterType: report.letter_type == null ? null : String(report.letter_type),
      inspectionDate:
        report.inspection_date == null ? null : String(report.inspection_date),
    })
    const nextStep = standaloneInspectionNextStep()
    const sourceBit = sourceName?.trim()
      ? `Source notice: ${sourceName.trim()}`
      : sourceId
        ? `Source notice on file (${formatInspectionReportRef(reportId)})`
        : `Inspection notice ${formatInspectionReportRef(reportId)}`
    const inspectionDateIso =
      report.inspection_date == null
        ? null
        : String(report.inspection_date).slice(0, 10)

    rows.push({
      id: standaloneInspectionTaskRowId(reportId),
      templateId: 'inspection_notice_task',
      templateName: title,
      templateType: 'inspection',
      status: 'active',
      currentStep: 'prepare',
      entityType: 'inspection_report',
      entityId: reportId,
      propertyId: report.property_id == null ? unit?.propertyId ?? null : String(report.property_id),
      unitId,
      residentId: null,
      residentName: null,
      unitLabel: unit?.unitLabel ?? null,
      propertyLabel: unit?.building ?? null,
      startedAt:
        report.created_at == null
          ? new Date().toISOString()
          : String(report.created_at),
      completedAt: null,
      lastEventType: 'inspection.tenant_notice_received',
      lastEventMessage: `${nextStep}. ${sourceBit}`,
      lastEventAt: null,
      escalationReason: null,
      issueCategory: 'inspection',
      issueDescription: [
        nextStep,
        sourceBit,
        inspectionDateIso ? `Inspection date: ${inspectionDateIso}` : null,
      ]
        .filter(Boolean)
        .join('\n'),
      vendorWorkStatus: null,
      assignedVendorId: null,
      inspectionReportId: reportId,
      // Empty / null checklist — must not trigger N-of-M visit grouping.
      inspectionGroupItems: null,
    })
  }

  return rows
}

export type FetchAdminWorkflowDashboardOptions = {
  /** When set, only this resident’s open runs are loaded (skips portfolio-wide cleanup). */
  residentId?: string
}

export async function fetchAdminWorkflowDashboard(
  options?: FetchAdminWorkflowDashboardOptions,
): Promise<AdminWorkflowDashboardData> {
  if (!supabase) {
    return emptyAdminWorkflowDashboardData()
  }

  const landlordId = getActiveLandlordId()
  const residentId = options?.residentId?.trim() || null
  if (!residentId) {
    await retireOnboardingImportLeaseRenewals(landlordId)
  }

  let runsQuery = supabase
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
    .eq('landlord_id', landlordId)

  if (residentId) {
    runsQuery = runsQuery
      .eq('resident_id', residentId)
      .in('status', ['active', 'escalated'])
  }

  const { data: runsRaw, error: runsError } = await runsQuery
    .order('started_at', { ascending: false })
    .limit(residentId ? 40 : 250)

  if (runsError) {
    console.error('[admin-workflows] workflow_runs fetch', runsError.message)
    return emptyAdminWorkflowDashboardData()
  }

  const runs = ((runsRaw ?? []) as WorkflowRunRecord[]).filter(
    (run) =>
      !isOnboardingImportLeaseRenewalRun(run.template_id, run.metadata, run.entity_type),
  )
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

  const eventsQuery = runIds.length
    ? supabase
        .from('workflow_events')
        .select('id, workflow_run_id, event_type, message, step, stage, created_at')
        .in('workflow_run_id', runIds)
        .order('created_at', { ascending: true })
        .limit(residentId ? 300 : 2000)
    : null

  const [eventsResult, residentsResult, unitsResult] = await Promise.all([
    eventsQuery
      ? eventsQuery
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
          .select('id, unit_label, building, property_id')
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

  const maintenanceTicketIds = [
    ...new Set(
      runs
        .map((run) =>
          maintenanceTicketIdFromWorkflowRun({
            templateId: run.template_id,
            entityType: run.entity_type,
            entityId: run.entity_id,
            metadata: run.metadata,
          }),
        )
        .filter((id): id is string => Boolean(id)),
    ),
  ]

  const ticketById = new Map<
    string,
    {
      vendor_work_status: string | null
      assigned_vendor_id: string | null
      issue_category: string | null
      description: string | null
      inspection_report_id: string | null
    }
  >()
  if (maintenanceTicketIds.length) {
    const { data: tickets, error: ticketsError } = await supabase
      .from('maintenance_requests')
      .select(
        'id, vendor_work_status, assigned_vendor_id, issue_category, description, inspection_report_id',
      )
      .in('id', maintenanceTicketIds)
    if (ticketsError) {
      console.error(
        '[admin-workflows] maintenance_requests status fetch',
        ticketsError.message,
      )
    } else {
      for (const ticket of tickets ?? []) {
        const id = typeof ticket.id === 'string' ? ticket.id : ''
        if (!id) continue
        ticketById.set(id, {
          vendor_work_status:
            typeof ticket.vendor_work_status === 'string'
              ? ticket.vendor_work_status
              : null,
          assigned_vendor_id:
            typeof ticket.assigned_vendor_id === 'string'
              ? ticket.assigned_vendor_id
              : null,
          issue_category:
            typeof ticket.issue_category === 'string' && ticket.issue_category.trim()
              ? ticket.issue_category.trim()
              : null,
          description:
            typeof ticket.description === 'string' && ticket.description.trim()
              ? ticket.description.trim()
              : null,
          inspection_report_id:
            typeof ticket.inspection_report_id === 'string' &&
              ticket.inspection_report_id.trim()
              ? ticket.inspection_report_id.trim()
              : null,
        })
      }
    }
  }

  // Load every open fail item under the same inspection reports so group cards
  // can show N-of-M even when some siblings lack a run row in this page load.
  const reportIds = [
    ...new Set(
      [...ticketById.values()]
        .map((t) => t.inspection_report_id)
        .filter((id): id is string => Boolean(id)),
    ),
  ]
  const inspectionTicketsByReportId = new Map<string, InspectionGroupTicketItem[]>()
  if (reportIds.length > 0) {
    const { data: groupTickets, error: groupErr } = await supabase
      .from('maintenance_requests')
      .select('id, description, vendor_work_status, inspection_report_id, created_at')
      .in('inspection_report_id', reportIds)
      .eq('landlord_id', landlordId)
      .order('created_at', { ascending: true })
    if (groupErr) {
      console.error('[admin-workflows] inspection group tickets', groupErr.message)
    } else {
      for (const ticket of groupTickets ?? []) {
        const ticketId = typeof ticket.id === 'string' ? ticket.id : ''
        const reportId =
          typeof ticket.inspection_report_id === 'string'
            ? ticket.inspection_report_id.trim()
            : ''
        if (!ticketId || !reportId) continue
        const list = inspectionTicketsByReportId.get(reportId) ?? []
        list.push({
          ticketId,
          workOrderRef: formatWorkOrderRefFromTicketId(ticketId),
          label: checklistLabelFromTicketDescription(
            typeof ticket.description === 'string' ? ticket.description : null,
          ),
          vendorWorkStatus:
            typeof ticket.vendor_work_status === 'string'
              ? ticket.vendor_work_status
              : null,
          runId: null,
        })
        inspectionTicketsByReportId.set(reportId, list)
      }
    }
  }

  const rows: AdminWorkflowRow[] = runs.map((run) => {
    const template = embedOne(run.workflow_templates)
    const metadata = run.metadata ?? {}
    const resident = run.resident_id ? residentById.get(run.resident_id) : null
    const unit = run.unit_id ? unitById.get(run.unit_id) : null
    const latestEvent = latestEventByRun.get(run.id)
    const ticketId = maintenanceTicketIdFromWorkflowRun({
      templateId: run.template_id,
      entityType: run.entity_type,
      entityId: run.entity_id,
      metadata: metadata,
    })
    const ticket = ticketId ? ticketById.get(ticketId) : undefined

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
      propertyId: run.property_id ?? unit?.property_id ?? null,
      unitId: run.unit_id ?? null,
      residentId: run.resident_id,
      residentName: resident?.full_name?.trim() ?? null,
      unitLabel,
      propertyLabel,
      startedAt: run.started_at,
      completedAt: run.completed_at,
      lastEventType: latestEvent?.event_type ?? null,
      lastEventMessage: latestEvent?.message ?? null,
      lastEventAt: latestEvent?.created_at ?? null,
      escalationReason: readMetaString(metadata, 'escalation_reason'),
      issueCategory:
        ticket?.issue_category ?? readMetaString(metadata, 'issue_category'),
      issueDescription:
        ticket?.description ??
        readMetaString(metadata, 'description') ??
        readMetaString(metadata, 'issue_description') ??
        readMetaString(metadata, 'issue_summary'),
      vendorWorkStatus: ticket?.vendor_work_status ?? null,
      assignedVendorId: ticket?.assigned_vendor_id ?? null,
      inspectionReportId: ticket?.inspection_report_id ?? null,
      inspectionGroupItems: null,
    }
  })

  // Attach full inspection checklists + run ids onto every sibling row.
  const runIdByTicketId = new Map<string, string>()
  for (const row of rows) {
    const ticketId = maintenanceTicketIdFromWorkflowRun({
      templateId: row.templateId,
      entityType: row.entityType,
      entityId: row.entityId,
      metadata: {},
    })
    if (ticketId && !runIdByTicketId.has(ticketId)) {
      runIdByTicketId.set(ticketId, row.id)
    }
  }
  for (const row of rows) {
    const reportId = row.inspectionReportId?.trim()
    if (!reportId) continue
    const items = inspectionTicketsByReportId.get(reportId)
    if (!items?.length) continue
    row.inspectionGroupItems = items.map((item) => ({
      ...item,
      runId: runIdByTicketId.get(item.ticketId) ?? item.runId,
    }))
  }
  const active = rows.filter(
    (row) =>
      row.status === 'active' &&
      !isCancelledOnActiveTasks(row) &&
      row.templateId !== 'rent_collection' &&
      !isLifecycleTemplateId(row.templateId),
  )
  const escalated = rows
    .filter(
      (row) =>
        row.status === 'escalated' &&
        !isSettledOnActiveTasks(row) &&
        row.templateId !== 'rent_collection' &&
        !isLifecycleTemplateId(row.templateId),
    )
    .map((row) => ({
      ...row,
      timeline: timelineByRun.get(row.id) ?? [],
    }))
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
  const runMetadata = Object.fromEntries(metadataByRunId.entries())

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
      lifecycleRuns.filter((row) => row.templateId === 'inspection'),
      metadataByRunId,
      (row, metadata) => isLifecycleOverdue(row, metadata, row.templateId),
    ),
  ]

  const standaloneInspectionTasks = await loadStandaloneInspectionTaskRows(
    landlordId,
    { residentId },
  )

  return {
    active,
    escalated,
    maintenanceRuns: maintenanceRows,
    standaloneInspectionTasks,
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
    runMetadata,
    stats: {
      activeCount: active.length + standaloneInspectionTasks.length,
      escalatedCount: escalated.length,
      completedCount,
    },
  }
}
