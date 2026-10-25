import {
  formatInspectionReportRef,
  formatLocationContextLabel,
  isSettledOnActiveTasks,
  maintenanceTicketIdFromWorkflowRun,
  type AdminWorkflowDashboardData,
  type AdminWorkflowRow,
  type InspectionGroupTicketItem,
} from '@/lib/adminWorkflows'
import {
  collectAdminWorkflowRuns,
  deriveWorkflowKanbanStage,
} from '@/lib/adminWorkflowKanban'
import { inspectionItemAttentionSummary } from '@/lib/needsAttentionSummary'
import { formatWorkOrderRefFromTicketId } from '@/lib/vendorCallFlow'

export function collectCompletedWorkOrderTicketIds(input: {
  tickets: Array<{ id: string; vendorWorkStatus?: string | null }>
  workflowData: AdminWorkflowDashboardData | null
}): Set<string> {
  const ids = new Set<string>()
  for (const ticket of input.tickets) {
    if (!ticket.id) continue
    if (isSettledOnActiveTasks({ vendorWorkStatus: ticket.vendorWorkStatus })) {
      ids.add(ticket.id)
    }
  }
  if (!input.workflowData) return ids
  for (const run of collectAdminWorkflowRuns(input.workflowData)) {
    const metadata = input.workflowData.runMetadata[run.id]
    // Per-ticket completion — ignore inspection-group rollup for this helper.
    const single: AdminWorkflowRow = {
      ...run,
      inspectionReportId: null,
      inspectionGroupItems: null,
    }
    if (deriveWorkflowKanbanStage(single, metadata) !== 'completed') continue
    const ticketId = maintenanceTicketIdFromWorkflowRun({ ...run, metadata })
    if (ticketId) ids.add(ticketId)
  }
  return ids
}

/** Same closed rule as Active Tasks Completed — hide from Needs Your Attention. */
export function shouldOmitEscalatedRunFromNeedsAttention(input: {
  run: AdminWorkflowRow
  metadata?: Record<string, unknown>
  linkedTicketVendorWorkStatus?: string | null
  completedTicketIds: Set<string>
}): boolean {
  const vendorWorkStatus =
    input.linkedTicketVendorWorkStatus ?? input.run.vendorWorkStatus
  const workStatus = (vendorWorkStatus ?? '').trim().toLowerCase()
  if (workStatus === 'accepted' || workStatus === 'in_progress') {
    return true
  }
  if (isSettledOnActiveTasks({ status: input.run.status, vendorWorkStatus })) {
    return true
  }
  // Attention is per-ticket: do not use inspection-group rollup stage here.
  const patched: AdminWorkflowRow = {
    ...input.run,
    vendorWorkStatus: vendorWorkStatus ?? input.run.vendorWorkStatus,
    inspectionReportId: null,
    inspectionGroupItems: null,
  }
  if (deriveWorkflowKanbanStage(patched, input.metadata) === 'completed') {
    return true
  }
  const ticketId = maintenanceTicketIdFromWorkflowRun({
    ...input.run,
    metadata: input.metadata,
  })
  return Boolean(ticketId && input.completedTicketIds.has(ticketId))
}

/**
 * Needs Your Attention stays per-item for inspection groups (escalation urgency
 * on one fail item must not hide behind group progress). Copy scopes the row
 * with the item and its place in the visit. The property stays in the
 * location column.
 */
export function formatInspectionAttentionMeta(input: {
  itemIndex: number
  itemTotal: number
  itemLabel: string
}): string {
  return inspectionItemAttentionSummary(input)
}

export function resolveInspectionAttentionContext(input: {
  ticketId: string
  run?: AdminWorkflowRow | null
  workflowData?: AdminWorkflowDashboardData | null
}): {
  reportId: string
  reportRef: string
  itemIndex: number
  itemTotal: number
  itemLabel: string
  workOrderRef: string
  items: InspectionGroupTicketItem[]
} | null {
  const fromRun = input.run?.inspectionGroupItems?.length
    ? input.run
    : input.workflowData
      ? collectAdminWorkflowRuns(input.workflowData).find(
          (row) =>
            row.inspectionReportId &&
            row.inspectionGroupItems?.some((item) => item.ticketId === input.ticketId),
        )
      : null
  const items = fromRun?.inspectionGroupItems
  const reportId = fromRun?.inspectionReportId?.trim()
  if (!items || items.length < 2 || !reportId) return null
  const index = items.findIndex((item) => item.ticketId === input.ticketId)
  if (index < 0) return null
  const item = items[index]!
  return {
    reportId,
    reportRef: formatInspectionReportRef(reportId),
    itemIndex: index + 1,
    itemTotal: items.length,
    itemLabel: item.label,
    workOrderRef: item.workOrderRef || formatWorkOrderRefFromTicketId(input.ticketId),
    items,
  }
}

export function buildInspectionScopedAttentionCopy(input: {
  ticketId: string
  run?: AdminWorkflowRow | null
  workflowData?: AdminWorkflowDashboardData | null
  propertyLabel?: string | null
  unitLabel?: string | null
  residentName?: string | null
  fallbackMeta: string
}): { meta: string; context: string } {
  const ctx = resolveInspectionAttentionContext({
    ticketId: input.ticketId,
    run: input.run,
    workflowData: input.workflowData,
  })
  const context = formatLocationContextLabel({
    propertyLabel: input.propertyLabel ?? null,
    unitLabel: input.unitLabel ?? null,
    residentName: input.residentName ?? null,
  })
  if (!ctx) {
    return { meta: input.fallbackMeta, context }
  }
  return {
    meta: formatInspectionAttentionMeta({
      itemIndex: ctx.itemIndex,
      itemTotal: ctx.itemTotal,
      itemLabel: ctx.itemLabel,
    }),
    context,
  }
}
