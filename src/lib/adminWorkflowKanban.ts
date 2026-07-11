import {
  formatLocationContextLabel,
  workflowTemplateGroupId,
  type AdminWorkflowDashboardData,
  type AdminWorkflowRow,
} from '@/lib/adminWorkflows'
import { DEMO_MOVE_OUT_WO_D777_RUN_ID } from '@/lib/activeLandlord'
import { normalizeBuildingKey } from '@/lib/propertyHealth'

export type OperationsBreakdownLine = {
  id: string
  label: string
  count: number
}

export type ActiveOperationsSnapshot = {
  total: number
  lines: OperationsBreakdownLine[]
}

export type WorkflowKanbanStageId =
  | 'new_intake'
  | 'assigned'
  | 'in_progress'
  | 'completed'

export const WORKFLOW_KANBAN_STAGES: { id: WorkflowKanbanStageId; label: string }[] = [
  { id: 'new_intake', label: 'New Intake' },
  { id: 'assigned', label: 'Assigned' },
  { id: 'in_progress', label: 'In Progress' },
  { id: 'completed', label: 'Completed' },
]

export const WORKFLOW_STAGE_LABEL: Record<WorkflowKanbanStageId, string> = {
  new_intake: 'New Intake',
  assigned: 'Assigned',
  in_progress: 'In Progress',
  completed: 'Completed',
}

export type WorkflowKanbanCategory =
  | 'maintenance'
  | 'payment'
  | 'lease'
  | 'move_in'
  | 'move_out'
  | 'inspection'
  | 'other'

export const WORKFLOW_CATEGORY_BADGE: Record<
  WorkflowKanbanCategory,
  { label: string; className: string }
> = {
  maintenance: { label: 'Maintenance', className: 'bg-[#f3e8ff] text-[#7c3aed]' },
  payment: { label: 'Payment', className: 'bg-[#fef9c2] text-[#a65f00]' },
  lease: { label: 'Lease', className: 'bg-[#dbeafe] text-[#1447e6]' },
  move_in: { label: 'Move in', className: 'bg-[#dbfce7] text-[#008236]' },
  move_out: { label: 'Move out', className: 'bg-[#ffe2e2] text-[#c10007]' },
  inspection: { label: 'Inspection', className: 'bg-[#e0f2fe] text-[#0069a8]' },
  other: { label: 'Workflow', className: 'bg-[#f3f4f6] text-[#364153]' },
}

export type WorkflowKanbanCard = {
  id: string
  title: string
  context: string
  category: WorkflowKanbanCategory
  stage: WorkflowKanbanStageId
  critical: boolean
  initials: string | null
}

/** User-facing helper copy for the workflow pipeline (Operations / Active Tasks). */
export const WORKFLOW_PIPELINE_PAGE_SUBTITLE =
  'Active tasks Ulo is coordinating — not a separate work order list. Maintenance, rent, inspections, move-ins, move-outs, and lease renewals all run here.'

export const WORKFLOW_PIPELINE_SECTION_HELPER =
  'Each card is one workflow run. Open work orders live on the Work Orders page; maintenance orders Ulo is moving forward also appear here under Maintenance.'

export const WORKFLOW_PIPELINE_MAINTENANCE_FILTER_HELPER =
  'Maintenance work orders Ulo is currently helping move forward.'

function maintenanceRunKanbanPriority(row: AdminWorkflowRow): number {
  let score = 0
  if (row.templateId === 'maintenance_request') score += 100
  else if (row.templateId === 'maintenance_intake') score += 40
  if (row.status === 'active' || row.status === 'escalated') score += 30
  else if (row.status === 'completed') score += 10
  const started = new Date(row.startedAt).getTime()
  if (!Number.isNaN(started)) score += started / 1e15
  return score
}

/** One kanban card per maintenance ticket — prefer the live maintenance_request run over intake. */
export function dedupeMaintenanceWorkflowRunsForKanban(
  runs: AdminWorkflowRow[],
): AdminWorkflowRow[] {
  const passthrough: AdminWorkflowRow[] = []
  const byTicketId = new Map<string, AdminWorkflowRow>()

  for (const run of runs) {
    if (
      workflowTemplateGroupId(run.templateId) !== 'maintenance' ||
      run.entityType !== 'maintenance_request' ||
      !run.entityId?.trim()
    ) {
      passthrough.push(run)
      continue
    }

    const ticketId = run.entityId.trim()
    const existing = byTicketId.get(ticketId)
    if (!existing || maintenanceRunKanbanPriority(run) > maintenanceRunKanbanPriority(existing)) {
      byTicketId.set(ticketId, run)
    }
  }

  return [...passthrough, ...byTicketId.values()]
}

function readKanbanMetaRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return {}
}

