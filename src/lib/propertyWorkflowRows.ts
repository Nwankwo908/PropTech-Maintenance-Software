import type { AdminWorkflowDashboardData, AdminWorkflowRow } from '@/lib/adminWorkflows'
import {
  buildWorkflowKanbanCard,
  collectAdminWorkflowRuns,
  isOpenWorkflowKanbanCard,
  WORKFLOW_CATEGORY_BADGE,
  WORKFLOW_STAGE_LABEL,
  type WorkflowKanbanCard,
  type WorkflowKanbanCategory,
} from '@/lib/adminWorkflowKanban'
import {
  buildInspectionWorkflowContext,
  findLifecycleRowForRun,
  formatInspectionStatusSuffix,
  inspectionPriorityPresentation,
  inspectionWorkflowMetaLabel,
  inspectionWorkflowTitle,
  isInspectionWorkflow,
  qualifiesForUrgentReview,
} from '@/lib/inspectionWorkflow'
import { normalizeBuildingKey } from '@/lib/propertyHealth'

export type PropertyWorkflowTicket = {
  id: string
  issueCategory: string | null
  urgency: string
}

export type PropertyWorkflowRow = {
  id: string
  title: string
  metaLine: string
  priorityLabel: string
  priorityClassName: string
  statusLabel: string
  isUrgent: boolean
  startedAt: string
}

function buildingShortName(building: string): string {
  return building.replace(/\s+Apartments$/i, '').trim() || building
}

function categoryMetaLabel(category: WorkflowKanbanCategory): string {
  if (category === 'move_in') return 'Move-in'
  if (category === 'move_out') return 'Move-out'
  return WORKFLOW_CATEGORY_BADGE[category].label
}

function workflowStatusLabel(
  row: AdminWorkflowRow,
  card: WorkflowKanbanCard,
  lifecycle: ReturnType<typeof findLifecycleRowForRun>,
): string {
  if (isInspectionWorkflow(row, card)) {
    const suffix = formatInspectionStatusSuffix(buildInspectionWorkflowContext(row, lifecycle))
    if (suffix) return suffix
  }
  const step = (row.currentStep ?? '').toLowerCase()
  const event = (row.lastEventType ?? '').toLowerCase()
  if (/classif/.test(step) || event.includes('classify')) return 'Classified'
  return WORKFLOW_STAGE_LABEL[card.stage]
}

function workflowListTitle(
  row: AdminWorkflowRow,
  card: WorkflowKanbanCard,
  issueCategory: string | null,
  urgency: string | null,
  lifecycle: ReturnType<typeof findLifecycleRowForRun>,
): string {
  if (isInspectionWorkflow(row, card)) {
    const context = buildInspectionWorkflowContext(row, lifecycle)
    return inspectionWorkflowTitle(row, lifecycle, context)
  }

  const category = (issueCategory ?? '').toLowerCase()
  const urgent =
    card.critical ||
    row.status === 'escalated' ||
    urgency === 'emergency' ||
    urgency === 'urgent'

  if (category.includes('plumb') && urgent) return 'Emergency plumbing'
  if (category.includes('plumb')) return 'Plumbing issue'
  if (
    category.includes('hvac') ||
    category.includes('cool') ||
    category.includes('heat') ||
    category.includes('air')
  ) {
    return 'AC not cooling'
  }
  if (row.templateId === 'rent_collection' || card.category === 'payment') return 'Rent question'
  if (card.category === 'move_in') return 'Utilities setup — new tenant'
  if (/hvac/i.test(row.templateName)) return 'HVAC tune-up'

  return row.templateName
}

function workflowPriority(
  row: AdminWorkflowRow,
  card: WorkflowKanbanCard,
  issueCategory: string | null,
  urgency: string | null,
  lifecycle: ReturnType<typeof findLifecycleRowForRun>,
): { label: string; className: string; isUrgent: boolean } {
  if (isInspectionWorkflow(row, card)) {
    if (row.status === 'escalated' || card.critical) {
      return { label: 'high', className: 'bg-[#ffe2e2] text-[#c10007]', isUrgent: true }
    }
    return inspectionPriorityPresentation(buildInspectionWorkflowContext(row, lifecycle))
  }

  const hay = `${issueCategory ?? ''} ${urgency ?? ''} ${row.templateId} ${row.lastEventType ?? ''}`.toLowerCase()
  const isUrgent =
    card.critical ||
    row.status === 'escalated' ||
    urgency === 'emergency' ||
    urgency === 'urgent' ||
    hay.includes('emergency')

  if (isUrgent) {
    return { label: 'high', className: 'bg-[#ffe2e2] text-[#c10007]', isUrgent: true }
  }
  if (card.category === 'payment' || card.stage === 'completed') {
    return { label: 'low', className: 'bg-[#f3f4f6] text-[#6a7282]', isUrgent: false }
  }
  return { label: 'med', className: 'bg-[#ffedd5] text-[#c2410c]', isUrgent: false }
}

