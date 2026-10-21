/**
 * Edge mirror of src/lib/adminWorkflowKanban deriveMaintenanceKanbanStage
 * for stale fromStage checks. Keep in sync with the client helper.
 */
export type EdgeKanbanStageId =
  | "new_intake"
  | "assigned"
  | "in_progress"
  | "completed"

export function deriveTicketKanbanStage(input: {
  vendorWorkStatus?: string | null
  assignedVendorId?: string | null
  runStatus?: string | null
  currentStep?: string | null
}): EdgeKanbanStageId {
  const vendorStatus = (input.vendorWorkStatus ?? "").trim().toLowerCase()
  if (vendorStatus) {
    if (vendorStatus === "completed" || vendorStatus === "cancelled") {
      return "completed"
    }
    if (vendorStatus === "in_progress" || vendorStatus === "accepted") {
      return "in_progress"
    }
    if (vendorStatus === "pending_accept" || vendorStatus === "declined") {
      return "assigned"
    }
    if (vendorStatus === "unassigned") return "new_intake"
  }

  if (input.assignedVendorId?.trim()) return "assigned"

  const step = (input.currentStep ?? "").toLowerCase()
  if (step === "completed" || /complete|closed|done/.test(step)) return "completed"
  if (step === "in_progress") return "in_progress"
  if ((input.runStatus ?? "").toLowerCase() === "completed") return "completed"
  return "new_intake"
}

function isTerminalVendorWorkStatus(status: string | null | undefined): boolean {
  const vws = (status ?? "").trim().toLowerCase()
  return vws === "completed" || vws === "cancelled"
}

/**
 * Rollup stage for an inspection visit (multiple fail-item tickets).
 * Mirrors `deriveInspectionGroupKanbanStage` in src/lib/adminWorkflowKanban.ts
 * (without the stale needs-admin nuance — unfinished unassigned → new_intake).
 */
export function deriveInspectionVisitKanbanStage(
  items: Array<{
    vendorWorkStatus?: string | null
    assignedVendorId?: string | null
  }>,
): EdgeKanbanStageId {
  if (items.length === 0) return "new_intake"
  if (items.every((item) => isTerminalVendorWorkStatus(item.vendorWorkStatus))) {
    return "completed"
  }
  const statuses = items.map((item) => (item.vendorWorkStatus ?? "").trim().toLowerCase())
  if (statuses.some((s) => s === "in_progress" || s === "accepted")) {
    return "in_progress"
  }
  const unfinished = items.filter(
    (item) => !isTerminalVendorWorkStatus(item.vendorWorkStatus),
  )
  const unfinishedAreNewIntake =
    unfinished.length > 0 &&
    unfinished.every((item) => {
      const s = (item.vendorWorkStatus ?? "").trim().toLowerCase()
      return s === "unassigned" || !s || !item.assignedVendorId?.trim()
    })
  if (unfinishedAreNewIntake) {
    return "new_intake"
  }
  if (statuses.some((s) => s === "pending_accept" || s === "declined")) {
    return "assigned"
  }
  if (statuses.some((s) => s === "unassigned" || !s)) {
    if (
      statuses.some(
        (s) =>
          s === "pending_accept" ||
          s === "declined" ||
          s === "accepted" ||
          s === "in_progress",
      )
    ) {
      return "assigned"
    }
    return "new_intake"
  }
  return "assigned"
}
