import { getActiveLandlordId } from '@/lib/activeLandlord'
import {
  fetchAdminWorkflowDashboard,
  formatInspectionReportRef,
  workflowTemplateGroupId,
  type AdminWorkflowRow,
} from '@/lib/adminWorkflows'
import {
  buildMaintenanceWorkOrderTimeline,
  vendorStatusLabel,
} from '@/lib/escalatedWorkflowReview'
import type { SlaOverdueTimelineEntry } from '@/lib/slaOverdueActionReview'
import {
  WORKFLOW_CATEGORY_BADGE,
  WORKFLOW_STAGE_LABEL,
  buildWorkflowKanbanCard,
  collectAdminWorkflowRuns,
  deriveWorkflowKanbanStage,
  inspectionGroupProgress,
  lifecycleStepKey,
  vendorWorkStatusChipLabel,
  type WorkflowKanbanCategory,
  type WorkflowKanbanStageId,
} from '@/lib/adminWorkflowKanban'
import { generateIssueSummary } from '@shared/maintenance/generateIssueSummary.ts'
import { homeCheckWorkOrderTitle } from '@shared/homeCheck'
import {
  formatBareUnitLabel,
  formatLocationWithOptionalUnit,
} from '@shared/properties/unitLabelDisplay'
import {
  formatLandlordEscalationReason,
  isMaintenanceAdminVendorEscalationReason,
  isStalePendingAcceptNeedsAdminVendor,
  looksLikeInternalEscalationCode,
  STALE_PENDING_ACCEPT_NEEDS_ADMIN_CONTEXT,
  STALE_PENDING_ACCEPT_NEEDS_ADMIN_STATUS_LABEL,
} from '@/lib/maintenanceAdminVendor'
import { extractStructuredIssueDetails } from '@shared/maintenance/structuredIssueDetails.ts'
import {
  deriveMaintenanceScheduleState,
  formatAskedAgo,
  parsePendingResidentScheduleAsk,
  resolveScheduleWhenLabel,
  visitLabelKindForScheduleState,
  type MaintenanceScheduleState,
  type PendingResidentScheduleAsk,
} from '@/lib/maintenanceScheduleState'
import { formatVendorTradeLabel } from '@/lib/vendorTrades'
import { formatTicketRequestNumber, formatWorkOrderRefForWorkflowRun } from '@/lib/vendorCallFlow'
import { normalizePhoneForDb } from '@/lib/phoneFormat'
import { displayResidentEmail } from '@/lib/residentProfileDetail'
import { pickPrimaryWorkOrderConversationId } from '@/lib/workOrderConversationPreference'
import {
  buildMoveOutTimeline,
  formatMoveOutDateLabel,
  moveOutPipelineTitle,
  moveOutProgressPercent,
} from '@/lib/moveOutWorkflow'
import { isMaintenanceInvoicePaidFromRow } from '@/lib/paymentSettlement'
import {
  resolveWorkOrderInboxConversationId,
  type InspectionUloThreadInput,
  type MaintenanceUloThreadInput,
  type MoveInUloThreadInput,
  type WorkflowUloThreadInput,
} from '@/lib/conversationMonitoring'
import {
  isProviderAuthMediaUrl,
  isStorageMediaPath,
  normalizeMediaRefs,
  resolveSmsMediaForMessages,
} from '@/lib/smsMedia'
import {
  shouldSkipUnclaimedSmsMediaExtras,
  smsMediaExtraAllowedOnWorkOrder,
  smsMessageBelongsToWorkOrder,
} from '@/lib/workOrderSmsPhotos'
import {
  formatPropertyAccessPlainText,
  loadPropertyAccessCandidates,
  propertyAccessDisplayRows,
  type PropertyAccessDisplayRow,
} from '@/lib/propertyAccess'
import {
  findPropertyByName,
  propertyRecordToAddressLine,
} from '@/lib/properties'

export type WorkflowPipelineStepState = 'complete' | 'active' | 'upcoming'

export type WorkflowPipelineStep = {
  label: string
  state: WorkflowPipelineStepState
}

export type WorkflowPipelineField = {
  label: string
  value: string
}

export type WorkflowPipelineAttachment = {
  name: string
  sizeLabel: string
  kind: 'image' | 'video' | 'document' | 'audio'
  url?: string
  downloadUrl?: string
  previewStatus?: 'ready' | 'processing' | 'failed' | 'unavailable'
  storagePath?: string
  caption?: string
}

export type WorkflowPipelineResident = {
  id: string | null
  name: string
  initials: string
  statusLine: string
  phone: string
  email: string
  moveIn: string
  preferred: string
  emergencyContact: string
}

export type WorkflowPipelineVendor = {
  id: string | null
  name: string
  initials: string
  statusLine: string
  phone: string
  email: string
}

export type WorkflowPipelineProperty = {
  /** Canonical properties.id when resolved. */
  id: string | null
  property: string
  building: string
  address: string
  unit: string
  manager: string
  access: string
  entryCode: string
  accessRows: PropertyAccessDisplayRow[]
}

export type WorkflowPipelineInvoiceSection = {
  status: string
  statusLabel: string
  laborCost: number | null
  materialCost: number | null
  taxAmount: number | null
  totalCost: number | null
  invoiceNumber: string | null
  /** Calendar-year approved payments to this vendor (includes this invoice when paid). */
  ytdPaidTotal: number | null
  /** Shown when spend is recognized / invoice approved. */
  necTrackingNote: string | null
}

export type WorkflowPipelineDetail = {
  runId: string
  workOrderRef: string
  ticketRequestNumber: string
  title: string
  categoryLabel: string
  categoryClassName: string
  stageLabel: string
  stageClassName: string
  priorityLabel: string | null
  priorityClassName: string | null
  createdLine: string
  /** Repair timeline — date reported (same calendar format as estimated completion). */
  reportedDateLabel: string
  /** Repair timeline — estimated completion date. */
  estimatedCompletionLabel: string
  /** Repair timeline — estimated cost. */
  estimatedCostLabel: string
  locationLine: string
  description: string
  /** Plain-language “what’s happening now” under the issue summary. */
  statusContext: string | null
  progressSteps: WorkflowPipelineStep[]
  progressCaption: string
  /**
   * One short sentence under Repair progress: who acts next.
   * Built only from saved ticket/run fields — never invented.
   */
  progressNextAction: string | null
  overviewFields: WorkflowPipelineField[]
  maintenanceDetails: WorkflowPipelineField[]
  /** Vendor invoice + 1099-NEC YTD tracking for maintenance jobs. */
  invoiceSection: WorkflowPipelineInvoiceSection | null
  resident: WorkflowPipelineResident | null
  vendor: WorkflowPipelineVendor | null
  property: WorkflowPipelineProperty
  attachments: WorkflowPipelineAttachment[]
  /** Vendor close-out photos (`completion_photo_paths`). */
  vendorAttachments: WorkflowPipelineAttachment[]
  maintenanceRequestId: string | null
  conversationId: string | null
  /** Vendor job SMS (`vendor_alert`), when separate from the resident intake thread. */
  vendorConversationId: string | null
  uloThread: WorkflowUloThreadInput | null
  isMaintenanceWorkflow?: boolean
  isMoveOutWorkflow?: boolean
  moveOutProgressPercent?: number
  moveOutDateLabel?: string
  sourceLeaseRenewalRunId?: string | null
  /** Inspection-report visit: sibling fail items for the report-scoped rail. */
  inspectionGroup?: {
    reportId: string
    reportRef: string
    progressLabel: string
    items: Array<{
      ticketId: string
      workOrderRef: string
      label: string
      statusLabel: string
      runId: string | null
    }>
  } | null
  /**
   * Active Tasks board stage + vendor — used by right-rail override dropdowns
   * (same mutations as kanban drag / Move to…).
   */
  kanbanStage: WorkflowKanbanStageId | null
  templateId: string
  assignedVendorId: string | null
  assignedVendorName: string | null
  vendorWorkStatus: string | null
  scheduledAt: string | null
  scheduleConfirmedAt: string | null
  stageMoveTicketIds: string[]
  inspectionReportId: string | null
  /**
   * Work-order activity story under Repair progress (Vendor + Timeline).
   * Same landlord-facing beats as the escalated / SLA right rail.
   */
  activityVendorName: string | null
  activityVendorStatus: string | null
  activityTimeline: SlaOverdueTimelineEntry[]
}

/** Vendor accepted / in progress, but no confirmed visit window yet. */
export function needsVisitNotConfirmedBanner(detail: {
  isMaintenanceWorkflow?: boolean
  vendorWorkStatus: string | null
  scheduleConfirmedAt: string | null
}): boolean {
  if (!detail.isMaintenanceWorkflow) return false
  if (detail.scheduleConfirmedAt?.trim()) return false
  const vws = (detail.vendorWorkStatus ?? '').trim().toLowerCase()
  return vws === 'accepted' || vws === 'in_progress'
}

const RENT_PIPELINE_LABELS = [
  'Rent Due',
  'Landlord Confirmation',
  'Payment History',
] as const

const GENERIC_PIPELINE_LABELS = ['Triggered', 'Classified', 'Routed', 'In Progress', 'Completed'] as const

const MOVE_IN_PIPELINE_LABELS = [
  'Initiated',
  'Occupancy',
  'Checklist Sent',
  'Awaiting Confirm',
  'Utilities',
  'Complete',
] as const

const MOVE_OUT_PIPELINE_LABELS = [
  'Initiated',
  'Instructions Sent',
  'Awaiting Vacate',
  'Turnover',
  'Unit Vacated',
  'Inspection',
  'Deposit',
  'Complete',
] as const

const INSPECTION_PIPELINE_LABELS = [
  'Scheduled',
  'Notice Sent',
  'Awaiting Resident',
  'In Progress',
  'Complete',
] as const

const PRIORITY_BADGE: Record<string, { label: string; className: string }> = {
  urgent: { label: 'HIGH', className: 'border-[#fecaca] bg-[#fff5f5] text-[#c10007]' },
  high: { label: 'HIGH', className: 'border-[#fecaca] bg-[#fff5f5] text-[#c10007]' },
  normal: { label: 'MEDIUM', className: 'border-[#fde68a] bg-[#fffbeb] text-[#a65f00]' },
  medium: { label: 'MEDIUM', className: 'border-[#fde68a] bg-[#fffbeb] text-[#a65f00]' },
  low: { label: 'LOW', className: 'border-[#bbf7d0] bg-[#f0fdf4] text-[#008236]' },
}

