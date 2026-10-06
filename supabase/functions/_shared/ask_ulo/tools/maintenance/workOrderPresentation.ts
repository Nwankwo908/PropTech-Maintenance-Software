/**
 * Shared Ask Ulo work-order presentation — same generateIssueSummary path as
 * ticket titles, SMS confirms, and stall follow-ups. Urgency ranking reused for
 * overdue / needs-attention lists so fire/habitability outranks routine age.
 */

import { generateIssueSummary } from "../../../../../../shared/maintenance/generateIssueSummary.ts"

/** Lower = more urgent. Habitability / fire / emergency beat elapsed wait alone. */
export function rankWorkOrderUrgency(
  priority: string | null | undefined,
  urgency?: string | null,
  /** Title/description — catches fire/habitability even when urgency column is stale. */
  issueText?: string | null,
): number {
  const hay = `${priority ?? ""} ${urgency ?? ""} ${issueText ?? ""}`.toLowerCase()
  if (
    /\b(fire|gas|smoke|electrical|life[\s-]?safety|habitability)\b/.test(hay) ||
    hay.includes("emergency") ||
    hay.includes("critical")
  ) {
    return 0
  }
  if (hay.includes("urgent") || hay.includes("high")) return 1
  if (hay.includes("medium") || hay.includes("normal")) return 2
  if (hay.includes("low")) return 3
  return 4
}

/** Landlord-facing issue label — never raw "Tenant update:" / "Timing note:" text. */
export function summarizeWorkOrderIssue(
  description: string | null | undefined,
  category?: string | null,
  maxChars = 80,
): string {
  const raw = (description ?? "").trim()
  const cat = (category ?? "").trim()
  if (!raw) return cat ? cat.replace(/_/g, " ") : "Maintenance request"
  const summarized = generateIssueSummary(raw, {
    format: "title",
    category: cat || null,
    maxChars,
  }).trim()
  return summarized || cat.replace(/_/g, " ") || "Maintenance request"
}

export type PendingLandlordDecisionKind =
  | "estimate_approval"
  | "vendor_choice"
  | "escalated_hold"
  | "generic"

/** Plain-language pending ask — mirrors SMS estimate / vendor-choice distinction. */
export function formatPendingLandlordDecisionReason(input: {
  kind?: PendingLandlordDecisionKind | null
  workflowStep?: string | null
  workflowStatus?: string | null
  awaitingLandlordChoice?: boolean
  pendingEstimateApproval?: boolean
  spendStatus?: string | null
}): { kind: PendingLandlordDecisionKind; reason: string } {
  if (
    input.pendingEstimateApproval ||
    (input.spendStatus ?? "").toLowerCase() === "pending_approval"
  ) {
    return {
      kind: "estimate_approval",
      reason: "Cost estimate waiting for your approval",
    }
  }
  if (input.awaitingLandlordChoice) {
    return {
      kind: "vendor_choice",
      reason: "Vendor choice waiting for your reply",
    }
  }

  const step = `${input.workflowStep ?? ""} ${input.kind ?? ""}`.toLowerCase()
  if (/\bestimate\b/.test(step) || /\bapprov/.test(step)) {
    return {
      kind: "estimate_approval",
      reason: "Cost estimate waiting for your approval",
    }
  }
  if (/\bvendor\b/.test(step) && /\b(choice|select|pick|assign)\b/.test(step)) {
    return {
      kind: "vendor_choice",
      reason: "Vendor choice waiting for your reply",
    }
  }
  if ((input.workflowStatus ?? "").toLowerCase() === "escalated") {
    return {
      kind: "escalated_hold",
      reason: "Escalated — needs your decision to continue",
    }
  }
  const stepLabel = (input.workflowStep ?? "").replace(/_/g, " ").trim()
  return {
    kind: "generic",
    reason: stepLabel
      ? `Waiting on your decision (${stepLabel})`
      : "Waiting on your decision",
  }
}

export function isOverdueWorkOrdersQuestion(question: string): boolean {
  const q = question.trim()
  if (!q) return false
  return (
    /\b(?:work\s*orders?|tickets?|repairs?|requests?)\b.{0,48}\boverdue\b/i.test(q) ||
    /\boverdue\b.{0,48}\b(?:work\s*orders?|tickets?|repairs?|requests?)\b/i.test(q) ||
    /\bwhich\s+(?:work\s*orders?|tickets?|repairs?)\s+are\s+(?:past\s+due|late|aging)\b/i.test(
      q,
    )
  )
}

/**
 * Open-ended portfolio prioritization across already-known open work —
 * not a property/building comparison and not an underspecified entity search.
 * Shares urgency-first ranking with overdue work-order lists.
 */
/**
 * "Which properties have critical maintenance?" — rank buildings by critical /
 * urgent open tickets. Severity only; must not invent cost or timeline figures.
 */
export function isCriticalMaintenanceByPropertyQuestion(question: string): boolean {
  const q = question.trim()
  if (!q) return false
  const propertyAsk =
    /\bwhich\s+propert(?:y|ies)\b/i.test(q) ||
    /\bpropert(?:y|ies)\s+(?:with|have|need)\b/i.test(q) ||
    /\bbuildings?\s+with\b/i.test(q)
  const criticalAsk =
    /\bcritical\b/i.test(q) ||
    /\bemergenc(?:y|ies)\b/i.test(q) ||
    /\burgent\s+(?:maintenance|repairs?|work\s*orders?|tickets?)\b/i.test(q)
  const maintenanceAsk =
    /\b(maintenance|repairs?|work\s*orders?|tickets?|issues?)\b/i.test(q) ||
    /\bcritical\s+maintenance\b/i.test(q)
  return propertyAsk && criticalAsk && maintenanceAsk
}

export function isPortfolioWorkPrioritizationQuestion(question: string): boolean {
  const q = question.trim()
  if (!q) return false
  // "Which property / building…" stays on property ranking.
  if (/\bwhich\s+(?:propert(?:y|ies)|buildings?|communities)\b/i.test(q)) {
    return false
  }
  if (
    /\b(compar(?:e|ing|ison)|rank(?:ing)?)\b/i.test(q) &&
    /\b(propert(?:y|ies)|buildings?)\b/i.test(q)
  ) {
    return false
  }
  // Forward-looking multi-domain briefings stay on executive briefing.
  if (
    /\bwhat\s+should\s+i\s+focus\s+on\s+(?:this|the)\s+(?:week|month)\b/i.test(q) ||
    /\bover\s+the\s+next\s+\d+\s+days\b/i.test(q) ||
    /\bnext\s+30\s+days\b/i.test(q)
  ) {
    return false
  }

  return (
    /\bwhat\s+should\s+i\s+focus\s+on\b/i.test(q) ||
    /\bwhat\s+to\s+focus\s+on\b/i.test(q) ||
    /\bwhat\s+needs\s+(?:my\s+)?attention\b/i.test(q) ||
    /\bwhat(?:'s|\s+is)\s+(?:the\s+)?most\s+urgent\b/i.test(q) ||
    /\bwhere\s+(?:should|would)\s+i\s+start\b/i.test(q) ||
    /\bwhat\s+should\s+happen\s+first\b/i.test(q) ||
    /\bwhat\s+should\s+i\s+(?:do|prioriti[sz]e)(?:\s+first|\s+today|\s+now|\s+right\s+now)?\b/i
      .test(q) ||
    /\bneeds?\s+(?:my\s+)?attention\s+today\b/i.test(q) ||
    /\bmost\s+urgent\s+(?:work\s*orders?|tickets?|repairs?|items?|issues?)?\b/i.test(q)
  )
}
