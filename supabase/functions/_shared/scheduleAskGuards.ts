/**
 * When a ticket has moved past scheduling, vendors/residents must not reopen
 * confirmation of an old window.
 */
export const SCHEDULE_ASK_BLOCKING_STATUSES = new Set([
  "in_progress",
  "completed",
  "cancelled",
  "archived",
])

export function ticketStatusBlocksScheduleAsks(
  vendorWorkStatus: string | null | undefined,
): boolean {
  return SCHEDULE_ASK_BLOCKING_STATUSES.has(
    String(vendorWorkStatus ?? "").trim().toLowerCase(),
  )
}

export function buildVendorScheduleAlreadyAdvancedSms(input: {
  workOrderRef: string
  vendorWorkStatus: string
}): string {
  const wo = input.workOrderRef.trim() || "this work order"
  const status = input.vendorWorkStatus.trim().toLowerCase()
  if (status === "in_progress") {
    return (
      `${wo} is already in progress — no schedule confirmation is needed. ` +
      "Text us if something changed."
    )
  }
  if (status === "completed") {
    return (
      `${wo} is already marked complete — no schedule update is needed. ` +
      "Text us if something changed."
    )
  }
  return (
    `${wo} is no longer waiting on a visit window. ` +
    "Text us if something changed."
  )
}

export function buildResidentScheduleAlreadyAdvancedSms(input: {
  workOrderRef: string
}): string {
  const wo = input.workOrderRef.trim() || "that repair"
  return (
    `Thanks — ${wo} is already underway, so we don't need to confirm that visit window. ` +
    "Text us if you still need help."
  )
}
