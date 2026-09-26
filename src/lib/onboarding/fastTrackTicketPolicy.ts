/**
 * Fast Track document-import ticket policy.
 *
 * PRODUCT DECISIONS (explicit — do not "quietly" change without product sign-off):
 *
 * 1. Historical maintenance issues from document extract are ALWAYS routed to
 *    Property Maintenance History only. They never become Open Repairs / Active
 *    Tasks — even when the extracted row looks still-open / incomplete.
 *    Rationale: shared Alpha accounts accumulated hundreds of open tickets across
 *    Fast Track runs; History is the durable home for past issues.
 *
 * 2. Expense lines with no matched vendor are DROPPED for ticket/invoice minting.
 *    They are not parked for later manual matching. They still count toward the
 *    financial.imported activity summary when the parent import runs.
 */
export const FAST_TRACK_HISTORICAL_ISSUE_DESTINATION = 'maintenance_history_only' as const

export const FAST_TRACK_UNMATCHED_EXPENSE_FATE = 'dropped' as const

/** Historical Fast Track issues never mint live open tickets. */
export function shouldMintOpenTicketFromHistoricalIssue(_issue?: {
  description?: string
  priority?: string
  selected?: boolean
}): boolean {
  return false
}

/**
 * Expense → completed ticket + invoice only when a vendor is matched.
 * Unmatched lines follow FAST_TRACK_UNMATCHED_EXPENSE_FATE (`dropped`).
 */
export function shouldMintTicketFromExpenseLine(input: {
  matchedVendorId: string | null | undefined
}): boolean {
  return Boolean(typeof input.matchedVendorId === 'string' && input.matchedVendorId.trim())
}

/** True when an imported financial maintenance expense should be skipped (no vendor). */
export function isUnmatchedExpenseDropped(input: {
  matchedVendorId: string | null | undefined
}): boolean {
  return !shouldMintTicketFromExpenseLine(input)
}
