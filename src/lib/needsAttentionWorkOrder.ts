import {
  isSettledOnActiveTasks,
  maintenanceTicketIdFromWorkflowRun,
  type AdminWorkflowDashboardData,
  type AdminWorkflowRow,
} from '@/lib/adminWorkflows'
import {
  collectAdminWorkflowRuns,
  deriveWorkflowKanbanStage,
} from '@/lib/adminWorkflowKanban'

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
    if (deriveWorkflowKanbanStage(run, metadata) !== 'completed') continue
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
  const patched: AdminWorkflowRow = {
    ...input.run,
    vendorWorkStatus: vendorWorkStatus ?? input.run.vendorWorkStatus,
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
