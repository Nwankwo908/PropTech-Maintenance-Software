const LIVE_ASSIGNMENT_WORK_STATUSES = new Set([
  "pending_accept",
  "accepted",
  "in_progress",
])

/**
 * SLA rematch skip must follow the ticket, not a stale `no_vendor_available` run.
 */
export function shouldSkipSlaReassignForNeedsAdminVendor(input: {
  assignedVendorId?: string | null
  vendorWorkStatus?: string | null
  workflowNeedsAdminVendor: boolean
}): boolean {
  if (!input.workflowNeedsAdminVendor) return false
  const assigned = Boolean(input.assignedVendorId?.trim())
  const status = (input.vendorWorkStatus ?? "").trim().toLowerCase()
  if (assigned) return false
  if (LIVE_ASSIGNMENT_WORK_STATUSES.has(status)) return false
  return true
}
