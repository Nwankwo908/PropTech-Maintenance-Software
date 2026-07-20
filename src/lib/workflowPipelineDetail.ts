import {
  fetchAdminWorkflowDashboard,
  formatWorkflowTimestamp,
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
import { formatWorkOrderRefForWorkflowRun } from '@/lib/vendorCallFlow'
import {
  buildMoveOutTimeline,
  formatMoveOutDateLabel,
  moveOutPipelineTitle,
  moveOutProgressPercent,
} from '@/lib/moveOutWorkflow'
import { getActiveLandlordId, isDemoAccountActive } from '@/lib/activeLandlord'
import {
  resolveWorkOrderInboxConversationId,
  type InspectionUloThreadInput,
  type MaintenanceUloThreadInput,
  type MoveInUloThreadInput,
  type WorkflowUloThreadInput,
} from '@/lib/conversationMonitoring'

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
  kind: 'image' | 'document'
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

export type WorkflowPipelineDetail = {
  runId: string
  workOrderRef: string
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
  resident: WorkflowPipelineResident | null
  property: WorkflowPipelineProperty
  attachments: WorkflowPipelineAttachment[]
  maintenanceRequestId: string | null
  conversationId: string | null
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

function formatCreatedLine(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return 'Created recently'
  const now = new Date()
  const startOfToday = new Date(now)
  startOfToday.setHours(0, 0, 0, 0)
  const dayLabel = date >= startOfToday ? 'Today' : formatWorkflowTimestamp(iso).split(',')[0]
  const timeLabel = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  return `Created ${dayLabel} · ${timeLabel}`
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
  if (row.templateId === 'inspection' || row.templateId === 'unit_inspection') {
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

/** Cost proxy shared with unit_maintenance_cost_view: estimated_minutes × $1.25/min. */
function ticketCostEstimate(estimatedMinutes: number | null | undefined): number {
  return (estimatedMinutes ?? 240) * 1.25
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

  return ticketCostEstimate(asFiniteNumber(ticket.estimated_minutes))
}

function buildPropertyBlock(row: AdminWorkflowRow, metadata: Record<string, unknown>): WorkflowPipelineProperty {
  const property = row.propertyLabel || asString(metadata.building) || '—'
  const unit = row.unitLabel || asString(metadata.unit_label) || '—'
  return {
    property,
    building: 'Main',
    address: property !== '—' ? `${property} · Unit ${unit}` : '—',
    unit,
    manager: 'J. Hollis',
    access: 'Use elevator to floor; park in visitor spots B2.',
    entryCode: '#4821',
  }
}

function mentionsAc(text: string): boolean {
  return /\b(ac|a\/c|air conditioning|air.?condition)\b/i.test(text)
}

const DEMO_SMS_PHOTO_URLS = {
  hvac: [
    {
      url: 'https://images.unsplash.com/photo-1631545806604-aa4a6292c1a9?auto=format&fit=crop&w=800&q=80',
      name: 'ac-unit.jpg',
      caption: 'AC unit — not running',
    },
    {
      url: 'https://images.unsplash.com/photo-1558002038-1055906df827?auto=format&fit=crop&w=800&q=80',
      name: 'thermostat.jpg',
      caption: 'Thermostat reading',
    },
  ],
  general: [
    {
      url: 'https://images.unsplash.com/photo-1581578731548-c64695cc6952?auto=format&fit=crop&w=800&q=80',
      name: 'tenant-photo.jpg',
      caption: 'Issue photo from SMS',
    },
  ],
} as const

function formatAttachmentTimestamp(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return 'From SMS'
  return date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function syntheticConversationPhotoAttachments(
  description: string,
  issueCategory: string,
  residentName: string,
): WorkflowPipelineAttachment[] {
  if (!isDemoAccountActive()) return []
  const hay = `${description} ${issueCategory}`.toLowerCase()
  if (mentionsAc(hay) || issueCategory.toLowerCase() === 'hvac') {
    return DEMO_SMS_PHOTO_URLS.hvac.map((photo) => ({
      name: photo.name,
      sizeLabel: 'From SMS',
      kind: 'image' as const,
      url: photo.url,
      caption: `${residentName} · ${photo.caption}`,
    }))
  }
  if (/photo|image|picture|leak|sink|chip|damage|broken|stain/i.test(hay)) {
    const photo = DEMO_SMS_PHOTO_URLS.general[0]
    return [
      {
        name: photo.name,
        sizeLabel: 'From SMS',
        kind: 'image',
        url: photo.url,
        caption: `${residentName} · ${photo.caption}`,
      },
    ]
  }
  return []
}

function isBrowserUnsafeMediaUrl(url: string): boolean {
  const lower = url.toLowerCase()
  // Twilio MMS media requires HTTP Basic (Account SID / Auth Token) — never open in <img>.
  return (
    lower.includes('api.twilio.com') ||
    lower.includes('media.twilio.com') ||
    lower.includes('api.telnyx.com')
  )
}

async function loadTicketPhotoPathAttachments(
  enrichment: TicketEnrichment,
  residentName: string,
): Promise<WorkflowPipelineAttachment[]> {
  const { supabase } = await import('@/lib/supabase')
  if (!supabase) return []

  const photoPaths = enrichment.ticket?.photo_paths
  if (!Array.isArray(photoPaths) || photoPaths.length === 0) return []

  const items: WorkflowPipelineAttachment[] = []
  let photoIndex = 0
  for (const rawPath of photoPaths) {
    const path = asString(rawPath)
    if (!path) continue
    const { data, error } = await supabase.storage
      .from('maintenance-uploads')
      .createSignedUrl(path, 3600)
    if (error || !data?.signedUrl) {
      console.warn('[workflow-pipeline] signed photo url failed', path, error?.message)
      continue
    }
    photoIndex += 1
    items.push({
      name: path.split('/').pop() || `tenant-photo-${photoIndex}.jpg`,
      sizeLabel: 'From request',
      kind: 'image',
      url: data.signedUrl,
      caption: `${residentName} · photo ${photoIndex}`,
    })
  }
  return items
}

async function loadInboundSmsPhotoAttachments(
  enrichment: TicketEnrichment,
  residentName: string,
): Promise<WorkflowPipelineAttachment[]> {
  // Prefer durable ticket photos (signed storage URLs). Never use raw Twilio/Telnyx
  // media URLs in the browser — they prompt for username/password.
  const fromTicket = await loadTicketPhotoPathAttachments(enrichment, residentName)
  if (fromTicket.length > 0) return fromTicket

  // If the ticket already has photo_paths but signing failed, do not fall back to
  // provider media (that is what triggers the auth dialog).
  const photoPaths = enrichment.ticket?.photo_paths
  if (Array.isArray(photoPaths) && photoPaths.length > 0) return []

  const { supabase } = await import('@/lib/supabase')
  if (!supabase) return []

  const landlordId = getActiveLandlordId()
  const conversationId = enrichment.conversationId
  if (!conversationId) return []

  const { data: messages } = await supabase
    .from('sms_messages')
    .select('body, direction, media_urls, created_at')
    .eq('landlord_id', landlordId)
    .eq('conversation_id', conversationId)
    .eq('direction', 'inbound')
    .order('created_at', { ascending: false })
    .limit(8)

  const items: WorkflowPipelineAttachment[] = []
  let photoIndex = 0
  for (const message of (messages ?? []) as Record<string, unknown>[]) {
    const rawUrls = message.media_urls
    const urls = Array.isArray(rawUrls) ? rawUrls : []
    const body = asString(message.body)
    const sentAt = formatAttachmentTimestamp(asString(message.created_at))

    for (const rawUrl of urls) {
      const url = asString(rawUrl)
      if (!url || isBrowserUnsafeMediaUrl(url)) continue
      photoIndex += 1
      items.push({
        name: `tenant-photo-${photoIndex}.jpg`,
        sizeLabel: sentAt,
        kind: 'image',
        url,
        caption: body || `${residentName} · photo ${photoIndex}`,
      })
      if (photoIndex >= 3) break
    }
    if (photoIndex >= 3) break
  }

  return items.reverse()
}

const DEMO_INSPECTION_PHOTO_URLS = [
  {
    url: 'https://images.unsplash.com/photo-1556911220-bff31c812dba?auto=format&fit=crop&w=800&q=80',
    name: 'kitchen-counter.jpg',
    caption: 'Counter chip by sink',
  },
  {
    url: 'https://images.unsplash.com/photo-1585704032915-07195aafc03c?auto=format&fit=crop&w=800&q=80',
    name: 'under-sink.jpg',
    caption: 'Slow drip under kitchen sink',
  },
  {
    url: 'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=800&q=80',
    name: 'closet-door.jpg',
    caption: 'Sticking bedroom closet door',
  },
  {
    url: 'https://images.unsplash.com/photo-1591696205602-890fa717050b?auto=format&fit=crop&w=800&q=80',
    name: 'bedroom-outlet.jpg',
    caption: 'Dead outlet by window',
  },
] as const

function syntheticInspectionConversationPhotos(
  input: InspectionUloThreadInput,
  residentName: string,
): WorkflowPipelineAttachment[] {
  if (!isDemoAccountActive()) return []
  const photos = input.hasMaintenanceFollowUp
    ? DEMO_INSPECTION_PHOTO_URLS
    : DEMO_INSPECTION_PHOTO_URLS.slice(0, 2)

  return photos.map((photo) => ({
    name: photo.name,
    sizeLabel: 'From SMS',
    kind: 'image' as const,
    url: photo.url,
    caption: `${residentName} · ${photo.caption}`,
  }))
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
  maintenanceRequestId: string | null
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
      maintenanceRequestId: null,
    }
  }

  const landlordId = getActiveLandlordId()
  const ticketId = asString(row.entityId) || asString(metadata.maintenance_request_id)

  let ticket: Record<string, unknown> | null = null
  let invoice: Record<string, unknown> | null = null
  let vendorName: string | null = null
  let resident: Record<string, unknown> | null = null
  let conversationId = asString(metadata.conversation_id)

  if (ticketId) {
    const { data } = await supabase
      .from('maintenance_requests')
      .select(
        'description, priority, urgency, issue_category, unit, due_at, vendor_work_status, assigned_vendor_id, assigned_at, resident_name, email, resident_phone, estimated_minutes, recognized_spend_amount, spend_status, photo_paths',
      )
      .eq('landlord_id', landlordId)
      .eq('id', ticketId)
      .maybeSingle()
    ticket = (data as Record<string, unknown> | null) ?? null

    const { data: invoiceRow } = await supabase
      .from('maintenance_invoices')
      .select('total_cost, labor_cost, material_cost, tax_amount, status')
      .eq('landlord_id', landlordId)
      .eq('maintenance_request_id', ticketId)
      .maybeSingle()
    invoice = (invoiceRow as Record<string, unknown> | null) ?? null

    const vendorId = asString(ticket?.assigned_vendor_id)
    if (vendorId) {
      const { data: vendorRow } = await supabase.from('vendors').select('name').eq('id', vendorId).maybeSingle()
      vendorName = asString((vendorRow as Record<string, unknown> | null)?.name) || null
    }

    // Prefer vendor job SMS whenever linked — admin approve/decline updates land there.
    // Do this even if metadata still points at the resident intake conversation.
    const { data: convRows } = await supabase
      .from('sms_conversations')
      .select('id, conversation_type, updated_at')
      .eq('landlord_id', landlordId)
      .eq('maintenance_request_id', ticketId)
      .order('updated_at', { ascending: false })

    const rows = (convRows ?? []) as Record<string, unknown>[]
    const vendorThread = rows.find(
      (entry) => asString(entry.conversation_type) === 'vendor_alert',
    )
    if (vendorThread) {
      conversationId = asString(vendorThread.id)
    } else if (!conversationId) {
      const preferred =
        rows.find((entry) => asString(entry.conversation_type) === 'resident_intake') ??
        rows.find((entry) => {
          const type = asString(entry.conversation_type)
          return type !== 'ai_copilot' && type !== 'landlord_update'
        }) ??
        rows[0]
      conversationId = asString(preferred?.id)
    }
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

  return { ticket, invoice, vendorName, resident, conversationId, maintenanceRequestId: ticketId || null }
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
  return templateId === 'inspection' || templateId === 'unit_inspection'
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
    return `Hi ${fname} — reply START when you're ready and I'll guide your ${unitPhrase} inspection over text.`
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
  const urgency = asString(ticket?.urgency) || asString(ticket?.priority) || asString(metadata.urgency) || 'normal'
  const priority = PRIORITY_BADGE[urgency.toLowerCase()] ?? PRIORITY_BADGE.normal

  const moveOutTimeline = isMoveOut ? buildMoveOutTimeline(row, metadata) : undefined
  const moveOutProgress = moveOutTimeline ? moveOutProgressPercent(moveOutTimeline) : undefined
  const moveOutDateLabel = isMoveOut
    ? formatMoveOutDateLabel(
        asString(metadata.move_out_date) || asString(enrichment.resident?.lease_end_date),
      )
    : undefined

  const title = isMoveOut
    ? moveOutPipelineTitle()
    : asString(ticket?.description).split(/[.!?]/)[0]?.trim() ||
      row.templateName ||
      'Workflow'

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
        preferred: 'SMS',
        emergencyContact: 'On file',
      }
    : null

  const dueAt = asString(ticket?.due_at) || asString(metadata.due_at)
  const estimatedCost = resolveEstimatedCost(ticket, invoice, metadata)
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
    title,
    categoryLabel: category.label.toUpperCase(),
    categoryClassName: category.className,
    stageLabel: stage.label,
    stageClassName: stage.className,
    priorityLabel: priority.label,
    priorityClassName: priority.className,
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
      { label: 'Category', value: formatCategoryLabel(asString(ticket?.issue_category) || row.templateType) },
      { label: 'Priority', value: priority.label === 'MEDIUM' ? 'Med' : priority.label[0] + priority.label.slice(1).toLowerCase() },
      { label: 'Due Date', value: formatDueLabel(dueAt) },
      { label: 'Expected Completion', value: formatDueLabel(dueAt) },
      { label: 'Estimated Cost', value: formatCurrency(estimatedCost) },
      { label: 'Approval', value: row.status === 'escalated' ? 'Review Required' : 'Not Required' },
    ],
    maintenanceDetails: isMaintenance
      ? [
          { label: 'Repair Scope', value: 'Standard Diagnostic + Repair' },
          { label: 'Parts Ordered', value: '—' },
          {
            label: 'Labor Estimate',
            value: ticket?.estimated_minutes
              ? `${Math.max(1, Math.round(Number(ticket.estimated_minutes) / 60))} Hr`
              : '1–2 Hrs',
          },
        ]
      : [],
    resident: residentBlock,
    property: buildPropertyBlock(row, metadata),
    attachments,
    maintenanceRequestId: enrichment.maintenanceRequestId,
    conversationId: enrichment.conversationId,
    uloThread,
    isMaintenanceWorkflow: isMaintenance,
    isMoveOutWorkflow: isMoveOut,
    moveOutProgressPercent: moveOutProgress,
    moveOutDateLabel,
    sourceLeaseRenewalRunId: asString(metadata.source_workflow_run_id),
  }
}