function buildMetaLine(
  building: string,
  unitLabel: string | null,
  category: WorkflowKanbanCategory,
  row: AdminWorkflowRow,
  card: WorkflowKanbanCard,
  lifecycle: ReturnType<typeof findLifecycleRowForRun>,
): string {
  const parts = [buildingShortName(building)]
  if (unitLabel?.trim()) parts.push(unitLabel.trim())
  if (isInspectionWorkflow(row, card)) {
    parts.push(inspectionWorkflowMetaLabel(buildInspectionWorkflowContext(row, lifecycle)))
  } else {
    parts.push(categoryMetaLabel(category))
  }
  return parts.join(' · ')
}

function ticketForWorkflow(
  row: AdminWorkflowRow,
  ticketsById: Map<string, PropertyWorkflowTicket>,
): PropertyWorkflowTicket | null {
  if (row.entityType !== 'maintenance_request' || !row.entityId) return null
  return ticketsById.get(row.entityId) ?? null
}

export function evaluatePropertyWorkflow(input: {
  row: AdminWorkflowRow
  workflowData: AdminWorkflowDashboardData | null
  issueCategory?: string | null
  urgency?: string | null
}) {
  const card = buildWorkflowKanbanCard(input.row)
  const lifecycle = findLifecycleRowForRun(input.workflowData, input.row.id)
  const priority = workflowPriority(
    input.row,
    card,
    input.issueCategory ?? null,
    input.urgency ?? null,
    lifecycle,
  )
  const title = workflowListTitle(
    input.row,
    card,
    input.issueCategory ?? null,
    input.urgency ?? null,
    lifecycle,
  )

  return {
    card,
    lifecycle,
    priority,
    title,
    showInUrgentReview: qualifiesForUrgentReview(
      input.row,
      card,
      lifecycle,
      priority.isUrgent,
    ),
  }
}

/** Open property workflows for the Workflows tab (includes urgent/escalated items). */
export function buildPropertyWorkflowRows(input: {
  building: string
  workflowData: AdminWorkflowDashboardData | null
  tickets?: PropertyWorkflowTicket[]
}): PropertyWorkflowRow[] {
  const { building, workflowData, tickets = [] } = input
  if (!workflowData) return []

  const ticketsById = new Map(tickets.map((ticket) => [ticket.id, ticket]))

  return collectAdminWorkflowRuns(workflowData)
    .filter((row) => normalizeBuildingKey(row.propertyLabel) === normalizeBuildingKey(building))
    .filter((row) => row.status !== 'cancelled')
    .map((row) => {
      const card = buildWorkflowKanbanCard(row)
      const ticket = ticketForWorkflow(row, ticketsById)
      const lifecycle = findLifecycleRowForRun(workflowData, row.id)
      const priority = workflowPriority(
        row,
        card,
        ticket?.issueCategory ?? null,
        ticket?.urgency ?? null,
        lifecycle,
      )

      return {
        row,
        card,
        ticket,
        lifecycle,
        priority,
      }
    })
    .filter(({ card }) => isOpenWorkflowKanbanCard(card))
    .sort((a, b) => {
      if (a.priority.isUrgent !== b.priority.isUrgent) return a.priority.isUrgent ? -1 : 1
      if (a.card.critical !== b.card.critical) return a.card.critical ? -1 : 1
      return new Date(b.row.startedAt).getTime() - new Date(a.row.startedAt).getTime()
    })
    .map(({ row, card, ticket, lifecycle, priority }) => ({
      id: row.id,
      title: workflowListTitle(
        row,
        card,
        ticket?.issueCategory ?? null,
        ticket?.urgency ?? null,
        lifecycle,
      ),
      metaLine: buildMetaLine(building, row.unitLabel, card.category, row, card, lifecycle),
      priorityLabel: priority.label,
      priorityClassName: priority.className,
      statusLabel: workflowStatusLabel(row, card, lifecycle),
      isUrgent: priority.isUrgent,
      startedAt: row.startedAt,
    }))
}