function readKanbanMetaBool(value: unknown): boolean {
  return value === true
}

function readKanbanMetaString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed || null
}

function moveOutAutomationStarted(metadata: Record<string, unknown>): boolean {
  const checklist = readKanbanMetaRecord(metadata.checklist)
  const milestones = readKanbanMetaRecord(metadata.milestones)
  return (
    readKanbanMetaString(metadata.kickoff_source) != null ||
    readKanbanMetaString(metadata.kickoff_completed_at) != null ||
    readKanbanMetaBool(checklist.resident_notified) ||
    readKanbanMetaBool(checklist.instructions_delivered) ||
    readKanbanMetaBool(checklist.cleaning_scheduled) ||
    readKanbanMetaBool(checklist.inspection_scheduled) ||
    readKanbanMetaString(milestones.instructions_sent) != null ||
    readKanbanMetaString(milestones.cleaning_scheduled) != null
  )
}

function moveOutRunKanbanPriority(
  row: AdminWorkflowRow,
  metadata: Record<string, unknown>,
): number {
  let score = 0
  if (row.id === DEMO_MOVE_OUT_WO_D777_RUN_ID) score += 1_000
  if (moveOutAutomationStarted(metadata)) score += 500
  const step = lifecycleStepKey(row)
  if (step === 'inspection_scheduled') score += 400
  if (step === 'cleaning_scheduled' || step === 'turnover_in_progress') score += 300
  if (step === 'notice_sent') score += 200
  if (row.status === 'active') score += 50
  const started = new Date(row.startedAt).getTime()
  if (!Number.isNaN(started)) score += started / 1e15
  return score
}

/** One kanban card per move-out unit — prefer kicked-off / WO-D777 over stale duplicates. */
export function dedupeMoveOutWorkflowRunsForKanban(
  runs: AdminWorkflowRow[],
  metadataByRunId: Record<string, Record<string, unknown>> = {},
): AdminWorkflowRow[] {
  const passthrough: AdminWorkflowRow[] = []
  const byScope = new Map<string, AdminWorkflowRow>()

  for (const run of runs) {
    if (run.templateId !== 'move_out' || run.status === 'cancelled') {
      passthrough.push(run)
      continue
    }
    const scopeKey = `${run.unitId ?? run.id}:${run.residentId ?? ''}`
    const meta = metadataByRunId[run.id] ?? {}
    const existing = byScope.get(scopeKey)
    if (
      !existing ||
      moveOutRunKanbanPriority(run, meta) >
        moveOutRunKanbanPriority(existing, metadataByRunId[existing.id] ?? {})
    ) {
      byScope.set(scopeKey, run)
    }
  }

  return [...passthrough, ...byScope.values()]
}

export function collectAdminWorkflowRuns(data: AdminWorkflowDashboardData): AdminWorkflowRow[] {
  const byId = new Map<string, AdminWorkflowRow>()
  for (const row of [
    ...data.active,
    ...data.escalated,
    ...data.maintenanceRuns,
    ...data.rentCollection.runs,
    ...data.lifecycle.runs,
  ]) {
    byId.set(row.id, row)
  }
  return dedupeMoveOutWorkflowRunsForKanban(
    dedupeMaintenanceWorkflowRunsForKanban([...byId.values()]),
    data.runMetadata,
  )
}

function deriveCategory(row: AdminWorkflowRow): WorkflowKanbanCategory {
  const group = workflowTemplateGroupId(row.templateId)
  if (group === 'maintenance') return 'maintenance'
  if (group === 'rent_collection') return 'payment'
  if (group === 'move_in') return 'move_in'
  if (group === 'move_out') return 'move_out'
  if (group === 'inspection') return 'inspection'
  if (row.templateId === 'lease_renewal') return 'lease'
  return 'other'
}

function deriveRentCollectionStage(row: AdminWorkflowRow): WorkflowKanbanStageId {
  if (row.status === 'completed') return 'completed'
  if (row.status === 'escalated') return 'in_progress'

  const step = (row.currentStep ?? '').toLowerCase()
  const event = (row.lastEventType ?? '').toLowerCase()
  const hay = `${step} ${event}`

  if (/paid|complete|closed|done/.test(hay) || event === 'rent.payment_received') {
    return 'completed'
  }
  if (
    /reminder|await|payment_requested|payment_reminder|late_escal|overdue|outreach/.test(hay) ||
    event === 'rent.reminder_sent' ||
    event === 'rent.payment_requested' ||
    event === 'rent.late_escalated'
  ) {
    return 'in_progress'
  }
  if (
    /initiated|classified|routed|due|detect/.test(hay) ||
    event === 'rent.due_detected' ||
    event === 'workflow.trigger'
  ) {
    return 'assigned'
  }
  return row.status === 'active' ? 'in_progress' : 'assigned'
}

