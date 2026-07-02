import type {
  AdminLifecycleRow,
  AdminWorkflowDashboardData,
  AdminWorkflowRow,
} from '@/lib/adminWorkflows'
import type { WorkflowKanbanCard } from '@/lib/adminWorkflowKanban'

export type InspectionKind = 'preventive' | 'periodic' | 'annual' | 'unknown'

export type InspectionWorkflowContext = {
  kind: InspectionKind
  isOverdue: boolean
  isScheduledFuture: boolean
  scheduledAt: string | null
  inspectionType: string | null
}

export function findLifecycleRowForRun(
  workflowData: AdminWorkflowDashboardData | null | undefined,
  runId: string,
): AdminLifecycleRow | null {
  if (!workflowData) return null
  return workflowData.lifecycle.runs.find((row) => row.id === runId) ?? null
}

export function resolveInspectionKind(lifecycle: AdminLifecycleRow | null): InspectionKind {
  const raw = `${lifecycle?.inspectionType ?? ''} ${lifecycle?.lifecycleClassification ?? ''}`
    .trim()
    .toLowerCase()
  if (!raw) return 'unknown'
  if (raw.includes('prevent') || raw.includes('pm')) return 'preventive'
  if (raw.includes('periodic')) return 'periodic'
  if (raw.includes('annual')) return 'annual'
  return 'unknown'
}

function parseScheduledAt(value: string | null | undefined): Date | null {
  if (!value?.trim()) return null
  const trimmed = value.trim()
  const date = trimmed.includes('T')
    ? new Date(trimmed)
    : new Date(`${trimmed.slice(0, 10)}T23:59:59`)
  return Number.isNaN(date.getTime()) ? null : date
}

export function isInspectionWorkflow(row: AdminWorkflowRow, card: WorkflowKanbanCard): boolean {
  return card.category === 'inspection' || row.templateId === 'inspection' || row.templateId === 'unit_inspection'
}

export function buildInspectionWorkflowContext(
  row: AdminWorkflowRow,
  lifecycle: AdminLifecycleRow | null,
  now = Date.now(),
): InspectionWorkflowContext {
  const scheduledAt = lifecycle?.scheduledAt ?? null
  const scheduledDate = parseScheduledAt(scheduledAt)
  const isOverdue =
    row.status === 'escalated' ||
    (row.status === 'active' && scheduledDate != null && scheduledDate.getTime() < now)
  const isScheduledFuture =
    row.status === 'active' && scheduledDate != null && scheduledDate.getTime() >= now

  return {
    kind: resolveInspectionKind(lifecycle),
    isOverdue,
    isScheduledFuture,
    scheduledAt,
    inspectionType: lifecycle?.inspectionType ?? null,
  }
}

function mentionsHvac(text: string): boolean {
  return /hvac|roof|heat|cooling|air.?condition/i.test(text)
}

/** User-facing inspection title — distinguishes preventive vs compliance vs overdue. */
export function inspectionWorkflowTitle(
  row: AdminWorkflowRow,
  lifecycle: AdminLifecycleRow | null,
  context: InspectionWorkflowContext,
): string {
  const haystack = `${lifecycle?.inspectionType ?? ''} ${row.lastEventMessage ?? ''} ${row.templateName}`
  const hvac = mentionsHvac(haystack)

  if (context.kind === 'preventive') {
    if (context.isOverdue) {
      return hvac ? 'Overdue preventive HVAC inspection' : 'Overdue preventive inspection'
    }
    return hvac ? 'Preventive HVAC inspection scheduled' : 'Preventive inspection scheduled'
  }

  if (context.kind === 'periodic') {
    if (context.isOverdue) return 'Overdue periodic inspection'
    return 'Periodic inspection scheduled'
  }

  if (context.kind === 'annual') {
    if (context.isOverdue) return 'Overdue annual inspection'
    return 'Annual inspection scheduled'
  }

  if (context.isOverdue) return hvac ? 'Overdue HVAC inspection' : 'Overdue inspection'
  return hvac ? 'HVAC inspection scheduled' : 'Inspection scheduled'
}

export function inspectionWorkflowMetaLabel(context: InspectionWorkflowContext): string {
  switch (context.kind) {
    case 'preventive':
      return 'Preventive inspection'
    case 'periodic':
      return 'Periodic inspection'
    case 'annual':
      return 'Annual inspection'
    default:
      return 'Inspection'
  }
}

export function inspectionPriorityPresentation(context: InspectionWorkflowContext): {
  label: string
  className: string
  isUrgent: boolean
} {
  if (context.isOverdue) {
    return { label: 'overdue', className: 'bg-[#ffedd5] text-[#c2410c]', isUrgent: false }
  }
  if (context.isScheduledFuture || context.kind === 'preventive' || context.kind === 'periodic') {
    return { label: 'scheduled', className: 'bg-[#dbeafe] text-[#1447e6]', isUrgent: false }
  }
  if (context.kind === 'annual') {
    return { label: 'med', className: 'bg-[#ffedd5] text-[#c2410c]', isUrgent: false }
  }
  return { label: 'low', className: 'bg-[#f3f4f6] text-[#6a7282]', isUrgent: false }
}

/** Preventive/periodic inspections only belong in urgent review when overdue or escalated. */
export function qualifiesForUrgentReview(
  row: AdminWorkflowRow,
  card: WorkflowKanbanCard,
  lifecycle: AdminLifecycleRow | null,
  maintenanceUrgent: boolean,
): boolean {
  if (row.status === 'escalated' || card.critical) return true
  if (!isInspectionWorkflow(row, card)) return maintenanceUrgent

  const context = buildInspectionWorkflowContext(row, lifecycle)
  if (context.kind === 'preventive' || context.kind === 'periodic') {
    return context.isOverdue
  }
  return context.isOverdue || context.kind === 'annual'
}

export function formatInspectionStatusSuffix(context: InspectionWorkflowContext): string | null {
  if (context.isOverdue) return 'Overdue'
  if (context.isScheduledFuture && context.scheduledAt) {
    const date = parseScheduledAt(context.scheduledAt)
    if (!date) return 'Scheduled'
    return `Scheduled ${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
  }
  return null
}
