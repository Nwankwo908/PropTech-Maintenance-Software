/**
 * A tenant saying the repair is fixed is a completed close.
 * "Cancel it" / "never mind" stays a cancellation.
 */

const FIX =
  /^(?:fixed|it(?:'| i)?s fixed|it is fixed|all fixed|resolved)[.!]?\s*$|\b(?:i |we )?(?:already )?(?:fixed|repaired) (?:it|this|that|the)\b|\b(?:is|was) fixed\b|\b(?:it(?:'| i)?s|it is) (?:fixed|working)(?: now)?\b|\b(?:the )?(?:problem|leak|issue) (?:stopped|is gone|is fixed)\b|\bno longer (?:an? )?(?:issue|problem|leaking|broken)\b|\bstopped leaking\b/i

export function looksLikeTenantReportedFix(body: string): boolean {
  const text = body.trim()
  if (!text || text.length > 240) return false
  if (/\bcancel\b/i.test(text) && !/\bfixed\b/i.test(text)) return false
  return FIX.test(text)
}

export type ResidentCloseKind = "resolved" | "cancelled"

export function residentCloseKind(input: {
  body: string
  pendingCloseAs?: ResidentCloseKind | null
}): ResidentCloseKind {
  if (looksLikeTenantReportedFix(input.body)) return "resolved"
  if (/\bcancel\b/i.test(input.body)) return "cancelled"
  if (input.pendingCloseAs === "resolved" || input.pendingCloseAs === "cancelled") {
    return input.pendingCloseAs
  }
  return "cancelled"
}

export function tenantResolvedTicketPatch(nowIso: string): {
  status: "completed"
  vendor_work_status: "completed"
  resolution: "tenant_self_fix"
  self_fix_result: "fixed"
  completed_at: string
  assigned_vendor_id: null
  cancelled_at: null
  cancelled_by: null
  cancellation_reason: null
} {
  return {
    status: "completed",
    vendor_work_status: "completed",
    resolution: "tenant_self_fix",
    self_fix_result: "fixed",
    completed_at: nowIso,
    assigned_vendor_id: null,
    cancelled_at: null,
    cancelled_by: null,
    cancellation_reason: null,
  }
}

export function isAlreadyTenantResolved(input: {
  status?: string | null
  vendorWorkStatus?: string | null
}): boolean {
  const status = (input.status ?? "").trim().toLowerCase()
  const vendor = (input.vendorWorkStatus ?? "").trim().toLowerCase()
  if (vendor === "completed") return true
  return status === "completed" || status === "closed" || status === "done"
}