/** Prefer workflow_runs.current_step; fall back to the suffix of the latest domain event. */
export function lifecycleStepKey(row: AdminWorkflowRow): string {
  const step = (row.currentStep ?? '').trim().toLowerCase()
  if (step) return step

  const event = (row.lastEventType ?? '').trim().toLowerCase()
  const dot = event.lastIndexOf('.')
  if (dot >= 0) return event.slice(dot + 1)
  return event
}

function deriveMoveInKanbanStage(row: AdminWorkflowRow): WorkflowKanbanStageId {
  if (row.status === 'completed') return 'completed'
  if (row.status === 'escalated') return 'in_progress'

  const step = lifecycleStepKey(row)
  const event = (row.lastEventType ?? '').toLowerCase()

  if (step === 'completed' || step === 'logged' || event.includes('unit_activated')) {
    return 'completed'
  }
  if (step === 'awaiting_confirm' || step === 'utilities_confirmed' || step === 'escalated') {
    return 'in_progress'
  }
  if (step === 'checklist_sent' || event.includes('checklist_sent')) {
    return 'assigned'
  }
  if (step === 'initiated' || step === 'started' || step === 'occupancy_registered') {
    return 'new_intake'
  }
  return 'new_intake'
}

function deriveMoveOutKanbanStage(
  row: AdminWorkflowRow,
  metadata: Record<string, unknown> = {},
): WorkflowKanbanStageId {
  if (row.status === 'completed') return 'completed'
  if (row.status === 'escalated') return 'in_progress'

  const needsAdminApproval = readKanbanMetaBool(metadata.needs_admin_approval)
  const step = lifecycleStepKey(row)
  const event = (row.lastEventType ?? '').toLowerCase()

  if (
    step === 'completed' ||
    step === 'logged' ||
    event.includes('unit_vacated') ||
    event.includes('move_out.completed')
  ) {
    return 'completed'
  }

  // New Intake is only for move-outs blocked on explicit admin approval.
  if (needsAdminApproval) return 'new_intake'

  if (
    moveOutAutomationStarted(metadata) ||
    step === 'awaiting_vacate' ||
    step === 'turnover_in_progress' ||
    step === 'turnover_tasks' ||
    step === 'unit_vacated' ||
    step === 'cleaning_scheduled' ||
    step === 'inspection_scheduled' ||
    step === 'inspection_completed' ||
    step === 'deposit_pending' ||
    step === 'escalated'
  ) {
    return 'in_progress'
  }

  if (step === 'notice_sent' || event.includes('notice_sent')) {
    return 'assigned'
  }

  // Lease-renewal kickoff and dashboard starts proceed via automation — not intake queue.
  if (row.status === 'active') return 'in_progress'

  return 'new_intake'
}

function deriveInspectionKanbanStage(row: AdminWorkflowRow): WorkflowKanbanStageId {
  if (row.status === 'completed') return 'completed'
  if (row.status === 'escalated') return 'in_progress'

  const step = lifecycleStepKey(row)
  const event = (row.lastEventType ?? '').toLowerCase()

  if (step === 'completed' || step === 'logged' || event.includes('inspection.completed')) {
    return 'completed'
  }
  if (
    step === 'awaiting_resident' ||
    step === 'awaiting_completion' ||
    step === 'in_progress' ||
    step === 'rescheduled' ||
    step === 'no_show' ||
    step === 'escalated'
  ) {
    return 'in_progress'
  }
  if (step === 'notice_sent' || event.includes('notice_sent')) {
    return 'assigned'
  }
  if (step === 'initiated' || step === 'started' || step === 'scheduled') {
    return 'new_intake'
  }
  return 'new_intake'
}

function deriveMaintenanceKanbanStage(row: AdminWorkflowRow): WorkflowKanbanStageId {
  if (row.status === 'completed') return 'completed'

  const step = (row.currentStep ?? '').toLowerCase()
  const event = (row.lastEventType ?? '').toLowerCase()
  const hay = `${step} ${event}`
  if (/complete|closed|done/.test(hay)) return 'completed'

  // Unfinished maintenance always sits in In Progress — avoids looking like a second work-order board.
  return 'in_progress'
}

export function deriveWorkflowKanbanStage(
  row: AdminWorkflowRow,
  metadata: Record<string, unknown> = {},
): WorkflowKanbanStageId {
  if (row.templateId === 'rent_collection') {
    return deriveRentCollectionStage(row)
  }
  if (row.templateId === 'move_in') {
    return deriveMoveInKanbanStage(row)
  }
  if (row.templateId === 'move_out') {
    return deriveMoveOutKanbanStage(row, metadata)
  }
  if (row.templateId === 'inspection' || row.templateId === 'unit_inspection') {
    return deriveInspectionKanbanStage(row)
  }

  const group = workflowTemplateGroupId(row.templateId)
  if (group === 'maintenance') {
    return deriveMaintenanceKanbanStage(row)
  }

  return deriveMaintenanceKanbanStage(row)
}

