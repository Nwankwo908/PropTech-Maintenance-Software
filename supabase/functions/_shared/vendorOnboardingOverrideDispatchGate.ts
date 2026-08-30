export function isTicketAwaitingVendorAssignment(row: {
  assigned_vendor_id?: string | null
  vendor_work_status?: string | null
}): boolean {
  const assigned = typeof row.assigned_vendor_id === "string"
    ? row.assigned_vendor_id.trim()
    : ""
  if (assigned) return false
  const status = (row.vendor_work_status ?? "").trim().toLowerCase()
  return status === "unassigned" || status === ""
}
