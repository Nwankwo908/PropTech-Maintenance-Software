import { getActiveLandlordId } from '@/lib/activeLandlord'
import {
  fetchAdminWorkflowDashboard,
  workflowTemplateGroupId,
  type AdminWorkflowRow,
} from '@/lib/adminWorkflows'
import {
  WORKFLOW_CATEGORY_BADGE,
  WORKFLOW_STAGE_LABEL,
  buildWorkflowKanbanCard,
  collectAdminWorkflowRuns,
  deriveWorkflowKanbanStage,
  lifecycleStepKey,
  type WorkflowKanbanCategory,
} from '@/lib/adminWorkflowKanban'
import { formatVendorTradeLabel } from '@/lib/vendorTrades'
import { formatTicketRequestNumber, formatWorkOrderRefForWorkflowRun } from '@/lib/vendorCallFlow'
import { normalizePhoneForDb } from '@/lib/phoneFormat'
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
import { smsMessageBelongsToWorkOrder } from '@/lib/workOrderSmsPhotos'
import {
  formatPropertyAccessPlainText,
  loadPropertyAccess,
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
  kind: 'image' | 'video' | 'document'
  url?: string
  caption?: string
}

export type WorkflowPipelineResident = {
  name: string
  initials: string
  statusLine: string
  phone: string
  email: string
  moveIn: string
  preferred: string
  emergencyContact: string
}

export type WorkflowPipelineProperty = {
  property: string
  building: string
  address: string
  unit: string
  manager: string
  access: string
  entryCode: string
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
  locationLine: string
  description: string
  progressSteps: WorkflowPipelineStep[]
  progressCaption: string
  overviewFields: WorkflowPipelineField[]
  maintenanceDetails: WorkflowPipelineField[]
  /** Vendor invoice + 1099-NEC YTD tracking for maintenance jobs. */
  invoiceSection: WorkflowPipelineInvoiceSection | null
  resident: WorkflowPipelineResident | null
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
}

const MAINTENANCE_PIPELINE_LABELS = [
  'Reported',
  'AI Intake',
  'Work Order',
  'Vendor Assigned',
  'Vendor Accepted',
  'In Progress',
  'Completed',
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

function formatDueLabel(iso: string | null | undefined): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  const now = Date.now()
  const diffHours = Math.round((date.getTime() - now) / 3_600_000)
  const time = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  if (diffHours < 0) return `Overdue · ${time}`
  if (diffHours < 24) return `Today · ${time}`
  if (diffHours < 48) return `Tomorrow · ${time}`
  return `${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} · ${time}`
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
  return `Stage ${progressIndex + 1} of ${steps.length}`
}

function deriveMaintenancePipelineIndex(
  row: AdminWorkflowRow,
  ticket: Record<string, unknown> | null,
): number {
  const vendorStatus = asString(ticket?.vendor_work_status).toLowerCase()
  const assignedVendorId = asString(ticket?.assigned_vendor_id)
  const hasVendor = Boolean(assignedVendorId)

  if (row.status === 'completed' || vendorStatus === 'completed') return 7
  if (hasVendor && vendorStatus === 'in_progress') return 6
  if (hasVendor && vendorStatus === 'accepted') return 5
  // Vendor Assigned only when a vendor is actually on the ticket.
  if (hasVendor) return 4

  const step = asString(row.currentStep).toLowerCase()
  // Exact workflow steps only — do not regex-match "accept"/"await" inside intake
  // steps like pending_accept (without vendor) or awaiting_confirm.
  if (step === 'completed' || step === 'closed' || step === 'done') return 7
  if (step === 'in_progress') return 6
  if (step === 'pending_accept' && hasVendor) return 4
  if (
    step === 'unassigned' ||
    step === 'submitted' ||
    /work.?order|ticket/.test(step) ||
    row.entityType === 'maintenance_request'
  ) {
    return 3
  }
  if (/intake|classif|collect|confirm|clarif|photo|trigger/.test(step)) return 2
  return 2
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
): { labels: readonly string[]; index: number } {
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

const PRIORITY_TITLE_PREFIX =
  /^(?:\[(?:emergency|urgent|critical|high|medium|low|priority)\]\s*|(?:emergency|urgent|critical|high|medium|low|priority)\s*[:\-–—]\s*)+/i

function firstSentence(text: string): string {
  return text.split(/[.!?]/)[0]?.trim() ?? ''
}

function stripPriorityFromTitle(text: string): string {
  let result = text.trim()
  for (let i = 0; i < 3; i++) {
    const next = result.replace(PRIORITY_TITLE_PREFIX, '').trim()
    if (next === result) break
    result = next
  }
  return result.replace(/^(?:emergency|urgent|critical)\s+/i, '').trim()
}

function truncateConciseTitle(text: string, maxLen = 64): string {
  const trimmed = text.trim()
  if (trimmed.length <= maxLen) return trimmed
  const cut = trimmed.slice(0, maxLen)
  const lastSpace = cut.lastIndexOf(' ')
  if (lastSpace > maxLen * 0.5) return `${cut.slice(0, lastSpace).trim()}…`
  return `${cut.trim()}…`
}

function toSentenceCase(text: string): string {
  const trimmed = text.trim()
  if (!trimmed) return trimmed
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1)
}

