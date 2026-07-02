import {
  formatLocationContextLabel,
  workflowTemplateGroupId,
  type AdminWorkflowDashboardData,
  type AdminWorkflowRow,
} from '@/lib/adminWorkflows'
import { normalizeBuildingKey } from '@/lib/propertyHealth'

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
  return [...byId.values()]
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

function deriveMoveOutKanbanStage(row: AdminWorkflowRow): WorkflowKanbanStageId {
  if (row.status === 'completed') return 'completed'
  if (row.status === 'escalated') return 'in_progress'

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
  if (
    step === 'awaiting_vacate' ||
    step === 'turnover_in_progress' ||
    step === 'turnover_tasks' ||
    step === 'unit_vacated' ||
    step === 'inspection_scheduled' ||
    step === 'deposit_pending' ||
    step === 'escalated'
  ) {
    return 'in_progress'
  }
  if (step === 'notice_sent' || event.includes('notice_sent')) {
    return 'assigned'
  }
  if (step === 'initiated' || step === 'started') {
    return 'new_intake'
  }
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
  if (row.status === 'escalated') return 'in_progress'

  const step = (row.currentStep ?? '').toLowerCase()
  const event = (row.lastEventType ?? '').toLowerCase()
  const hay = `${step} ${event}`

  if (/complete|closed|done|paid|activated|vacated/.test(hay)) return 'completed'
  if (/wait|pending|await|hold|reminder|notice|response|review/.test(hay)) return 'in_progress'
  if (/act|in_progress|progress|working|repair|schedul/.test(hay)) return 'in_progress'
  if (/classif|route|assign|dispatch|vendor/.test(hay)) return 'assigned'
  if (/trigger|intake|new|received|created|start|detect/.test(hay)) return 'new_intake'
  return 'new_intake'
}

export function deriveWorkflowKanbanStage(row: AdminWorkflowRow): WorkflowKanbanStageId {
  if (row.templateId === 'rent_collection') {
    return deriveRentCollectionStage(row)
  }
  if (row.templateId === 'move_in') {
    return deriveMoveInKanbanStage(row)
  }
  if (row.templateId === 'move_out') {
    return deriveMoveOutKanbanStage(row)
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

export function buildWorkflowKanbanCard(row: AdminWorkflowRow): WorkflowKanbanCard {
  return {
    id: row.id,
    title: row.templateName,
    context: formatLocationContextLabel({
      propertyLabel: row.propertyLabel,
      unitLabel: row.unitLabel,
      residentName: row.residentName,
    }),
    category: deriveCategory(row),
    stage: deriveWorkflowKanbanStage(row),
    critical: row.status === 'escalated',
    initials: deriveInitials(row),
  }
}

export function isOpenWorkflowKanbanCard(card: WorkflowKanbanCard): boolean {
  return card.stage !== 'completed'
}

export function countOpenWorkflowsForBuilding(
  workflowData: AdminWorkflowDashboardData | null | undefined,
  building: string,
): number {
  if (!workflowData || !building.trim()) return 0
  const buildingKey = normalizeBuildingKey(building)
  return collectAdminWorkflowRuns(workflowData)
    .filter((row) => normalizeBuildingKey(row.propertyLabel) === buildingKey)
    .map(buildWorkflowKanbanCard)
    .filter(isOpenWorkflowKanbanCard).length
}

export function workflowOperationsPath(runId?: string): string {
  if (!runId) return '/admin/workflows'
  return `/admin/workflows?run=${encodeURIComponent(runId)}`
}
