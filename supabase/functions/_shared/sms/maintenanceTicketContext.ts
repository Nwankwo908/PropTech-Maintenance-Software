/**
 * Active vs historical maintenance ticket context for tenant SMS routing.
 *
 * Active tickets drive current maintenance context.
 * Closed/canceled/completed tickets are historical — only used when the
 * tenant clearly refers to them or says the problem returned.
 */

export const ACTIVE_VENDOR_WORK_STATUSES = [
  "unassigned",
  "pending_accept",
  "accepted",
  "in_progress",
] as const

export const HISTORICAL_VENDOR_WORK_STATUSES = [
  "completed",
  "cancelled",
] as const

export type TicketStatusRow = {
  vendor_work_status: string | null
  description?: string | null
  issue_category?: string | null
}

export function normalizeVendorWorkStatus(
  status: string | null | undefined,
): string {
  return (status ?? "").trim().toLowerCase()
}

export function isActiveMaintenanceTicketStatus(
  status: string | null | undefined,
): boolean {
  const v = normalizeVendorWorkStatus(status)
  return (ACTIVE_VENDOR_WORK_STATUSES as readonly string[]).includes(v)
}

export function isHistoricalMaintenanceTicketStatus(
  status: string | null | undefined,
): boolean {
  const v = normalizeVendorWorkStatus(status)
  return (HISTORICAL_VENDOR_WORK_STATUSES as readonly string[]).includes(v)
}

export function isClosedOrCancelledStatus(
  status: string | null | undefined,
): boolean {
  const v = normalizeVendorWorkStatus(status)
  return v === "cancelled" || v === "completed"
}

export function partitionMaintenanceTicketsByStatus<T extends TicketStatusRow>(
  tickets: T[],
): { active: T[]; historical: T[] } {
  const active: T[] = []
  const historical: T[] = []
  for (const ticket of tickets) {
    if (isActiveMaintenanceTicketStatus(ticket.vendor_work_status)) {
      active.push(ticket)
    } else if (isHistoricalMaintenanceTicketStatus(ticket.vendor_work_status)) {
      historical.push(ticket)
    }
  }
  return { active, historical }
}

/**
 * Recurrence / “problem returned” language — historical tickets may become
 * relevant again, but only through this path (not as default active context).
 */
export function looksLikeProblemReturned(body: string): boolean {
  const text = body.trim()
  if (!text) return false
  if (
    /\b((wasn'?t|was not|still not) fixed|not fixed( yet)?)\b/i.test(text)
  ) {
    return true
  }
  if (
    /\b(came back|broke again|broken again|happening again|problem (came back|returned)|repair didn'?t work|doing the same thing)\b/i
      .test(text)
  ) {
    return true
  }
  if (/\b(leaking|sparking|stopped working|not working|broken)\s+again\b/i.test(text)) {
    return true
  }
  if (
    /\bagain\b/i.test(text) &&
    /\b(leak|sink|outlet|ac|heater|toilet|spark|broken|problem|issue|repair)\b/i.test(text)
  ) {
    return true
  }
  return false
}

/** Tenant asking whether a prior repair was closed / canceled. */
export function looksLikeClosedRepairStatusAsk(body: string): boolean {
  const text = body.trim()
  if (!text) return false
  return (
    /\b(is|was|did)\b.*\b(that |the |my |this )?(repair|request|ticket|work order|job)\b.*\b(closed|cancel(?:led)?|resolved|done)\b/i
      .test(text) ||
    /\bdidn'?t i already (close|cancel)\b/i.test(text) ||
    /\bis (it|that) (already )?(closed|cancel(?:led)?|resolved)\b/i.test(text) ||
    /\balready (close[d]?|cancel(?:led)?)\b.*\b(that |the |my )?(sink|outlet|ac|heater|repair|request)\b/i
      .test(text)
  )
}

/**
 * True when the message has a maintenance signal that could relate to tickets.
 * Rent/lease/move-out must not fall into RELATED/SEPARATE just because a ticket exists.
 */
export function looksLikeMaintenanceRelatedMessage(body: string): boolean {
  const text = body.trim()
  if (!text) return false
  if (looksLikeProblemReturned(text)) return true
  if (looksLikeClosedRepairStatusAsk(text)) return true
  if (
    /\b(repair|work order|ticket|plumber|electrician|technician|vendor|leak|outlet|spark|clog|flood|heater|hvac|ac\b|air conditioning|toilet|sink|faucet|lights?|flicker(?:ing)?|door|damaged)\b/i
      .test(text)
  ) {
    return true
  }
  if (
    /\b(broken|leaking|sparking|damaged|not working|aren'?t working|isn'?t working|won'?t (?:turn|start|cool|heat|close|open|lock|shut)|stopped working|flooding)\b/i
      .test(text)
  ) {
    return true
  }
  return false
}

export function formatTicketClosedDate(
  iso: string | null | undefined,
): string | null {
  if (!iso?.trim()) return null
  const parsed = new Date(iso)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  })
}

export function historicalClosureLabel(
  status: string | null | undefined,
): "closed" | "canceled" | "completed" {
  const v = normalizeVendorWorkStatus(status)
  if (v === "cancelled") return "canceled"
  if (v === "completed") return "completed"
  return "closed"
}