function buildConciseWorkOrderTitle(input: {
  description: string
  issueCategory: string
  fallback: string
}): string {
  const stripped = stripPriorityFromTitle(firstSentence(input.description))
  if (stripped) {
    const concise =
      stripped.length > 72 && stripped.includes(',') ? stripped.split(',')[0].trim() : stripped
    return truncateConciseTitle(toSentenceCase(concise))
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
  const accessProfile = propertyLabel ? await loadPropertyAccess(propertyLabel) : null
  const ticketAccess = asString(ticket?.access_instructions)
  const accessText =
    ticketAccess || (accessProfile ? formatPropertyAccessPlainText(accessProfile) : '')
  const entryCode = accessProfile?.gateCode || accessProfile?.lockboxCode || ''
  const street = record ? propertyRecordToAddressLine(record) : null
  const locationLine =
    propertyLabel && unit
      ? `${propertyLabel} · Unit ${unit}`
      : propertyLabel || (unit ? `Unit ${unit}` : '')

  return {
    property: dash(record?.name || propertyLabel),
    building: dash(propertyLabel),
    address: dash(street || locationLine),
    unit: dash(unit),
    manager: dash(record?.managerName || accessProfile?.superintendentContact),
    access: dash(accessText),
    entryCode: dash(entryCode),
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
    if (!media) {
      if (isStorageMediaPath(path)) {
        console.warn('[workflow-pipeline] signed media url failed', path)
      }
      continue
    }
    mediaIndex += 1
    const kind = media.kind === 'video' ? 'video' : 'image'
    const noun = kind === 'video' ? 'video' : 'photo'
    items.push({
      name: path.split('/').pop() || `${opts.nameFallbackPrefix}-${mediaIndex}.${kind === 'video' ? 'mp4' : 'jpg'}`,
      sizeLabel: opts.sizeLabel,
      kind,
      url: media.url,
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

  const extraItems: WorkflowPipelineAttachment[] = []
  const resolvedByRef = await resolveSmsMediaForMessages(extraRefs.map((ref) => [ref]))
  let mediaIndex = fromTicket.length
  for (let i = 0; i < extraRefs.length; i += 1) {
    const ref = extraRefs[i]
    const media = resolvedByRef[i]?.[0]
    if (!media) continue
    mediaIndex += 1
    const kind = media.kind === 'video' ? 'video' : 'image'
    const noun = kind === 'video' ? 'video' : 'photo'
    const meta = metaByRef.get(ref)
    extraItems.push({
      name:
        (isStorageMediaPath(ref) ? ref.split('/').pop() : '') ||
        `conversation-${noun}-${mediaIndex}.${kind === 'video' ? 'mp4' : 'jpg'}`,
      sizeLabel: meta?.sentAt || 'From SMS',
      kind,
      url: media.url,
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
  vendorName: string | null
  resident: Record<string, unknown> | null
  conversationId: string | null
  vendorConversationId: string | null
  conversationIds: string[]
  maintenanceRequestId: string | null
  ticketCreatedAt: string | null
  nextTicketCreatedAt: string | null
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
      vendorName: null,
      resident: null,
      conversationId: null,
      vendorConversationId: null,
      conversationIds: [],
      maintenanceRequestId: null,
      ticketCreatedAt: null,
      nextTicketCreatedAt: null,
    }
  }

  const landlordId = getActiveLandlordId()
  const ticketId = asString(row.entityId) || asString(metadata.maintenance_request_id)

  let ticket: Record<string, unknown> | null = null
  let invoice: Record<string, unknown> | null = null
  let vendorName: string | null = null
  let resident: Record<string, unknown> | null = null
  let conversationId = asString(metadata.conversation_id)
  let vendorConversationId: string | null = null
  let conversationIds: string[] = []
  let nextTicketCreatedAt: string | null = null

  if (ticketId) {
    const { data } = await supabase
      .from('maintenance_requests')
      .select(
        'id, created_at, description, priority, urgency, issue_category, unit, due_at, vendor_work_status, assigned_vendor_id, assigned_at, resident_name, email, resident_phone, estimated_minutes, recognized_spend_amount, spend_status, photo_paths, completion_photo_paths, access_instructions',
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

    const vendorId =
      asString(ticket?.assigned_vendor_id) || asString(invoice?.vendor_id)
    if (vendorId) {
      const { data: vendorRow } = await supabase.from('vendors').select('name').eq('id', vendorId).maybeSingle()
      vendorName = asString((vendorRow as Record<string, unknown> | null)?.name) || null
    }

    // Resident intake and vendor job SMS are separate threads (same as Messages).
    // Prefer resident for "See thread"; keep vendor id for a dedicated vendor view.
    const { data: convRows } = await supabase
      .from('sms_conversations')
      .select('id, conversation_type, updated_at, resident_id, external_phone_number')
      .eq('landlord_id', landlordId)
      .eq('maintenance_request_id', ticketId)
      .order('updated_at', { ascending: false })

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
        .select('id, conversation_type, updated_at')
        .eq('landlord_id', landlordId)
        .eq('resident_id', residentLookupId)
        .eq('conversation_type', 'resident_intake')
        .order('updated_at', { ascending: false })
        .limit(5)
      byResident = ((residentConvRows ?? []) as Record<string, unknown>[]).map((entry) => ({
        id: asString(entry.id),
        conversation_type: asString(entry.conversation_type) || 'resident_intake',
      })).filter((entry) => entry.id)
    }
    if (byResident.length === 0 && residentPhone) {
      const normalizedPhone = normalizePhoneForDb(residentPhone) ?? residentPhone
      const { data: phoneConvRows } = await supabase
        .from('sms_conversations')
        .select('id, conversation_type, updated_at, external_phone_number')
        .eq('landlord_id', landlordId)
        .eq('conversation_type', 'resident_intake')
        .order('updated_at', { ascending: false })
        .limit(25)
      byResident = ((phoneConvRows ?? []) as Record<string, unknown>[])
        .filter((entry) => {
          const phone = asString(entry.external_phone_number)
          if (!phone) return false
          const normalized = normalizePhoneForDb(phone) ?? phone
          return normalized === normalizedPhone || phone === residentPhone
        })
        .map((entry) => ({
          id: asString(entry.id),
          conversation_type: asString(entry.conversation_type) || 'resident_intake',
        }))
        .filter((entry) => entry.id)
        .slice(0, 5)
    }

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
    vendorName,
    resident,
    conversationId: conversationId || null,
    vendorConversationId,
    conversationIds,
    maintenanceRequestId: ticketId || null,
    ticketCreatedAt: asString(ticket?.created_at) || null,
    nextTicketCreatedAt,
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

  const rows: CommunicationWorkOrderInboxRow[] = []
  for (const row of runs) {
    const metadata = data.runMetadata[row.id] ?? {}
    const enrichment = await loadTicketEnrichment(row, metadata)
    const uloThread = buildWorkflowUloThreadInput(row, metadata, enrichment)
    if (!uloThread) continue

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

    rows.push({
      id: resolveWorkOrderInboxConversationId(uloThread),
      name: uloThread.residentName,
      context: [uloThread.propertyLabel, uloThread.unitLabel ? `Unit ${uloThread.unitLabel}` : '']
        .filter(Boolean)
        .join(' · '),
      preview: workflowInboxPreview(uloThread),
      status: WORKFLOW_STAGE_LABEL[stage],
      lastActivity: lastActivity || Date.now(),
      uloThread,
    })
  }

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

  const title = isMoveOut
    ? moveOutPipelineTitle()
    : buildConciseWorkOrderTitle({
        description: asString(ticket?.description),
        issueCategory: asString(ticket?.issue_category) || row.templateType || 'general',
        fallback: row.templateName || 'Workflow',
      })

  const description = isMoveOut
    ? 'Ulo is coordinating move-out with the resident — instructions, inspection, keys, and deposit review stay in one SMS thread.'
    : asString(ticket?.description) ||
      row.lastEventMessage ||
      row.escalationReason ||
      'Ulo is coordinating this task in the workflow pipeline. Details will update as steps complete.'

  const pipelineIndex = isMaintenance
    ? deriveMaintenancePipelineIndex(row, ticket)
    : deriveLifecyclePipeline(row).index
  const pipelineLabels = isMaintenance
    ? MAINTENANCE_PIPELINE_LABELS
    : deriveLifecyclePipeline(row).labels

  const residentName =
    asString(enrichment.resident?.full_name) || asString(ticket?.resident_name) || row.residentName || ''
  const residentBlock: WorkflowPipelineResident | null = residentName
    ? {
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
        email: asString(enrichment.resident?.email) || asString(ticket?.email) || '—',
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
    locationLine: [row.propertyLabel, row.unitLabel ? `Unit ${row.unitLabel}` : null, residentName || null]
      .filter(Boolean)
      .join(' · '),
    description,
    progressSteps: moveOutProgressSteps ?? buildProgressSteps(pipelineLabels, pipelineIndex),
    progressCaption: moveOutProgressSteps
      ? progressCaptionFromSteps(moveOutProgressSteps)
      : `Stage ${Math.min(pipelineIndex, pipelineLabels.length)} of ${pipelineLabels.length}`,
    overviewFields: isMoveOut
      ? [
          { label: 'Resident', value: residentName || '—' },
          { label: 'Property', value: row.propertyLabel || '—' },
          { label: 'Unit', value: row.unitLabel || '—' },
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
      { label: 'Property', value: row.propertyLabel || '—' },
      { label: 'Unit', value: row.unitLabel || asString(ticket?.unit) || '—' },
      { label: 'Resident', value: residentName || '—' },
      { label: 'Vendor', value: enrichment.vendorName || '—' },
      { label: 'Category', value: formatCategoryLabel(asString(ticket?.issue_category) || row.templateType) || '—' },
      {
        label: 'Priority',
        value: priority
          ? priority.label === 'MEDIUM'
            ? 'Med'
            : priority.label[0] + priority.label.slice(1).toLowerCase()
          : '—',
      },
      { label: 'Due Date', value: formatDueLabel(dueAt) },
      { label: 'Expected Completion', value: formatDueLabel(dueAt) },
      { label: 'Estimated Cost', value: formatCurrency(estimatedCost) },
      { label: 'Approval', value: row.status === 'escalated' ? 'Review Required' : 'Not Required' },
    ],
    maintenanceDetails: isMaintenance
      ? [
          {
            label: 'Repair Scope',
            value: dash(formatVendorTradeLabel(asString(ticket?.issue_category), { emptyLabel: '' })),
          },
          {
            label: 'Resident access notes',
            value: dash(asString(ticket?.access_instructions)),
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
  }
}