function deriveInitials(row: AdminWorkflowRow): string | null {
  const name = row.residentName?.trim()
  if (!name) return null
  const parts = name.split(/\s+/).filter(Boolean)
  if (!parts.length) return null
  const first = parts[0][0] ?? ''
  const last = parts.length > 1 ? (parts[parts.length - 1][0] ?? '') : ''
  return (first + last).toUpperCase() || null
}

export function buildWorkflowKanbanCard(
  row: AdminWorkflowRow,
  metadata: Record<string, unknown> = {},
): WorkflowKanbanCard {
  return {
    id: row.id,
    title: row.templateId === 'move_out' ? 'Move-Out Preparation' : row.templateName,
    context: formatLocationContextLabel({
      propertyLabel: row.propertyLabel,
      unitLabel: row.unitLabel,
      residentName: row.residentName,
    }),
    category: deriveCategory(row),
    stage: deriveWorkflowKanbanStage(row, metadata),
    critical: row.status === 'escalated',
    initials: deriveInitials(row),
  }
}

export function isOpenWorkflowKanbanCard(card: WorkflowKanbanCard): boolean {
  return card.stage !== 'completed'
}

/** True when a workflow run had started by `atMs` and had not completed yet. */
export function isWorkflowRunActiveAt(run: AdminWorkflowRow, atMs: number): boolean {
  const started = new Date(run.startedAt).getTime()
  if (Number.isNaN(started) || started > atMs) return false
  if (run.completedAt) {
    const completed = new Date(run.completedAt).getTime()
    return Number.isNaN(completed) || completed > atMs
  }
  return run.status === 'active' || run.status === 'escalated'
}

function activeOperationsBucket(row: AdminWorkflowRow): OperationsBreakdownLine['id'] {
  if (row.templateId === 'lease_renewal') return 'lease'
  const group = workflowTemplateGroupId(row.templateId)
  if (group === 'maintenance') return 'maintenance'
  if (group === 'rent_collection') return 'rent'
  if (group === 'move_in') return 'move_in'
  if (group === 'move_out') return 'move_out'
  if (group === 'inspection') return 'inspection'
  return 'other'
}

const ACTIVE_OPS_LINE_LABELS: Record<OperationsBreakdownLine['id'], string> = {
  maintenance: 'Maintenance',
  rent: 'Rent collection',
  move_in: 'Move-ins',
  move_out: 'Move-outs',
  inspection: 'Inspections',
  lease: 'Lease renewals',
  other: 'Other',
}

const ACTIVE_OPS_LINE_ORDER: OperationsBreakdownLine['id'][] = [
  'maintenance',
  'rent',
  'move_in',
  'move_out',
  'inspection',
  'lease',
  'other',
]

/** Portfolio active operations total and per-type breakdown (matches Overview KPI rules). */
export function snapshotActiveOperations(
  workflowData: AdminWorkflowDashboardData | null | undefined,
  atMs: number = Date.now(),
): ActiveOperationsSnapshot {
  const counts = new Map<OperationsBreakdownLine['id'], number>()
  for (const id of ACTIVE_OPS_LINE_ORDER) counts.set(id, 0)

  if (workflowData) {
    for (const run of collectAdminWorkflowRuns(workflowData)) {
      if (!isWorkflowRunActiveAt(run, atMs)) continue
      const bucket = activeOperationsBucket(run)
      counts.set(bucket, (counts.get(bucket) ?? 0) + 1)
    }
  }

  const lines = ACTIVE_OPS_LINE_ORDER.map((id) => ({
    id,
    label: ACTIVE_OPS_LINE_LABELS[id],
    count: counts.get(id) ?? 0,
  })).filter((line) => line.count > 0)

  const total = lines.reduce((sum, line) => sum + line.count, 0)
  return { total, lines }
}

export function countOpenWorkflowsForBuilding(
  workflowData: AdminWorkflowDashboardData | null | undefined,
  building: string,
): number {
  if (!workflowData || !building.trim()) return 0
  const buildingKey = normalizeBuildingKey(building)
  return collectAdminWorkflowRuns(workflowData)
    .filter((row) => normalizeBuildingKey(row.propertyLabel) === buildingKey)
    .map((row) => buildWorkflowKanbanCard(row, workflowData.runMetadata[row.id]))
    .filter(isOpenWorkflowKanbanCard).length
}

export function workflowOperationsPath(runId?: string): string {
  if (!runId) return '/admin/workflows'
  return `/admin/workflows?run=${encodeURIComponent(runId)}`
}