function asString(value: unknown): string {
  if (value == null) return ''
  return String(value).trim()
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

function formatWorkOrderRef(run: AdminWorkflowRow): string {
  return formatWorkOrderRefForWorkflowRun(
    run.templateId,
    run.id,
    run.entityId,
    run.entityType,
  )
}

function formatTicketRequestNumberForRun(
  run: AdminWorkflowRow,
  maintenanceRequestId: string | null,
): string {
  const ticketId = maintenanceRequestId?.trim()
  if (ticketId) return formatTicketRequestNumber(ticketId)
  const type = (run.entityType ?? '').trim().toLowerCase()
  if (type === 'maintenance_request' && run.entityId?.trim()) {
    return formatTicketRequestNumber(run.entityId)
  }
  return formatTicketRequestNumber(run.id)
}

function formatCreatedLine(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return 'Created recently'
  const monthDay = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  return `Created ${monthDay}`
}

/** Shared calendar date for Repair timeline columns (e.g. Nov 8, 2026). */
export function formatRepairTimelineDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function formatDueLabel(iso: string | null | undefined): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString('en-US', {
    month: '2-digit',
    day: '2-digit',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function formatVisitWhenLong(iso: string): string | null {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

/** Visit field — · proposed / · confirmed / · passed (never “pending confirm”). */
export function formatVisitLabel(
  scheduledAt: string | null | undefined,
  scheduleConfirmedAt: string | null | undefined,
  options?: {
    scheduleState?: MaintenanceScheduleState | null
    pendingResidentAsk?: PendingResidentScheduleAsk | null
    nowMs?: number
  },
): string {
  const state =
    options?.scheduleState ??
    deriveMaintenanceScheduleState({
      vendorWorkStatus: null,
      scheduledAt,
      scheduleConfirmedAt,
      scheduleStatus: null,
      residentConfirmationStatus: null,
      pendingResidentAsk: options?.pendingResidentAsk,
      nowMs: options?.nowMs,
    })
  const when = resolveScheduleWhenLabel({
    scheduledAt,
    pendingResidentAsk: options?.pendingResidentAsk,
    formatIso: formatVisitWhenLong,
  })
  if (!when) return '—'
  const kind =
    visitLabelKindForScheduleState(state) ??
    (scheduleConfirmedAt?.trim()
      ? 'confirmed'
      : scheduledAt?.trim() || options?.pendingResidentAsk
        ? 'proposed'
        : null)
  if (kind === 'confirmed') return `${when} · confirmed`
  if (kind === 'passed') return `${when} · passed`
  if (kind === 'proposed') return `${when} · proposed`
  return when
}

function firstNameLabel(name: string | null | undefined, fallback: string): string {
  const part = name?.trim().split(/\s+/).filter(Boolean)[0]
  return part || fallback
}

function buildScheduleStatusCopy(input: {
  state: MaintenanceScheduleState
  vendorName: string | null
  residentName: string | null
  scheduledAt: string | null
  pendingResidentAsk: PendingResidentScheduleAsk | null
  nowMs?: number
}): string | null {
  if (input.state === 'none') return null
  const vendor = input.vendorName?.trim() || 'the vendor'
  const resident = firstNameLabel(input.residentName, 'the resident')
  const when =
    resolveScheduleWhenLabel({
      scheduledAt: input.scheduledAt,
      pendingResidentAsk: input.pendingResidentAsk,
      formatIso: formatVisitWhenShort,
    }) || 'that time'
  const askedAgo = formatAskedAgo(input.pendingResidentAsk?.askedAt, input.nowMs)

  switch (input.state) {
    case 'awaiting_resident_first_confirm':
      return askedAgo
        ? `Waiting on ${resident} to confirm ${vendor} for ${when} (asked ${askedAgo}).`
        : `Waiting on ${resident} to confirm ${vendor} for ${when}.`
    case 'awaiting_resident_reschedule_confirm':
      return `${vendor} moved the visit to ${when}. Waiting on ${resident} to confirm.`
    case 'resident_declined_waiting_vendor':
      return `${resident} said that time doesn't work. Waiting on ${vendor} for a new time.`
    case 'window_saved_awaiting_vendor_accept':
      return `Time saved for ${when}. Waiting on ${vendor} to accept the job.`
    case 'proposed_window_passed':
      return `The proposed time (${when}) passed without confirmation.`
    case 'confirmed_upcoming':
      return `${vendor} is scheduled for ${when}.`
    case 'confirmed_visit_passed_no_update':
      return `The visit was ${when} and there's no update from ${vendor}.`
    default:
      return null
  }
}

/** Landlord-facing one-liner for the Active Tasks Overview section. */
export function buildMaintenanceOverviewStatusContext(input: {
  vendorWorkStatus: string | null
  vendorName: string | null
  stageLabel: string
  lastEventMessage: string | null
  escalationReason: string | null
  runStatus: string
  scheduledAt: string | null
  scheduleConfirmedAt: string | null
  scheduleStatus?: string | null
  residentConfirmationStatus?: string | null
  vendorNotifiedAt?: string | null
  pendingResidentAsk?: PendingResidentScheduleAsk | null
  residentName?: string | null
  awaitingResidentRating?: boolean
  reopenedByResident?: boolean
  nowMs?: number
  issueCategory?: string | null
  /** Observation or unapproved Home Check follow-up: do not say a vendor is being matched. */
  holdVendorDispatch?: boolean
  /** Ticket is blocked on landlord YES / 1 / 2 vendor pick. */
  awaitingLandlordChoice?: boolean
  /** Sticky needs_admin + still-assigned pending_accept (display-only signal). */
  stalePendingAcceptNeedsAdmin?: boolean
}): string {
  if (input.holdVendorDispatch) {
    return input.issueCategory === 'home_check_warning'
      ? 'Review this follow-up before any paid work. No vendor is being contacted.'
      : 'Observation only. No vendor is being contacted.'
  }
  const vendor = input.vendorName?.trim() || 'the vendor'
  const resident = firstNameLabel(input.residentName, 'the resident')
  const vws = (input.vendorWorkStatus ?? '').trim().toLowerCase()

  // Landlord choice wins over stale pending_accept (e.g. probe NO that didn't
  // flip vendor_work_status yet, or status lag after decline).
  if (input.awaitingLandlordChoice) {
    if (vws === 'declined' || vws === 'pending_accept') {
      return input.vendorName?.trim()
        ? `${vendor} declined. Waiting for you to choose a replacement vendor.`
        : 'Waiting for you to choose a vendor for this work order.'
    }
    return 'Waiting for you to choose a vendor for this work order.'
  }

  // Sticky needs_admin with a dead pending_accept assignment — not ordinary waiting.
  if (input.stalePendingAcceptNeedsAdmin) {
    return input.vendorName?.trim()
      ? `${vendor} never accepted. Vendor unresponsive — needs a new vendor choice.`
      : STALE_PENDING_ACCEPT_NEEDS_ADMIN_CONTEXT
  }

  if (input.reopenedByResident) {
    return 'Reopened by the resident'
  }

  if (vws === 'completed' || vws === 'cancelled') {
    if (vws === 'completed' && input.awaitingResidentRating) {
      return `Work done. Waiting on ${resident}'s 1–5 rating to close the job.`
    }
    if (vws === 'completed') {
      return input.vendorName?.trim()
        ? `Work marked complete by ${vendor}.`
        : 'Work marked complete.'
    }
    return 'This work order was cancelled.'
  }

  if ((input.runStatus ?? '').trim().toLowerCase() === 'escalated') {
    const plain = formatLandlordEscalationReason(
      input.escalationReason,
      input.issueCategory,
    )
    if (plain) return plain
  }

  const scheduleState = deriveMaintenanceScheduleState({
    vendorWorkStatus: input.vendorWorkStatus,
    scheduledAt: input.scheduledAt,
    scheduleConfirmedAt: input.scheduleConfirmedAt,
    scheduleStatus: input.scheduleStatus,
    residentConfirmationStatus: input.residentConfirmationStatus,
    vendorNotifiedAt: input.vendorNotifiedAt,
    pendingResidentAsk: input.pendingResidentAsk,
    nowMs: input.nowMs,
  })
  const scheduleCopy = buildScheduleStatusCopy({
    state: scheduleState,
    vendorName: input.vendorName,
    residentName: input.residentName ?? null,
    scheduledAt: input.scheduledAt,
    pendingResidentAsk: input.pendingResidentAsk ?? null,
    nowMs: input.nowMs,
  })
  if (scheduleCopy) {
    if (vws === 'in_progress' && scheduleState === 'confirmed_upcoming') {
      const visit = formatVisitLabel(input.scheduledAt, input.scheduleConfirmedAt, {
        scheduleState,
        pendingResidentAsk: input.pendingResidentAsk,
        nowMs: input.nowMs,
      })
      return `Repair in progress with ${vendor}. Visit ${visit}.`
    }
    return scheduleCopy
  }

  switch (vws) {
    case 'pending_accept':
      return `Waiting for ${vendor} to accept this work order.`
    case 'accepted':
      return `${vendor} accepted. Ulo is coordinating a visit time with the resident.`
    case 'in_progress':
      return `Repair is in progress with ${vendor}.`
    case 'declined':
      return `${vendor} declined. Ulo is looking for another vendor.`
    case 'unassigned':
    case '':
      return 'No vendor assigned yet. Ulo is matching someone for this repair.'
    default:
      break
  }

  const last = input.lastEventMessage?.trim()
  if (last && last.length <= 160) return last
  return `Current stage: ${input.stageLabel}.`
}

/**
 * One landlord-facing Issue details narrative — prose only, no labeled scrap
 * lines (Serves:/Flag:/Location:). Serves-floor belongs on the Location side field.
 */
export function composeIssueDetailsNarrative(input: {
  reportedDetail: string | null
  displayDescription: string | null
  triageFlags: string[]
  availability: string | null
  needsClarification: string | null
  rawFallback: string
}): string {
  const paragraphs: string[] = []
  const reported = input.reportedDetail?.trim() || ''
  if (reported) {
    paragraphs.push(reported)
  } else {
    const cleaned = (input.displayDescription ?? '')
      .split('\n')
      .map((line) => line.trim())
      .filter(
        (line) =>
          line &&
          !/^(Serves|Location|Equipment|Flag|Safety|Resident availability|Clarify):/i.test(
            line,
          ),
      )
      .join('\n')
      .trim()
    if (cleaned) paragraphs.push(cleaned)
  }

  for (const flag of input.triageFlags) {
    const text = flag.trim()
    if (text) paragraphs.push(text)
  }

  const availability = input.availability?.trim()
  if (availability) {
    paragraphs.push(`Resident availability: ${availability}.`.replace(/\.\.$/, '.'))
  }

  const clarify = input.needsClarification?.trim()
  if (clarify) {
    paragraphs.push(`Still need to clarify: ${clarify.replace(/\.$/, '')}.`)
  }

  return paragraphs.join('\n\n').trim() || input.rawFallback.trim() || ''
}

/** Location side value — physical place, with serves-floor when it adds new info. */
export function formatIssueLocationWithServes(
  location: string | null | undefined,
  servesFloor: string | null | undefined,
): string {
  const loc = location?.trim() || ''
  const serves = servesFloor?.trim() || ''
  if (loc && serves) {
    const locLower = loc.toLowerCase()
    const servesLower = serves.toLowerCase()
    if (
      locLower.includes(servesLower) ||
      locLower.includes('serves') ||
      locLower.includes('serving')
    ) {
      return loc
    }
    return `${loc} · serves ${serves}`
  }
  if (loc) return loc
  if (serves) return `Serves ${serves}`
  return ''
}

/** Status chip value for Active Tasks Overview (not the kanban column alone). */
export function buildMaintenanceOverviewStatusLabel(input: {
  vendorWorkStatus: string | null
  awaitingLandlordChoice?: boolean
  stalePendingAcceptNeedsAdmin?: boolean
}): string {
  if (input.awaitingLandlordChoice) {
    return 'Needs your vendor choice'
  }
  if (input.stalePendingAcceptNeedsAdmin) {
    return STALE_PENDING_ACCEPT_NEEDS_ADMIN_STATUS_LABEL
  }
  return vendorWorkStatusChipLabel(input.vendorWorkStatus)
}

function buildProgressSteps(labels: readonly string[], activeIndex: number): WorkflowPipelineStep[] {
  return labels.map((label, index) => {
    const stepNumber = index + 1
    let state: WorkflowPipelineStepState = 'upcoming'
    if (stepNumber < activeIndex) state = 'complete'
    else if (stepNumber === activeIndex) state = 'active'
    return { label, state }
  })
}

function progressCaptionFromSteps(steps: WorkflowPipelineStep[]): string {
  const activeIndex = steps.findIndex((step) => step.state === 'active')
  const lastCompleteIndex = steps.reduce(
    (lastIndex, step, index) => (step.state === 'complete' ? index : lastIndex),
    -1,
  )
  const progressIndex = activeIndex >= 0 ? activeIndex : Math.max(0, lastCompleteIndex)
  return `Step ${progressIndex + 1} of ${steps.length}`
}

function ticketCompletionPhotoPaths(ticket: Record<string, unknown> | null): string[] {
  const completion = ticket?.completion_photo_paths
  if (!Array.isArray(completion)) return []
  return completion.map((entry) => asString(entry)).filter(Boolean)
}

/**
 * Work-phase label for the third repair-progress step.
 * Uses saved schedule when present; otherwise reflects work underway.
 */
export function maintenanceRepairWorkPhaseLabel(input: {
  scheduledAt: string | null | undefined
  vendorWorkStatus: string | null | undefined
  hasCompletionPhotos?: boolean
}): string {
  // Visit window is the clearest landlord signal when present.
  if (input.scheduledAt?.trim()) return 'Scheduled'
  // Only label this step "Completion photos" when close-out photos are on the ticket
  // (that is the step that collects them — not intake report photos).
  if (input.hasCompletionPhotos) return 'Completion photos'
  return 'In progress'
}

/**
 * Four board-aligned repair steps. Caption count and visible steps share this array.
 * 1 Reported · 2 Awaiting vendor · 3 Scheduled | In progress | Completion photos · 4 Complete
 */
export function buildMaintenanceRepairProgressSteps(input: {
  kanbanStage: WorkflowKanbanStageId
  vendorWorkStatus: string | null | undefined
  scheduledAt: string | null | undefined
  hasCompletionPhotos?: boolean
}): WorkflowPipelineStep[] {
  const workLabel = maintenanceRepairWorkPhaseLabel({
    scheduledAt: input.scheduledAt,
    vendorWorkStatus: input.vendorWorkStatus,
    hasCompletionPhotos: input.hasCompletionPhotos,
  })
  const labels = ['Reported', 'Awaiting vendor', workLabel, 'Complete'] as const
  const activeIndex =
    input.kanbanStage === 'completed'
      ? 4
      : input.kanbanStage === 'in_progress'
        ? 3
        : input.kanbanStage === 'assigned'
          ? 2
          : 1
  return buildProgressSteps(labels, activeIndex)
}

/** Who acts next — only from saved fields. */
export function buildMaintenanceRepairNextAction(input: {
  vendorWorkStatus: string | null
  vendorName: string | null
  scheduledAt: string | null
  scheduleConfirmedAt: string | null
  scheduleStatus?: string | null
  residentConfirmationStatus?: string | null
  vendorNotifiedAt?: string | null
  pendingResidentAsk?: PendingResidentScheduleAsk | null
  residentName?: string | null
  awaitingResidentRating?: boolean
  reopenedByResident?: boolean
  nowMs?: number
  awaitingLandlordChoice?: boolean
  stalePendingAcceptNeedsAdmin?: boolean
  hasCompletionPhotos?: boolean
  holdVendorDispatch?: boolean
}): string | null {
  if (input.holdVendorDispatch) {
    return 'Review the Home Check before contacting a vendor.'
  }
  const vendor = input.vendorName?.trim() || null
  const resident = firstNameLabel(input.residentName, 'the resident')
  const vws = (input.vendorWorkStatus ?? '').trim().toLowerCase()

  if (input.awaitingLandlordChoice) {
    return null
  }

  if (input.stalePendingAcceptNeedsAdmin) {
    return vendor ? `${vendor} never accepted.` : null
  }

  if (input.reopenedByResident) {
    return 'Reopened by the resident'
  }

  if (vws === 'completed') {
    if (input.awaitingResidentRating) {
      return `Work done. Waiting on ${resident}'s 1–5 rating to close the job.`
    }
    return vendor ? `Work marked complete by ${vendor}.` : 'Work marked complete.'
  }
  if (vws === 'cancelled') {
    return 'This work order was cancelled.'
  }

  const scheduleState = deriveMaintenanceScheduleState({
    vendorWorkStatus: input.vendorWorkStatus,
    scheduledAt: input.scheduledAt,
    scheduleConfirmedAt: input.scheduleConfirmedAt,
    scheduleStatus: input.scheduleStatus,
    residentConfirmationStatus: input.residentConfirmationStatus,
    vendorNotifiedAt: input.vendorNotifiedAt,
    pendingResidentAsk: input.pendingResidentAsk,
    nowMs: input.nowMs,
  })
  const scheduleCopy = buildScheduleStatusCopy({
    state: scheduleState,
    vendorName: input.vendorName,
    residentName: input.residentName ?? null,
    scheduledAt: input.scheduledAt,
    pendingResidentAsk: input.pendingResidentAsk ?? null,
    nowMs: input.nowMs,
  })
  if (scheduleCopy) return scheduleCopy

  if (vws === 'pending_accept') {
    return vendor
      ? `Waiting for ${vendor} to accept. No action needed.`
      : 'Waiting for a vendor to accept. No action needed.'
  }

  if (vws === 'declined') {
    return vendor ? `${vendor} declined.` : null
  }

  if (vws === 'unassigned' || !vws) {
    return null
  }

  if (vws === 'accepted') {
    return vendor
      ? `${vendor} accepted. Ulo is coordinating a visit time with the resident.`
      : 'Vendor accepted. Ulo is coordinating a visit time with the resident.'
  }

  if (vws === 'in_progress') {
    if (input.hasCompletionPhotos) {
      return vendor
        ? `${vendor} uploaded completion photos. No action needed.`
        : 'Completion photos are on file. No action needed.'
    }
    return vendor ? `Repair is in progress with ${vendor}.` : 'Repair is in progress.'
  }

  return vendor ? `Assigned to ${vendor}.` : 'Repair is open.'
}

/** Compact visit time from saved ISO — never invents a slot. */
function formatVisitWhenShort(scheduledAt: string): string | null {
  const date = new Date(scheduledAt)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function deriveRentPipelineIndex(
  row: AdminWorkflowRow,
  metadata: Record<string, unknown>,
): number {
  const stepState =
    metadata.step_state && typeof metadata.step_state === 'object' && !Array.isArray(metadata.step_state)
      ? (metadata.step_state as Record<string, unknown>)
      : {}
  const rentStatus = asString(metadata.rent_status || stepState.rent_status).toLowerCase()
  const paymentMethod = asString(stepState.payment_method || metadata.payment_method)
  if (row.status === 'completed' || rentStatus === 'paid' || paymentMethod) return 3
  if (rentStatus === 'unpaid' || rentStatus === 'partial') return 2
  const ask = asString(metadata.landlord_receipt_ask_status || stepState.landlord_receipt_ask_status)
  if (ask && ask !== 'pending' && ask !== 'asked') return 2
  return 1
}

function deriveMoveInPipelineIndex(row: AdminWorkflowRow): number {
  const step = lifecycleStepKey(row)
  if (row.status === 'completed' || step === 'completed' || step === 'logged') return 6
  if (step === 'utilities_confirmed') return 5
  if (step === 'awaiting_confirm' || row.status === 'escalated') return 4
  if (step === 'checklist_sent') return 3
  if (step === 'occupancy_registered') return 2
  return 1
}

function deriveMoveOutPipelineIndex(row: AdminWorkflowRow): number {
  const step = lifecycleStepKey(row)
  if (row.status === 'completed' || step === 'completed' || step === 'logged') return 8
  if (step === 'deposit_pending') return 7
  if (step === 'inspection_scheduled') return 6
  if (step === 'unit_vacated') return 5
  if (step === 'turnover_in_progress' || step === 'turnover_tasks') return 4
  if (step === 'awaiting_vacate' || row.status === 'escalated') return 3
  if (step === 'notice_sent') return 2
  return 1
}

function deriveInspectionPipelineIndex(row: AdminWorkflowRow): number {
  const step = lifecycleStepKey(row)
  if (row.status === 'completed' || step === 'completed' || step === 'logged') return 5
  if (step === 'in_progress' || step === 'rescheduled' || step === 'no_show') return 4
  if (step === 'awaiting_resident' || step === 'awaiting_completion' || row.status === 'escalated') {
    return 3
  }
  if (step === 'notice_sent') return 2
  return 1
}

function deriveLifecyclePipeline(
  row: AdminWorkflowRow,
  metadata: Record<string, unknown> = {},
): { labels: readonly string[]; index: number } {
  if (row.templateId === 'rent_collection') {
    return { labels: RENT_PIPELINE_LABELS, index: deriveRentPipelineIndex(row, metadata) }
  }
  if (row.templateId === 'move_in') {
    return { labels: MOVE_IN_PIPELINE_LABELS, index: deriveMoveInPipelineIndex(row) }
  }
  if (row.templateId === 'move_out') {
    return { labels: MOVE_OUT_PIPELINE_LABELS, index: deriveMoveOutPipelineIndex(row) }
  }
  if (row.templateId === 'inspection') {
    return { labels: INSPECTION_PIPELINE_LABELS, index: deriveInspectionPipelineIndex(row) }
  }
  return { labels: GENERIC_PIPELINE_LABELS, index: deriveGenericPipelineIndex(row) }
}

function deriveGenericPipelineIndex(row: AdminWorkflowRow): number {
  const stage = deriveWorkflowKanbanStage(row)
  if (stage === 'completed') return 5
  if (stage === 'in_progress') return 4
  if (stage === 'assigned') return 3
  if (stage === 'new_intake') return 2
  return 2
}

function categoryBadge(category: WorkflowKanbanCategory) {
  return WORKFLOW_CATEGORY_BADGE[category]
}

function stageBadge(stage: ReturnType<typeof deriveWorkflowKanbanStage>) {
  const label = WORKFLOW_STAGE_LABEL[stage]
  const className =
    stage === 'completed'
      ? 'border-[#bbf7d0] bg-[#f0fdf4] text-[#008236]'
      : stage === 'in_progress'
        ? 'border-[#dbeafe] bg-[#eff6ff] text-[#1447e6]'
        : stage === 'assigned'
          ? 'border-[#e9d5ff] bg-[#faf5ff] text-[#7c3aed]'
          : 'border-[#dbeafe] bg-[#eff6ff] text-[#1447e6]'
  return { label: label.toUpperCase(), className }
}

function formatCategoryLabel(raw: string | null | undefined): string {
  return formatVendorTradeLabel(raw, { emptyLabel: 'General' })
}

function buildConciseWorkOrderTitle(input: {
  description: string
  issueCategory: string
  fallback: string
  issueHeadline?: string | null
}): string {
  const headline = (input.issueHeadline ?? '').trim()
  if (
    headline &&
    !/^maintenance issue$/i.test(headline) &&
    !/^(?:a |an )?(plumbing|hvac|electrical|appliance) issue$/i.test(headline)
  ) {
    return headline.charAt(0).toUpperCase() + headline.slice(1)
  }
  const summary = generateIssueSummary(input.description, {
    format: 'title',
    category: input.issueCategory,
    maxChars: 50,
  })
  if (
    summary &&
    !/^maintenance issue$/i.test(summary) &&
    !/^(?:a |an )?(plumbing|hvac|electrical|appliance) issue$/i.test(summary)
  ) {
    return summary
  }
  return formatCategoryLabel(input.issueCategory) || input.fallback || 'Work order'
}

function formatCurrency(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '—'
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value)
}

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

/** Invoice total when labor/material/tax or an explicit total is present. */
function invoiceTotalFromRow(raw: Record<string, unknown>): number | null {
  const total = asFiniteNumber(raw.total_cost ?? raw.invoice_total ?? raw.amount)
  if (total != null) return total
  const labor = asFiniteNumber(raw.labor_cost)
  const material = asFiniteNumber(raw.material_cost ?? raw.materials_cost)
  const tax = asFiniteNumber(raw.tax_amount ?? raw.tax)
  if (labor == null && material == null && tax == null) return null
  return (labor ?? 0) + (material ?? 0) + (tax ?? 0)
}

function invoiceStatusLabel(status: string): string {
  switch (status) {
    case 'approved':
      return 'Paid'
    case 'submitted':
      return 'Ready to pay'
    case 'rejected':
      return 'Disputed'
    case 'draft':
      return 'Draft'
    default:
      return status ? status.replace(/_/g, ' ') : '—'
  }
}

/** Sum of landlord-approved invoice totals for a vendor in the current calendar year. */
export async function fetchVendorYtdPaidTotal(params: {
  landlordId: string
  vendorId: string
}): Promise<number | null> {
  const { supabase } = await import('@/lib/supabase')
  if (!supabase) return null
  const landlordId = params.landlordId.trim()
  const vendorId = params.vendorId.trim()
  if (!landlordId || !vendorId) return null

  const yearStart = new Date(new Date().getFullYear(), 0, 1).toISOString()
  const { data, error } = await supabase
    .from('maintenance_invoices')
    .select('total_cost')
    .eq('landlord_id', landlordId)
    .eq('vendor_id', vendorId)
    .eq('status', 'approved')
    .gte('approved_at', yearStart)

  if (error) {
    console.warn('[workflow-pipeline] vendor YTD paid total', error.message)
    return null
  }

  let sum = 0
  for (const row of data ?? []) {
    const amount = asFiniteNumber((row as Record<string, unknown>).total_cost)
    if (amount != null && amount > 0) sum += amount
  }
  return sum
}

async function buildInvoiceSection(
  invoice: Record<string, unknown> | null,
  vendorId: string | null,
): Promise<WorkflowPipelineInvoiceSection | null> {
  if (!invoice) return null
  const status = asString(invoice.status).toLowerCase() || 'submitted'
  const totalCost = invoiceTotalFromRow(invoice)
  const paid = isMaintenanceInvoicePaidFromRow(invoice).paid

  let ytdPaidTotal: number | null = null
  let necTrackingNote: string | null = null
  if (paid && vendorId) {
    ytdPaidTotal = await fetchVendorYtdPaidTotal({
      landlordId: getActiveLandlordId(),
      vendorId,
    })
    necTrackingNote = 'Cumulative payment total updated for 1099-NEC tracking.'
  }

  return {
    status,
    statusLabel: invoiceStatusLabel(status),
    laborCost: asFiniteNumber(invoice.labor_cost),
    materialCost: asFiniteNumber(invoice.material_cost ?? invoice.materials_cost),
    taxAmount: asFiniteNumber(invoice.tax_amount ?? invoice.tax),
    totalCost,
    invoiceNumber: asString(invoice.invoice_number) || null,
    ytdPaidTotal,
    necTrackingNote,
  }
}

function resolveEstimatedCost(
  ticket: Record<string, unknown> | null,
  invoice: Record<string, unknown> | null,
  metadata: Record<string, unknown>,
): number | null {
  const invoiceTotal = invoice ? invoiceTotalFromRow(invoice) : null
  if (invoiceTotal != null && invoiceTotal > 0) return invoiceTotal

  const recognized = ticket ? asFiniteNumber(ticket.recognized_spend_amount) : null
  if (recognized != null && recognized > 0) return recognized

  const metadataCost = asFiniteNumber(metadata.estimated_cost)
  if (metadataCost != null && metadataCost > 0) return metadataCost

  if (!ticket) return null

  const ticketInvoiceTotal = invoiceTotalFromRow(ticket)
  if (ticketInvoiceTotal != null && ticketInvoiceTotal > 0) return ticketInvoiceTotal

  return null
}

function dash(value: string | null | undefined): string {
  const trimmed = value?.trim() ?? ''
  return trimmed || '—'
}

async function buildPropertyBlock(
  row: AdminWorkflowRow,
  metadata: Record<string, unknown>,
  ticket: Record<string, unknown> | null,
): Promise<WorkflowPipelineProperty> {
  const propertyLabel = row.propertyLabel || asString(metadata.building)
  const unit = row.unitLabel || asString(metadata.unit_label) || asString(ticket?.unit)
  const found = propertyLabel
    ? await findPropertyByName(getActiveLandlordId(), propertyLabel)
    : { ok: true as const, property: null }
  const record = found.ok ? found.property : null
  const accessProfile = await loadPropertyAccessCandidates([
    propertyLabel,
    record?.name ?? null,
  ])
  const ticketAccess = asString(ticket?.access_instructions)
  const profileText = accessProfile ? formatPropertyAccessPlainText(accessProfile) : ''
  const accessText = profileText || ticketAccess
  const entryCode = accessProfile?.gateCode || accessProfile?.lockboxCode || ''
  const accessRows = accessProfile ? propertyAccessDisplayRows(accessProfile) : []
  const street = record ? propertyRecordToAddressLine(record) : null
  const locationLine = formatLocationWithOptionalUnit({
    propertyLabel,
    unitLabel: unit,
    propertyType: record?.propertyType,
  })

  return {
    id: record?.id?.trim() || null,
    property: dash(record?.name || propertyLabel),
    building: dash(propertyLabel),
    address: dash(street || locationLine),
    unit: dash(formatBareUnitLabel(unit, record?.propertyType)),
    manager: dash(record?.managerName || accessProfile?.superintendentContact),
    access: dash(accessText),
    entryCode: dash(entryCode),
    accessRows,
  }
}

function formatAttachmentTimestamp(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return 'From SMS'
  return date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function syntheticConversationPhotoAttachments(
  _description: string,
  _issueCategory: string,
  _residentName: string,
): WorkflowPipelineAttachment[] {
  return []
}

function isBrowserUnsafeMediaUrl(url: string): boolean {
  return isProviderAuthMediaUrl(url)
}

async function signMaintenanceUploadPaths(
  photoPaths: unknown,
  opts: {
    sizeLabel: string
    captionPrefix: string
    nameFallbackPrefix: string
  },
): Promise<WorkflowPipelineAttachment[]> {
  const paths = normalizeMediaRefs(photoPaths)
  if (paths.length === 0) return []

  const resolvedByPath = await resolveSmsMediaForMessages(paths.map((path) => [path]))
  const items: WorkflowPipelineAttachment[] = []
  let mediaIndex = 0
  for (let i = 0; i < paths.length; i += 1) {
    const path = paths[i]
    const media = resolvedByPath[i]?.[0]
    mediaIndex += 1
    const kind = media?.kind === 'video'
      ? 'video'
      : media?.kind === 'audio'
        ? 'audio'
        : media?.kind === 'document'
          ? 'document'
          : 'image'
    const noun = media?.label || (kind === 'video' ? 'video' : kind === 'audio' ? 'audio' : kind === 'document' ? 'document' : 'photo')
    items.push({
      name: path.split('/').pop() || `${opts.nameFallbackPrefix}-${mediaIndex}`,
      sizeLabel: opts.sizeLabel,
      kind,
      url: media?.url || undefined,
      downloadUrl: media?.downloadUrl || media?.url || undefined,
      previewStatus: media?.previewStatus ?? 'unavailable',
      storagePath: media?.storagePath,
      caption: `${opts.captionPrefix} · ${noun} ${mediaIndex}`,
    })
  }
  return items
}

async function loadTicketPhotoPathAttachments(
  enrichment: TicketEnrichment,
  residentName: string,
): Promise<WorkflowPipelineAttachment[]> {
  return signMaintenanceUploadPaths(enrichment.ticket?.photo_paths, {
    sizeLabel: 'From request',
    captionPrefix: residentName,
    nameFallbackPrefix: 'tenant-photo',
  })
}

async function loadVendorCompletionPhotoAttachments(
  enrichment: TicketEnrichment,
  vendorName: string,
): Promise<WorkflowPipelineAttachment[]> {
  return signMaintenanceUploadPaths(enrichment.ticket?.completion_photo_paths, {
    sizeLabel: 'Vendor completion',
    captionPrefix: vendorName || 'Vendor',
    nameFallbackPrefix: 'vendor-completion',
  })
}

async function loadInboundSmsPhotoAttachments(
  enrichment: TicketEnrichment,
  residentName: string,
): Promise<WorkflowPipelineAttachment[]> {
  const fromTicket = await loadTicketPhotoPathAttachments(enrichment, residentName)
  const ticketPaths = new Set(normalizeMediaRefs(enrichment.ticket?.photo_paths))

  // Curated photo_paths + a later sibling WO: trust photo_paths only. Otherwise
  // late MMS on the shared resident thread (paint split, rent receipt, etc.)
  // keeps rendering on the earlier ticket via the SMS time-window merge.
  if (
    shouldSkipUnclaimedSmsMediaExtras({
      thisTicketPhotoPathCount: ticketPaths.size,
      nextTicketCreatedAt: enrichment.nextTicketCreatedAt,
    })
  ) {
    return fromTicket
  }

  const { supabase } = await import('@/lib/supabase')
  if (!supabase) return fromTicket

  const landlordId = getActiveLandlordId()
  const conversationIds =
    enrichment.conversationIds.length > 0
      ? enrichment.conversationIds
      : enrichment.conversationId
        ? [enrichment.conversationId]
        : []
  if (conversationIds.length === 0) return fromTicket

  const { data: messages } = await supabase
    .from('sms_messages')
    .select('body, direction, media_urls, created_at')
    .eq('landlord_id', landlordId)
    .in('conversation_id', conversationIds)
    .eq('direction', 'inbound')
    .order('created_at', { ascending: true })

  const extraRefs: string[] = []
  const metaByRef = new Map<string, { body: string; sentAt: string }>()
  for (const message of (messages ?? []) as Record<string, unknown>[]) {
    if (
      !smsMessageBelongsToWorkOrder({
        messageCreatedAt: asString(message.created_at),
        ticketCreatedAt: enrichment.ticketCreatedAt,
        nextTicketCreatedAt: enrichment.nextTicketCreatedAt,
      })
    ) {
      continue
    }
    const body = asString(message.body)
    const sentAt = formatAttachmentTimestamp(asString(message.created_at))
    for (const ref of normalizeMediaRefs(message.media_urls)) {
      if (ticketPaths.has(ref) || extraRefs.includes(ref)) continue
      if (isBrowserUnsafeMediaUrl(ref)) continue
      extraRefs.push(ref)
      metaByRef.set(ref, { body, sentAt })
    }
  }

  const claimedByOtherTicketPhotoPaths = new Set<string>()
  const ticketId = enrichment.maintenanceRequestId?.trim() || ''
  if (extraRefs.length > 0 && ticketId) {
    const { data: siblingRows } = await supabase
      .from('maintenance_requests')
      .select('id, photo_paths')
      .eq('landlord_id', landlordId)
      .neq('id', ticketId)
      .overlaps('photo_paths', extraRefs)
    for (const row of (siblingRows ?? []) as Record<string, unknown>[]) {
      for (const path of normalizeMediaRefs(row.photo_paths)) {
        claimedByOtherTicketPhotoPaths.add(path)
      }
    }
  }

  const allowedExtraRefs = extraRefs.filter((ref) =>
    smsMediaExtraAllowedOnWorkOrder({
      ref,
      thisTicketPhotoPaths: ticketPaths,
      claimedByOtherTicketPhotoPaths,
    }),
  )

  const extraItems: WorkflowPipelineAttachment[] = []
  const resolvedByRef = await resolveSmsMediaForMessages(allowedExtraRefs.map((ref) => [ref]))
  let mediaIndex = fromTicket.length
  for (let i = 0; i < allowedExtraRefs.length; i += 1) {
    const ref = allowedExtraRefs[i]
    const media = resolvedByRef[i]?.[0]
    mediaIndex += 1
    const kind = media?.kind === 'video'
      ? 'video'
      : media?.kind === 'audio'
        ? 'audio'
        : media?.kind === 'document'
          ? 'document'
          : 'image'
    const noun = media?.label || kind
    const meta = metaByRef.get(ref)
    extraItems.push({
      name: (isStorageMediaPath(ref) ? ref.split('/').pop() : '') || `conversation-${noun}-${mediaIndex}`,
      sizeLabel: meta?.sentAt || 'From SMS',
      kind,
      url: media?.url || undefined,
      downloadUrl: media?.downloadUrl || media?.url || undefined,
      previewStatus: media?.previewStatus ?? 'unavailable',
      storagePath: media?.storagePath,
      caption: meta?.body || `${residentName} · ${noun} ${mediaIndex}`,
    })
  }

  return [...fromTicket, ...extraItems]
}

function syntheticInspectionConversationPhotos(
  _input: InspectionUloThreadInput,
  _residentName: string,
): WorkflowPipelineAttachment[] {
  return []
}

async function loadInspectionConversationAttachments(
  enrichment: TicketEnrichment,
  input: InspectionUloThreadInput,
  residentName: string,
): Promise<WorkflowPipelineAttachment[]> {
  const fromSms = await loadInboundSmsPhotoAttachments(enrichment, residentName)
  if (fromSms.length > 0) return fromSms
  return syntheticInspectionConversationPhotos(input, residentName)
}

async function loadMaintenanceConversationAttachments(
  enrichment: TicketEnrichment,
  description: string,
  issueCategory: string,
  residentName: string,
): Promise<WorkflowPipelineAttachment[]> {
  const fromSms = await loadInboundSmsPhotoAttachments(enrichment, residentName)
  if (fromSms.length > 0) return fromSms
  return syntheticConversationPhotoAttachments(description, issueCategory, residentName)
}

type TicketEnrichment = {
  ticket: Record<string, unknown> | null
  invoice: Record<string, unknown> | null
  vendorId: string | null
  vendorName: string | null
  vendorPhone: string | null
  vendorEmail: string | null
  vendorCategory: string | null
  resident: Record<string, unknown> | null
  conversationId: string | null
  vendorConversationId: string | null
  conversationIds: string[]
  maintenanceRequestId: string | null
  ticketCreatedAt: string | null
  nextTicketCreatedAt: string | null
  pendingResidentAsk: PendingResidentScheduleAsk | null
  awaitingResidentRating: boolean
  reopenedByResident: boolean
}

async function loadTicketEnrichment(
  row: AdminWorkflowRow,
  metadata: Record<string, unknown>,
): Promise<TicketEnrichment> {
  const { supabase } = await import('@/lib/supabase')
  if (!supabase) {
    return {
      ticket: null,
      invoice: null,
      vendorId: null,
      vendorName: null,
      vendorPhone: null,
      vendorEmail: null,
      vendorCategory: null,
      resident: null,
      conversationId: null,
      vendorConversationId: null,
      conversationIds: [],
      maintenanceRequestId: null,
      ticketCreatedAt: null,
      nextTicketCreatedAt: null,
      pendingResidentAsk: null,
      awaitingResidentRating: false,
      reopenedByResident: false,
    }
  }

  const landlordId = getActiveLandlordId()
  const ticketId = asString(row.entityId) || asString(metadata.maintenance_request_id)

  let ticket: Record<string, unknown> | null = null
  let invoice: Record<string, unknown> | null = null
  let vendorId: string | null = null
  let vendorName: string | null = null
  let vendorPhone: string | null = null
  let vendorEmail: string | null = null
  let vendorCategory: string | null = null
  let resident: Record<string, unknown> | null = null
  let conversationId = asString(metadata.conversation_id)
  let vendorConversationId: string | null = null
  let conversationIds: string[] = []
  let nextTicketCreatedAt: string | null = null
  let pendingResidentAsk: PendingResidentScheduleAsk | null = null
  let awaitingResidentRating = false
  let reopenedByResident = false
  const intakeCandidates: Array<{ intakeState: unknown; updatedAt: string | null }> = []

  if (ticketId) {
    const { data } = await supabase
      .from('maintenance_requests')
      .select(
        'id, created_at, description, priority, urgency, issue_category, issue_headline, location_detail, unit, due_at, scheduled_at, schedule_confirmed_at, schedule_status, resident_confirmation_status, vendor_notified_at, scheduled_window_text, vendor_work_status, assigned_vendor_id, assigned_at, awaiting_landlord_choice_at, vendor_notify_error, auto_reassign_last_outcome, resident_name, email, resident_phone, estimated_minutes, recognized_spend_amount, spend_status, photo_paths, completion_photo_paths, access_instructions',
      )
      .eq('landlord_id', landlordId)
      .eq('id', ticketId)
      .maybeSingle()
    ticket = (data as Record<string, unknown> | null) ?? null

    const ticketCreatedAt = asString(ticket?.created_at)
    const residentPhone = asString(ticket?.resident_phone)
    if (ticketCreatedAt) {
      let nextQuery = supabase
        .from('maintenance_requests')
        .select('created_at')
        .eq('landlord_id', landlordId)
        .gt('created_at', ticketCreatedAt)
        .order('created_at', { ascending: true })
        .limit(1)
      nextQuery = residentPhone
        ? nextQuery.eq('resident_phone', residentPhone)
        : nextQuery
      const { data: nextRow } = await nextQuery.maybeSingle()
      nextTicketCreatedAt = asString(
        (nextRow as Record<string, unknown> | null)?.created_at,
      ) || null
    }

    const { data: invoiceRow } = await supabase
      .from('maintenance_invoices')
      .select(
        'total_cost, labor_cost, material_cost, tax_amount, status, invoice_number, vendor_id, approved_at',
      )
      .eq('landlord_id', landlordId)
      .eq('maintenance_request_id', ticketId)
      .order('submitted_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    invoice = (invoiceRow as Record<string, unknown> | null) ?? null

    vendorId = asString(ticket?.assigned_vendor_id) || asString(invoice?.vendor_id) || null
    if (vendorId) {
      const { data: vendorRow } = await supabase
        .from('vendors')
        .select('name, phone, email, category')
        .eq('id', vendorId)
        .maybeSingle()
      const vendor = (vendorRow as Record<string, unknown> | null) ?? null
      vendorName = asString(vendor?.name) || null
      vendorPhone = asString(vendor?.phone) || null
      vendorEmail = asString(vendor?.email) || null
      vendorCategory = asString(vendor?.category) || null
    }

    // Resident intake and vendor job SMS are separate threads (same as Messages).
    // Prefer resident for "See thread"; keep vendor id for a dedicated vendor view.
    const { data: convRows } = await supabase
      .from('sms_conversations')
      .select('id, conversation_type, updated_at, resident_id, external_phone_number, intake_state')
      .eq('landlord_id', landlordId)
      .eq('maintenance_request_id', ticketId)
      .order('updated_at', { ascending: false })

    for (const entry of (convRows ?? []) as Record<string, unknown>[]) {
      intakeCandidates.push({
        intakeState: entry.intake_state,
        updatedAt: asString(entry.updated_at) || null,
      })
    }

    const byTicket = ((convRows ?? []) as Record<string, unknown>[]).map((entry) => ({
      id: asString(entry.id),
      conversation_type: asString(entry.conversation_type),
    })).filter((entry) => entry.id)

    // Resident intake often stays linked to the resident, not the ticket id
    // (vendor_alert usually owns maintenance_request_id). Also resolve by resident.
    const residentLookupId = asString(row.residentId)
    let byResident: { id: string; conversation_type: string }[] = []
    if (residentLookupId) {
      const { data: residentConvRows } = await supabase
        .from('sms_conversations')
        .select('id, conversation_type, updated_at, intake_state')
        .eq('landlord_id', landlordId)
        .eq('resident_id', residentLookupId)
        .eq('conversation_type', 'resident_intake')
        .order('updated_at', { ascending: false })
        .limit(5)
      for (const entry of (residentConvRows ?? []) as Record<string, unknown>[]) {
        intakeCandidates.push({
          intakeState: entry.intake_state,
          updatedAt: asString(entry.updated_at) || null,
        })
      }
      byResident = ((residentConvRows ?? []) as Record<string, unknown>[]).map((entry) => ({
        id: asString(entry.id),
        conversation_type: asString(entry.conversation_type) || 'resident_intake',
      })).filter((entry) => entry.id)
    }
    if (byResident.length === 0 && residentPhone) {
      const normalizedPhone = normalizePhoneForDb(residentPhone) ?? residentPhone
      const { data: phoneConvRows } = await supabase
        .from('sms_conversations')
        .select('id, conversation_type, updated_at, external_phone_number, intake_state')
        .eq('landlord_id', landlordId)
        .eq('conversation_type', 'resident_intake')
        .order('updated_at', { ascending: false })
        .limit(25)
      const matchedPhoneRows = ((phoneConvRows ?? []) as Record<string, unknown>[]).filter(
        (entry) => {
          const phone = asString(entry.external_phone_number)
          if (!phone) return false
          const normalized = normalizePhoneForDb(phone) ?? phone
          return normalized === normalizedPhone || phone === residentPhone
        },
      )
      for (const entry of matchedPhoneRows.slice(0, 5)) {
        intakeCandidates.push({
          intakeState: entry.intake_state,
          updatedAt: asString(entry.updated_at) || null,
        })
      }
      byResident = matchedPhoneRows
        .map((entry) => ({
          id: asString(entry.id),
          conversation_type: asString(entry.conversation_type) || 'resident_intake',
        }))
        .filter((entry) => entry.id)
        .slice(0, 5)
    }

    for (const candidate of intakeCandidates) {
      const ask = parsePendingResidentScheduleAsk({
        intakeState: candidate.intakeState,
        ticketId,
        conversationUpdatedAt: candidate.updatedAt,
      })
      if (ask) {
        pendingResidentAsk = ask
        break
      }
    }

    const [{ data: feedbackRow }, { data: reopenRow }] = await Promise.all([
      supabase
        .from('vendor_feedback_requests')
        .select('id, status')
        .eq('landlord_id', landlordId)
        .eq('maintenance_request_id', ticketId)
        .eq('status', 'open')
        .maybeSingle(),
      supabase
        .from('maintenance_work_order_reopens')
        .select('id, triggered_by, new_status')
        .eq('landlord_id', landlordId)
        .eq('maintenance_request_id', ticketId)
        .eq('triggered_by', 'tenant_sms')
        .order('reopened_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ])
    awaitingResidentRating = Boolean(asString((feedbackRow as Record<string, unknown> | null)?.id))
    const reopenStatus = asString(
      (reopenRow as Record<string, unknown> | null)?.new_status,
    ).toLowerCase()
    const currentVws = asString(ticket?.vendor_work_status).toLowerCase()
    reopenedByResident = Boolean(
      asString((reopenRow as Record<string, unknown> | null)?.id) &&
        currentVws &&
        currentVws !== 'completed' &&
        currentVws !== 'cancelled' &&
        reopenStatus !== 'completed' &&
        reopenStatus !== 'cancelled',
    )

    const seen = new Set<string>()
    const rows: { id: string; conversation_type: string }[] = []
    for (const entry of [...byResident, ...byTicket]) {
      if (seen.has(entry.id)) continue
      seen.add(entry.id)
      rows.push(entry)
    }

    const picked = pickPrimaryWorkOrderConversationId(rows, conversationId)
    conversationId = picked.conversationId ?? ''
    vendorConversationId = picked.vendorConversationId

    conversationIds = rows
      .filter((entry) => {
        const type = entry.conversation_type
        return type !== 'ai_copilot' && type !== 'landlord_update'
      })
      .map((entry) => entry.id)
  }

  const residentId = row.residentId
  if (residentId) {
    const { data } = await supabase
      .from('users')
      .select('full_name, email, phone, move_in_date, status, lease_end_date')
      .eq('id', residentId)
      .maybeSingle()
    resident = (data as Record<string, unknown> | null) ?? null
  }

  if (!conversationId && row.id) {
    const { data: convByRun } = await supabase
      .from('sms_conversations')
      .select('id')
      .eq('landlord_id', landlordId)
      .eq('workflow_run_id', row.id)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    conversationId = asString((convByRun as Record<string, unknown> | null)?.id) || conversationId
  }

  if (!conversationId) {
    conversationId = asString(metadata.conversation_id)
  }

  if (conversationId && !conversationIds.includes(conversationId)) {
    conversationIds = [conversationId, ...conversationIds]
  }

  return {
    ticket,
    invoice,
    vendorId,
    vendorName,
    vendorPhone,
    vendorEmail,
    vendorCategory,
    resident,
    conversationId: conversationId || null,
    vendorConversationId,
    conversationIds,
    maintenanceRequestId: ticketId || null,
    ticketCreatedAt: asString(ticket?.created_at) || null,
    nextTicketCreatedAt,
    pendingResidentAsk,
    awaitingResidentRating,
    reopenedByResident,
  }
}

function buildWorkOrderUloThreadInput(
  row: AdminWorkflowRow,
  metadata: Record<string, unknown>,
  enrichment: TicketEnrichment,
): MaintenanceUloThreadInput {
  const ticket = enrichment.ticket
  const residentName =
    asString(enrichment.resident?.full_name) ||
    asString(ticket?.resident_name) ||
    row.residentName ||
    'Resident'
  const description =
    asString(ticket?.description) ||
    row.lastEventMessage ||
    row.escalationReason ||
    'Ulo is coordinating this maintenance request.'
  const urgency =
    asString(ticket?.urgency) || asString(ticket?.priority) || asString(metadata.urgency) || 'normal'
  const issueCategory = asString(ticket?.issue_category) || row.templateType || 'general'
  const startedAtMs = new Date(row.startedAt).getTime()

  return {
    kind: 'maintenance',
    maintenanceRequestId: enrichment.maintenanceRequestId,
    conversationId: enrichment.conversationId,
    workflowRunId: row.id,
    residentId: row.residentId,
    residentName,
    unitLabel: row.unitLabel || asString(ticket?.unit) || '',
    propertyLabel: row.propertyLabel || 'Property',
    description,
    urgency,
    issueCategory,
    vendorName: enrichment.vendorName,
    workOrderRef: formatWorkOrderRef(row),
    startedAtMs: Number.isFinite(startedAtMs) ? startedAtMs : Date.now(),
  }
}

function buildMoveInUloThreadInput(
  row: AdminWorkflowRow,
  metadata: Record<string, unknown>,
  enrichment: TicketEnrichment,
): MoveInUloThreadInput {
  const residentName =
    asString(enrichment.resident?.full_name) || row.residentName || 'Resident'
  const startedAtMs = new Date(row.startedAt).getTime()
  const fallbackMoveInMs = (Number.isFinite(startedAtMs) ? startedAtMs : Date.now()) + 14 * 24 * 60 * 60 * 1000
  const moveInIso = asString(metadata.move_in_date) || asString(enrichment.resident?.move_in_date)

  return {
    kind: 'move_in',
    conversationId: enrichment.conversationId,
    workflowRunId: row.id,
    residentId: row.residentId,
    residentName,
    unitLabel: row.unitLabel || '',
    propertyLabel: row.propertyLabel || 'Property',
    startedAtMs: Number.isFinite(startedAtMs) ? startedAtMs : Date.now(),
    moveInDateMs: parseMoveInDateMs(moveInIso, fallbackMoveInMs),
  }
}

function parseIsoDateMs(iso: string, fallbackMs: number): number {
  if (!iso.trim()) return fallbackMs
  const parsed = new Date(iso.includes('T') ? iso : `${iso.slice(0, 10)}T12:00:00`)
  return Number.isFinite(parsed.getTime()) ? parsed.getTime() : fallbackMs
}

function parseMoveInDateMs(iso: string, fallbackMs: number): number {
  return parseIsoDateMs(iso, fallbackMs)
}

function isInspectionTemplateId(templateId: string): boolean {
  return templateId === 'inspection'
}

function inspectionHasMaintenanceFollowUp(
  row: AdminWorkflowRow,
  metadata: Record<string, unknown>,
): boolean {
  if (metadata.maintenance_request_created === true) return true
  const hay = `${row.lastEventMessage ?? ''} ${row.lastEventType ?? ''}`.toLowerCase()
  return /maintenance|work.?order|ticket|leak|repair|finding/.test(hay)
}

function buildInspectionUloThreadInput(
  row: AdminWorkflowRow,
  metadata: Record<string, unknown>,
  enrichment: TicketEnrichment,
): InspectionUloThreadInput {
  const residentName =
    asString(enrichment.resident?.full_name) || row.residentName || 'Resident'
  const startedAtMs = new Date(row.startedAt).getTime()
  const fallbackScheduledMs =
    (Number.isFinite(startedAtMs) ? startedAtMs : Date.now()) + 5 * 24 * 60 * 60 * 1000
  const scheduledIso = asString(metadata.scheduled_at)
  const inspectionType =
    asString(metadata.inspection_type) ||
    asString(metadata.inspection_classification) ||
    'periodic'

  return {
    kind: 'inspection',
    conversationId: enrichment.conversationId,
    workflowRunId: row.id,
    residentId: row.residentId,
    residentName,
    unitLabel: row.unitLabel || '',
    propertyLabel: row.propertyLabel || 'Property',
    startedAtMs: Number.isFinite(startedAtMs) ? startedAtMs : Date.now(),
    scheduledAtMs: parseIsoDateMs(scheduledIso, fallbackScheduledMs),
    inspectionType,
    hasMaintenanceFollowUp: inspectionHasMaintenanceFollowUp(row, metadata),
  }
}

function buildMoveOutUloThreadInput(
  row: AdminWorkflowRow,
  metadata: Record<string, unknown>,
  enrichment: TicketEnrichment,
): import('@/lib/conversationMonitoring').MoveOutUloThreadInput {
  const residentName =
    asString(enrichment.resident?.full_name) || row.residentName || 'Resident'
  const startedAtMs = new Date(row.startedAt).getTime()
  const moveOutIso =
    asString(metadata.move_out_date) ||
    asString(enrichment.resident?.lease_end_date) ||
    asString(metadata.lease_end_date)

  return {
    kind: 'move_out',
    conversationId: enrichment.conversationId,
    workflowRunId: row.id,
    residentId: row.residentId,
    residentName,
    unitLabel: row.unitLabel || '',
    propertyLabel: row.propertyLabel || 'Property',
    startedAtMs: Number.isFinite(startedAtMs) ? startedAtMs : Date.now(),
    moveOutDateMs: parseIsoDateMs(moveOutIso, Date.now() + 30 * 24 * 60 * 60 * 1000),
    sourceLeaseRenewalRunId: asString(metadata.source_workflow_run_id),
  }
}

function buildWorkflowUloThreadInput(
  row: AdminWorkflowRow,
  metadata: Record<string, unknown>,
  enrichment: TicketEnrichment,
): WorkflowUloThreadInput | null {
  if (workflowTemplateGroupId(row.templateId) === 'maintenance') {
    return buildWorkOrderUloThreadInput(row, metadata, enrichment)
  }
  if (row.templateId === 'move_in') {
    return buildMoveInUloThreadInput(row, metadata, enrichment)
  }
  if (row.templateId === 'move_out') {
    return buildMoveOutUloThreadInput(row, metadata, enrichment)
  }
  if (isInspectionTemplateId(row.templateId)) {
    return buildInspectionUloThreadInput(row, metadata, enrichment)
  }
  return null
}

function workflowInboxPreview(input: WorkflowUloThreadInput): string {
  if (input.kind === 'move_in') {
    const moveInLabel = new Date(input.moveInDateMs).toLocaleDateString(undefined, {
      month: 'long',
      day: 'numeric',
    })
    return `Welcome to ${input.propertyLabel}! We're excited to have you. Your move-in is scheduled for ${moveInLabel}.`
  }

  if (input.kind === 'move_out') {
    const fname = input.residentName.trim().split(/\s+/)[0] || 'there'
    return `Hi ${fname}! We understand you'll be moving out at the end of your lease. We'll use this conversation to help guide you through the move-out process.`
  }

  if (input.kind === 'inspection') {
    const unitPhrase = input.unitLabel ? `Unit ${input.unitLabel}` : 'your unit'
    const fname = input.residentName.trim().split(/\s+/)[0] || 'there'
    return `Hi ${fname} — reply READY when you're ready and I'll guide your ${unitPhrase} inspection over text.`
  }

  const issueLine = input.description.split(/[.!?]/)[0]?.trim() || 'Maintenance request'
  return issueLine.endsWith('.') ? issueLine : `${issueLine}.`
}

export type CommunicationWorkOrderInboxRow = {
  id: string
  name: string
  context: string
  preview: string
  status: string
  lastActivity: number
  uloThread: WorkflowUloThreadInput
}

export async function fetchWorkflowUloThreadInputByRunId(
  runId: string,
): Promise<WorkflowUloThreadInput | null> {
  const data = await fetchAdminWorkflowDashboard()
  const row = collectAdminWorkflowRuns(data).find((entry) => entry.id === runId)
  if (!row) return null

  const metadata = data.runMetadata[row.id] ?? {}
  const enrichment = await loadTicketEnrichment(row, metadata)
  return buildWorkflowUloThreadInput(row, metadata, enrichment)
}

/** @deprecated Use fetchWorkflowUloThreadInputByRunId */
export async function fetchMaintenanceWorkOrderUloThreadInputByRunId(
  runId: string,
): Promise<MaintenanceUloThreadInput | null> {
  const input = await fetchWorkflowUloThreadInputByRunId(runId)
  return input?.kind === 'maintenance' ? input : null
}

/** Maintenance, move-in, and inspection workflow Ulo threads for the admin communication inbox. */
export async function fetchCommunicationWorkOrderInboxRows(): Promise<CommunicationWorkOrderInboxRow[]> {
  const data = await fetchAdminWorkflowDashboard()
  const runs = collectAdminWorkflowRuns(data).filter((row) => {
    if (workflowTemplateGroupId(row.templateId) === 'maintenance') return true
    if (row.templateId === 'move_in') return true
    if (row.templateId === 'move_out') return true
    return isInspectionTemplateId(row.templateId)
  })

  const rows = (
    await Promise.all(
      runs.map(async (row) => {
        const metadata = data.runMetadata[row.id] ?? {}
        const enrichment = await loadTicketEnrichment(row, metadata)
        const uloThread = buildWorkflowUloThreadInput(row, metadata, enrichment)
        if (!uloThread) return null

        const rowForStage: AdminWorkflowRow = {
          ...row,
          vendorWorkStatus:
            asString(enrichment.ticket?.vendor_work_status) || row.vendorWorkStatus,
          assignedVendorId:
            asString(enrichment.ticket?.assigned_vendor_id) || row.assignedVendorId,
        }
        const stage = deriveWorkflowKanbanStage(rowForStage)
        const startedMs = new Date(row.startedAt).getTime()
        const eventMs = row.lastEventAt ? new Date(row.lastEventAt).getTime() : 0
        const anchorMs =
          uloThread.kind === 'move_in'
            ? uloThread.moveInDateMs
            : uloThread.kind === 'move_out'
              ? uloThread.moveOutDateMs
              : uloThread.kind === 'inspection'
                ? uloThread.scheduledAtMs
                : 0
        const lastActivity = Math.max(
          Number.isFinite(startedMs) ? startedMs : 0,
          Number.isFinite(eventMs) ? eventMs : 0,
          anchorMs,
        )

        return {
          id: resolveWorkOrderInboxConversationId(uloThread),
          name: uloThread.residentName,
          context: [uloThread.propertyLabel, uloThread.unitLabel ? `Unit ${uloThread.unitLabel}` : '']
            .filter(Boolean)
            .join(' · '),
          preview: workflowInboxPreview(uloThread),
          status: WORKFLOW_STAGE_LABEL[stage],
          lastActivity: lastActivity || Date.now(),
          uloThread,
        } satisfies CommunicationWorkOrderInboxRow
      }),
    )
  ).filter((row): row is CommunicationWorkOrderInboxRow => row != null)

  return rows.sort((a, b) => b.lastActivity - a.lastActivity)
}

export async function fetchWorkflowPipelineDetail(
  runId: string,
  runs: AdminWorkflowRow[],
  runMetadata: Record<string, Record<string, unknown>> = {},
): Promise<WorkflowPipelineDetail | null> {
  const row = runs.find((entry) => entry.id === runId)
  if (!row) return null

  const metadata = runMetadata[row.id] ?? {}

  // Standalone tenant-notice / zero-checklist inspection_reports card —
  // not a workflow_runs row and not linked to any work order.
  if (
    row.templateId === 'inspection_notice_task' ||
    row.entityType === 'inspection_report'
  ) {
    const category = categoryBadge('inspection')
    const stage = stageBadge('new_intake')
    const lines = String(row.issueDescription ?? '')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
    const nextStep = lines[0] || 'Prepare for inspection'
    const sourceLine =
      lines.find((line) => /^source notice/i.test(line)) || lines[1] || null
    const dateIso =
      lines
        .find((line) => /^inspection date:/i.test(line))
        ?.replace(/^inspection date:\s*/i, '')
        .trim() || null
    return {
      runId: row.id,
      workOrderRef: row.inspectionReportId
        ? formatInspectionReportRef(row.inspectionReportId)
        : 'Inspection',
      ticketRequestNumber: '',
      title: row.templateName,
      categoryLabel: category.label.toUpperCase(),
      categoryClassName: category.className,
      stageLabel: stage.label,
      stageClassName: stage.className,
      priorityLabel: null,
      priorityClassName: null,
      createdLine: formatCreatedLine(row.startedAt),
      reportedDateLabel: formatRepairTimelineDate(row.startedAt),
      estimatedCompletionLabel: formatRepairTimelineDate(dateIso),
      estimatedCostLabel: '—',
      locationLine: [
        row.propertyLabel,
        row.unitLabel ? `Unit ${row.unitLabel}` : null,
      ]
        .filter(Boolean)
        .join(' · '),
      description: nextStep,
      statusContext: sourceLine,
      progressSteps: [
        { label: 'Notice received', state: 'complete' as const },
        { label: 'Prepare for inspection', state: 'active' as const },
        { label: 'Inspection day', state: 'upcoming' as const },
      ],
      progressCaption: 'Prepare for inspection',
      progressNextAction: null,
      overviewFields: [
        { label: 'Type', value: 'Tenant notice inspection' },
        { label: 'Property', value: row.propertyLabel || '—' },
        { label: 'Unit', value: formatBareUnitLabel(row.unitLabel) || '—' },
        {
          label: 'Inspection date',
          value: formatDueLabel(dateIso),
        },
        { label: 'Next step', value: nextStep },
        { label: 'Source', value: sourceLine || '—' },
      ],
      maintenanceDetails: [],
      invoiceSection: null,
      resident: null,
      vendor: null,
      property: await buildPropertyBlock(row, metadata, null),
      attachments: [],
      vendorAttachments: [],
      maintenanceRequestId: null,
      conversationId: null,
      vendorConversationId: null,
      uloThread: null,
      inspectionGroup: null,
      kanbanStage: null,
      templateId: row.templateId,
      assignedVendorId: null,
      assignedVendorName: null,
      vendorWorkStatus: null,
      scheduledAt: null,
      scheduleConfirmedAt: null,
      stageMoveTicketIds: [],
      inspectionReportId: null,
      activityVendorName: null,
      activityVendorStatus: null,
      activityTimeline: [],
    }
  }

  const group = workflowTemplateGroupId(row.templateId)
  const isMaintenance = group === 'maintenance'
  const isMoveOut = row.templateId === 'move_out'

  const enrichment = await loadTicketEnrichment(row, metadata)
  const ticket = enrichment.ticket
  const invoice = enrichment.invoice
  const rowForStage: AdminWorkflowRow = isMaintenance
    ? {
        ...row,
        vendorWorkStatus:
          asString(ticket?.vendor_work_status) || row.vendorWorkStatus,
        assignedVendorId:
          asString(ticket?.assigned_vendor_id) || row.assignedVendorId,
      }
    : row
  const card = buildWorkflowKanbanCard(rowForStage, metadata)
  const category = categoryBadge(card.category)
  const stage = stageBadge(card.stage)
  const urgency = asString(ticket?.urgency) || asString(ticket?.priority) || asString(metadata.urgency)
  const priority = urgency ? PRIORITY_BADGE[urgency.toLowerCase()] ?? null : null

  const moveOutTimeline = isMoveOut ? buildMoveOutTimeline(row, metadata) : undefined
  const moveOutProgress = moveOutTimeline ? moveOutProgressPercent(moveOutTimeline) : undefined
  const moveOutDateLabel = isMoveOut
    ? formatMoveOutDateLabel(
        asString(metadata.move_out_date) || asString(enrichment.resident?.lease_end_date),
      )
    : undefined

  const homeCheckTitle = row.templateId === 'home_check'
    ? 'Home Check'
    : homeCheckWorkOrderTitle(
      asString(ticket?.description),
      asString(ticket?.issue_category) || row.issueCategory,
    )
  const title = homeCheckTitle
    ? homeCheckTitle
    : isMoveOut
    ? moveOutPipelineTitle()
    : row.inspectionReportId &&
        row.inspectionGroupItems &&
        row.inspectionGroupItems.length > 1
      ? `Inspection visit · ${formatInspectionReportRef(row.inspectionReportId)}`
      : buildConciseWorkOrderTitle({
          description: asString(ticket?.description),
          issueCategory: asString(ticket?.issue_category) || row.templateType || 'general',
          fallback: row.templateName || 'Workflow',
          issueHeadline:
            asString(ticket?.issue_headline) || row.issueHeadline || null,
        })

  const inspectionGroup =
    row.inspectionReportId &&
    row.inspectionGroupItems &&
    row.inspectionGroupItems.length > 1
      ? (() => {
          const progress = inspectionGroupProgress(row.inspectionGroupItems)
          return {
            reportId: row.inspectionReportId,
            reportRef: formatInspectionReportRef(row.inspectionReportId),
            progressLabel: `${progress.complete} of ${progress.total} complete`,
            items: row.inspectionGroupItems.map((item) => ({
              ticketId: item.ticketId,
              workOrderRef: item.workOrderRef,
              label: item.label,
              statusLabel: vendorWorkStatusChipLabel(item.vendorWorkStatus),
              runId: item.runId,
            })),
          }
        })()
      : null

  const rawTicketDescription = asString(ticket?.description)
  const structuredMaintenance = isMaintenance && rawTicketDescription && !homeCheckTitle
    ? extractStructuredIssueDetails(rawTicketDescription, {
        category: asString(ticket?.issue_category) || row.templateType || 'general',
        // Title format keeps the issue line noun-phrase shaped (not "a … leak").
        format: 'title',
      })
    : null

  const issueCategory =
    asString(ticket?.issue_category) || row.templateType || 'general'
  const humanEscalation = formatLandlordEscalationReason(
    row.escalationReason,
    issueCategory,
  )
  const lastEventPlain = (() => {
    const msg = row.lastEventMessage?.trim() || ''
    if (!msg || looksLikeInternalEscalationCode(msg)) return null
    return msg
  })()
  const issueDescription = structuredMaintenance
    ? composeIssueDetailsNarrative({
        reportedDetail: structuredMaintenance.reportedDetail,
        displayDescription: structuredMaintenance.displayDescription,
        triageFlags: structuredMaintenance.triageFlags,
        availability: structuredMaintenance.availability,
        needsClarification: structuredMaintenance.needsClarification,
        rawFallback: rawTicketDescription,
      })
    : rawTicketDescription.trim() || ''

  const description = homeCheckTitle === 'Home Check'
    ? 'Observation only. Photos of the water heater and heating system are saved here. This does not request a repair.'
    : homeCheckTitle === 'Home Check follow-up'
    ? rawTicketDescription.trim() || 'Home Check follow-up. Review this before any paid work.'
    : isMoveOut
    ? 'Ulo is coordinating move-out with the resident — instructions, inspection, keys, and deposit review stay in one SMS thread.'
    : issueDescription ||
      lastEventPlain ||
      humanEscalation ||
      'Ulo is coordinating this task in the workflow pipeline. Details will update as steps complete.'

  const scheduledAt = asString(ticket?.scheduled_at) || asString(metadata.scheduled_at)
  const scheduleConfirmedAt = asString(ticket?.schedule_confirmed_at)
  const scheduleStatus = asString(ticket?.schedule_status)
  const residentConfirmationStatus = asString(ticket?.resident_confirmation_status)
  const vendorNotifiedAt = asString(ticket?.vendor_notified_at)
  const pendingResidentAsk = enrichment.pendingResidentAsk
  const awaitingResidentRating = enrichment.awaitingResidentRating
  const reopenedByResident = enrichment.reopenedByResident
  const awaitingLandlordChoice = Boolean(
    asString(ticket?.awaiting_landlord_choice_at) ||
      /awaiting landlord vendor choice/i.test(asString(ticket?.vendor_notify_error)),
  )
  const vendorWorkStatus =
    asString(ticket?.vendor_work_status) || row.vendorWorkStatus
  const assignedVendorId =
    asString(ticket?.assigned_vendor_id) || row.assignedVendorId
  const stalePendingAcceptNeedsAdmin = isStalePendingAcceptNeedsAdminVendor({
    vendorWorkStatus,
    assignedVendorId,
    autoReassignLastOutcome:
      asString(ticket?.auto_reassign_last_outcome) ||
      row.autoReassignLastOutcome,
    workflowNeedsAdminVendor:
      row.status === 'escalated' &&
      isMaintenanceAdminVendorEscalationReason(row.escalationReason),
  })
  const holdVendorDispatch = Boolean(homeCheckTitle)
  const residentName =
    asString(enrichment.resident?.full_name) || asString(ticket?.resident_name) || row.residentName || ''
  const scheduleState = deriveMaintenanceScheduleState({
    vendorWorkStatus,
    scheduledAt,
    scheduleConfirmedAt,
    scheduleStatus,
    residentConfirmationStatus,
    vendorNotifiedAt,
    pendingResidentAsk,
  })
  const statusContext = isMaintenance || holdVendorDispatch
    ? buildMaintenanceOverviewStatusContext({
        vendorWorkStatus,
        vendorName: enrichment.vendorName,
        stageLabel: stage.label,
        lastEventMessage: lastEventPlain,
        escalationReason: row.escalationReason,
        runStatus: row.status,
        scheduledAt,
        scheduleConfirmedAt,
        scheduleStatus,
        residentConfirmationStatus,
        vendorNotifiedAt,
        pendingResidentAsk,
        residentName,
        awaitingResidentRating,
        reopenedByResident,
        issueCategory: homeCheckTitle === 'Home Check follow-up' ? 'home_check_warning' : issueCategory,
        holdVendorDispatch,
        awaitingLandlordChoice,
        stalePendingAcceptNeedsAdmin,
      })
    : isMoveOut
      ? `Move-out is ${moveOutProgress != null ? `${moveOutProgress}% complete` : 'in progress'}${
          moveOutDateLabel ? ` · target ${moveOutDateLabel}` : ''
        }.`
      : lastEventPlain ||
        humanEscalation ||
        `Current stage: ${stage.label}.`

  const lifecyclePipeline = deriveLifecyclePipeline(row, metadata)
  const hasCompletionPhotos = ticketCompletionPhotoPaths(ticket).length > 0
  const maintenanceProgressSteps = isMaintenance && !holdVendorDispatch
    ? buildMaintenanceRepairProgressSteps({
        kanbanStage: card.stage,
        vendorWorkStatus,
        scheduledAt,
        hasCompletionPhotos,
      })
    : null
  const progressNextAction = holdVendorDispatch
    ? 'Review the Home Check before contacting a vendor.'
    : isMaintenance
    ? buildMaintenanceRepairNextAction({
        vendorWorkStatus,
        vendorName: enrichment.vendorName,
        scheduledAt,
        scheduleConfirmedAt,
        scheduleStatus,
        residentConfirmationStatus,
        vendorNotifiedAt,
        pendingResidentAsk,
        residentName,
        awaitingResidentRating,
        reopenedByResident,
        awaitingLandlordChoice,
        stalePendingAcceptNeedsAdmin,
        hasCompletionPhotos,
      })
    : null
  const residentBlock: WorkflowPipelineResident | null = residentName
    ? {
        id: row.residentId,
        name: residentName,
        initials: initials(residentName),
        statusLine: [
          asString(enrichment.resident?.status) || 'Active',
          enrichment.resident?.lease_end_date
            ? `ends ${new Date(asString(enrichment.resident?.lease_end_date)).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}`
            : null,
        ]
          .filter(Boolean)
          .join(' · '),
        phone: asString(enrichment.resident?.phone) || asString(ticket?.resident_phone) || '—',
        email:
          displayResidentEmail(
            asString(enrichment.resident?.email) || asString(ticket?.email) || '',
          ) || '—',
        moveIn: enrichment.resident?.move_in_date
          ? new Date(asString(enrichment.resident?.move_in_date)).toLocaleDateString(undefined, {
              month: 'short',
              day: 'numeric',
              year: 'numeric',
            })
          : '—',
        preferred:
          asString(enrichment.resident?.phone) || asString(ticket?.resident_phone) ? 'SMS' : '—',
        emergencyContact: '—',
      }
    : null

  const dueAt = asString(ticket?.due_at) || asString(metadata.due_at)
  const estimatedCost = resolveEstimatedCost(ticket, invoice, metadata)
  const invoiceVendorId =
    asString(ticket?.assigned_vendor_id) || asString(invoice?.vendor_id) || null
  const invoiceSection = isMaintenance
    ? await buildInvoiceSection(invoice, invoiceVendorId)
    : null
  const uloThread = buildWorkflowUloThreadInput(row, metadata, enrichment)
  const attachments =
    isMaintenance
      ? await loadMaintenanceConversationAttachments(
          enrichment,
          description,
          asString(ticket?.issue_category) || row.templateType || 'general',
          residentName || 'Resident',
        )
      : uloThread?.kind === 'inspection'
        ? await loadInspectionConversationAttachments(
            enrichment,
            uloThread,
            residentName || 'Resident',
          )
        : []

  const vendorAttachments = isMaintenance
    ? await loadVendorCompletionPhotoAttachments(
        enrichment,
        enrichment.vendorName || 'Vendor',
      )
    : []

  const moveOutProgressSteps =
    isMoveOut && moveOutTimeline
      ? moveOutTimeline.map((step) => ({
          label: step.label,
          state: step.state,
        }))
      : null

  const progressSteps =
    moveOutProgressSteps ??
    maintenanceProgressSteps ??
    buildProgressSteps(lifecyclePipeline.labels, lifecyclePipeline.index)

  const activityVendorName = isMaintenance
    ? enrichment.vendorName?.trim() || null
    : null
  const activityVendorStatus = isMaintenance
    ? vendorStatusLabel(vendorWorkStatus, activityVendorName)
    : null
  const vendorNameForBlock = enrichment.vendorName?.trim() || ''
  const vendorTradeLabel = enrichment.vendorCategory
    ? formatVendorTradeLabel(enrichment.vendorCategory, { emptyLabel: '' }).trim()
    : ''
  const vendorBlock: WorkflowPipelineVendor | null = vendorNameForBlock
    ? {
        id: enrichment.vendorId,
        name: vendorNameForBlock,
        initials: initials(vendorNameForBlock),
        statusLine: vendorTradeLabel || '',
        phone: enrichment.vendorPhone?.trim() || '—',
        email: enrichment.vendorEmail?.trim() || '—',
      }
    : null
  const activityTimeline = isMaintenance
    ? buildMaintenanceWorkOrderTimeline(
        ticket
          ? {
              id: asString(ticket.id) || enrichment.maintenanceRequestId || row.id,
              createdAt: asString(ticket.created_at) || row.startedAt,
              dueAt: asString(ticket.due_at) || row.dueAt || null,
              urgency: urgency || 'normal',
              unit: asString(ticket.unit) || row.unitLabel || '',
              building: row.propertyLabel,
              description: asString(ticket.description),
              issueCategory: asString(ticket.issue_category) || row.issueCategory,
              assignedVendorId:
                asString(ticket.assigned_vendor_id) || row.assignedVendorId,
              assignedVendorName: activityVendorName,
              vendorWorkStatus: vendorWorkStatus || 'pending_accept',
              residentName: residentName || null,
              assignedAt: asString(ticket.assigned_at) || null,
            }
          : null,
        row.timeline,
      )
    : []

  return {
    runId: row.id,
    workOrderRef: formatWorkOrderRef(row),
    ticketRequestNumber: formatTicketRequestNumberForRun(row, enrichment.maintenanceRequestId),
    title,
    categoryLabel: category.label.toUpperCase(),
    categoryClassName: category.className,
    stageLabel: stage.label,
    stageClassName: stage.className,
    priorityLabel: priority?.label ?? null,
    priorityClassName: priority?.className ?? null,
    createdLine: formatCreatedLine(row.startedAt),
    reportedDateLabel: formatRepairTimelineDate(
      asString(ticket?.created_at) || row.startedAt,
    ),
    estimatedCompletionLabel: formatRepairTimelineDate(dueAt),
    estimatedCostLabel: formatCurrency(estimatedCost),
    locationLine: [
      formatLocationWithOptionalUnit({
        propertyLabel: row.propertyLabel,
        unitLabel: row.unitLabel,
      }),
      residentName && !/^home check/i.test(residentName) ? residentName : null,
    ]
      .filter(Boolean)
      .join(' · '),
    description,
    statusContext,
    progressSteps,
    progressCaption: progressCaptionFromSteps(progressSteps),
    progressNextAction,
    overviewFields: isMoveOut
      ? [
          { label: 'Resident', value: residentName || '—' },
          { label: 'Property', value: row.propertyLabel || '—' },
          { label: 'Unit', value: formatBareUnitLabel(row.unitLabel) || '—' },
          { label: 'Move-out date', value: moveOutDateLabel ?? '—' },
          {
            label: 'Current stage',
            value:
              moveOutProgressSteps?.find((step) => step.state === 'active')?.label ??
              stage.label,
          },
          { label: 'Progress', value: moveOutProgress != null ? `${moveOutProgress}%` : '—' },
        ]
      : [
          { label: 'Resident', value: residentName || '—' },
          { label: 'Property', value: row.propertyLabel || '—' },
          { label: 'Unit', value: formatBareUnitLabel(row.unitLabel || asString(ticket?.unit)) || '—' },
          { label: 'Vendor', value: enrichment.vendorName || '—' },
          {
            label: 'Status',
            value: buildMaintenanceOverviewStatusLabel({
              vendorWorkStatus,
              awaitingLandlordChoice,
              stalePendingAcceptNeedsAdmin,
            }),
          },
          {
            label: 'Visit',
            value: formatVisitLabel(scheduledAt, scheduleConfirmedAt, {
              scheduleState,
              pendingResidentAsk,
            }),
          },
          { label: 'Expected Completion', value: formatDueLabel(dueAt) },
          { label: 'Estimated Cost', value: formatCurrency(estimatedCost) },
          ...(row.status === 'escalated'
            ? [{ label: 'Approval', value: 'Review Required' }]
            : []),
        ],
    maintenanceDetails: isMaintenance
      ? [
          {
            label: 'Repair Scope',
            value: dash(formatVendorTradeLabel(asString(ticket?.issue_category), { emptyLabel: '' })),
          },
          {
            label: 'Location',
            value: dash(
              formatIssueLocationWithServes(
                structuredMaintenance?.locationDetail ||
                  asString(ticket?.location_detail) ||
                  row.issueLocationDetail ||
                  '',
                structuredMaintenance?.servesFloor,
              ),
            ),
          },
          {
            label: 'Resident access notes',
            value: dash(
              asString(ticket?.access_instructions) ||
                (structuredMaintenance?.availability
                  ? `Availability: ${structuredMaintenance.availability}`
                  : ''),
            ),
          },
          { label: 'Parts Ordered', value: '—' },
          {
            label: 'Labor Estimate',
            value: (() => {
              const minutes = asFiniteNumber(ticket?.estimated_minutes)
              if (minutes == null || minutes <= 0) return '—'
              const hours = Math.max(1, Math.round(minutes / 60))
              return `${hours} Hr`
            })(),
          },
        ]
      : [],
    invoiceSection,
    resident: residentBlock,
    vendor: vendorBlock,
    property: await buildPropertyBlock(row, metadata, ticket),
    attachments,
    vendorAttachments,
    maintenanceRequestId: enrichment.maintenanceRequestId,
    conversationId: enrichment.conversationId,
    vendorConversationId: enrichment.vendorConversationId,
    uloThread,
    isMaintenanceWorkflow: isMaintenance,
    isMoveOutWorkflow: isMoveOut,
    moveOutProgressPercent: moveOutProgress,
    moveOutDateLabel,
    sourceLeaseRenewalRunId: asString(metadata.source_workflow_run_id),
    inspectionGroup,
    kanbanStage: isMaintenance ? card.stage : null,
    templateId: row.templateId,
    assignedVendorId: card.assignedVendorId,
    assignedVendorName: enrichment.vendorName?.trim() || null,
    vendorWorkStatus: vendorWorkStatus || null,
    scheduledAt: scheduledAt || null,
    scheduleConfirmedAt: scheduleConfirmedAt || null,
    stageMoveTicketIds: card.stageMoveTicketIds,
    inspectionReportId: card.inspectionReportId ?? row.inspectionReportId ?? null,
    activityVendorName,
    activityVendorStatus,
    activityTimeline,
  }
}
