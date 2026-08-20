/**
 * Resolve whether a tenant SMS is about an existing work order or a new problem.
 *
 * Uses open-ticket context + message shape (inquiry vs problem report).
 * Prefer clarification over minting a false ticket.
 */
import {
  detectEmergencySignals,
  inferIssueTypeFromText,
  type IssueType,
} from "./residentIntakeTypes.ts"
import {
  looksLikeCancelRepair,
  looksLikeMaintenanceStatusAsk,
  type TenantSmsIntent,
} from "./inboundInterpretation.ts"
import {
  classifyFollowUpKind,
  isDistinctNewIssue,
  looksLikeAdditionalIssue,
  matchOpenRequests,
  type FollowUpKind,
  type OpenRequestSummary,
} from "./inboundContextualFollowUp.ts"
import {
  isActiveMaintenanceTicketStatus,
  looksLikeClosedRepairStatusAsk,
  looksLikeMaintenanceRelatedMessage,
  looksLikeProblemReturned,
} from "./maintenanceTicketContext.ts"

export const RESOLVED_MAINTENANCE_INTENTS = [
  "NEW_ISSUE",
  "STATUS",
  "VENDOR_QUESTION",
  "SCHEDULING",
  "UPDATE",
  "WORSENED",
  "RESOLVED",
  "CANCEL",
  "PHOTO_UPDATE",
  "NO_SHOW",
  "AMBIGUOUS",
  "OTHER",
] as const

export type ResolvedMaintenanceIntent = (typeof RESOLVED_MAINTENANCE_INTENTS)[number]

const SWITCH_HEURISTIC = new Set<TenantSmsIntent>([
  "lease_info",
  "rent_balance",
  "rent_late",
  "move_out_intent",
  "other",
])

/** Inquiry / question shape — not phrase-specific vendor ETA copy. */
const INTERROGATIVE_OPEN =
  /^(who|what|when|where|which|how|has|have|had|did|does|do|is|are|was|were|will|can|could|would|should|any)\b/i

const WORK_ACTOR_OR_VISIT =
  /\b(coming|arriv(?:e|ing)|show(?:ing)?\s+up|be here|get here|on (?:their|his|her) way|assigned|assignment|scheduled|schedule|appointment|visit|eta|technician|tech|vendor|electrician|plumber|handyman|contractor|someone|anyone)\b/i

const EXISTING_WORK_REF =
  /\b(my|the|that|this)\s+(repair|request|work\s*order|ticket|job|issue|problem|leak|outlet|ac|heater|sink|toilet)\b|\b(my|the)\s+\w+\s+(issue|problem|repair)\b/i

/** Declarative problem report — tenant describing something newly broken. */
const PROBLEM_REPORT =
  /\b(is|are|was|were|just|still)?\s*(broken|leaking|overflowing|clogged|sparking|sparks|not\s+working|isn'?t\s+working|won'?t\s+(turn|start|cool|heat)|stopped\s+working|flooding|on\s+fire)\b|\b(there'?s|there is|i have|we have|my .+ (is|are|just))\b/i

const NEW_LOCATION_HINT =
  /\b(now|also|another|kitchen|bathroom|bedroom|living\s*room|basement|hallway|closet)\b/i

function ticketIssueType(ticket: OpenRequestSummary): IssueType | null {
  return inferIssueTypeFromText(
    `${ticket.issue_category ?? ""} ${ticket.description ?? ""}`,
  )
}

function looksLikeInquiry(body: string): boolean {
  const text = body.trim()
  if (!text) return false
  if (text.includes("?")) return true
  if (INTERROGATIVE_OPEN.test(text)) return true
  if (looksLikeMaintenanceStatusAsk(text)) return true
  return false
}

function looksLikeProblemReport(body: string): boolean {
  const text = body.trim()
  if (!text) return false
  if (looksLikeInquiry(text) && !PROBLEM_REPORT.test(text)) return false
  if (inferIssueTypeFromText(text) && PROBLEM_REPORT.test(text)) return true
  if (inferIssueTypeFromText(text) && !looksLikeInquiry(text) && text.length > 12) {
    return true
  }
  return false
}

function looksLikeExistingWorkInquiry(body: string): boolean {
  const text = body.trim()
  if (!text) return false
  if (looksLikeMaintenanceStatusAsk(text)) return true
  if (!looksLikeInquiry(text)) return false
  // Question about assignment / visit / who is handling work — not a new failure report.
  if (WORK_ACTOR_OR_VISIT.test(text)) return true
  if (EXISTING_WORK_REF.test(text) && !looksLikeProblemReport(text)) return true
  // "Did you find someone?" / "Has anyone been assigned?"
  if (
    /\b(find|found|assigned|lined up|sent)\b/i.test(text) &&
    /\b(someone|anyone|a (tech|vendor|electrician|plumber)|help)\b/i.test(text)
  ) {
    return true
  }
  return false
}

function mapFollowUpKind(kind: FollowUpKind): ResolvedMaintenanceIntent {
  switch (kind) {
    case "worse":
      return "WORSENED"
    case "update":
    case "reopen":
    case "correction":
      return "UPDATE"
    case "resolved":
      return "RESOLVED"
    case "no_show":
      return "NO_SHOW"
    case "photo":
      return "PHOTO_UPDATE"
    case "schedule":
      return "SCHEDULING"
    case "access":
      return "UPDATE"
  }
}

function sameTradeAmbiguousNewSymptom(
  body: string,
  open: OpenRequestSummary[],
): boolean {
  if (!looksLikeProblemReport(body) && !looksLikeAdditionalIssue(body)) return false
  if (isDistinctNewIssue(body, open)) return false
  const next = inferIssueTypeFromText(body)
  if (!next) return false
  const sameTrade = open.some((row) => ticketIssueType(row) === next)
  if (!sameTrade) return false
  // Same trade + new location / "now" / "also" → ask before minting another ticket.
  return NEW_LOCATION_HINT.test(body) || looksLikeAdditionalIssue(body)
}

export function allowsNewMaintenanceTicket(
  intent: ResolvedMaintenanceIntent,
): boolean {
  return intent === "NEW_ISSUE"
}

export function tenantIntentForResolved(
  resolved: ResolvedMaintenanceIntent,
): TenantSmsIntent {
  switch (resolved) {
    case "NEW_ISSUE":
      return "maintenance_new"
    case "STATUS":
    case "VENDOR_QUESTION":
      return "maintenance_status"
    case "SCHEDULING":
      return "schedule_change"
    case "UPDATE":
    case "WORSENED":
    case "PHOTO_UPDATE":
    case "NO_SHOW":
    case "AMBIGUOUS":
      return "maintenance_update"
    case "RESOLVED":
    case "CANCEL":
      return "maintenance_cancel"
    case "OTHER":
      return "other"
  }
}

/**
 * Classify the tenant message relative to open work orders.
 * Call before starting maintenance_intake or minting a ticket.
 */
export function resolveMaintenanceWorkIntent(input: {
  body: string
  hasMedia?: boolean
  heuristicIntent?: TenantSmsIntent | null
  openTickets: OpenRequestSummary[]
}): ResolvedMaintenanceIntent {
  const body = input.body.trim()
  const hasMedia = input.hasMedia === true
  const heuristic = input.heuristicIntent ?? null
  // Only active tickets drive current maintenance context.
  const open = input.openTickets.filter((row) =>
    isActiveMaintenanceTicketStatus(row.vendor_work_status)
  )

  if (!body && !hasMedia) return "OTHER"

  if (heuristic && SWITCH_HEURISTIC.has(heuristic)) {
    return "OTHER"
  }

  if (looksLikeCancelRepair(body) || heuristic === "maintenance_cancel") {
    return "CANCEL"
  }

  const followKind = classifyFollowUpKind(body, hasMedia)
  if (followKind) {
    return mapFollowUpKind(followKind)
  }

  if (heuristic === "schedule_change") return "SCHEDULING"
  if (heuristic === "access_instruction") return "UPDATE"
  if (
    heuristic === "maintenance_status" ||
    looksLikeMaintenanceStatusAsk(body) ||
    looksLikeClosedRepairStatusAsk(body)
  ) {
    return "STATUS"
  }

  const emergency = detectEmergencySignals(body) ||
    /\b(smell gas|gas in the|on fire|smoke alarm)\b/i.test(body)

  // Safety / emergency always starts a new path — never fold into an open job.
  if (emergency) {
    return "NEW_ISSUE"
  }

  // No active work — problem report is new (or recurrence handled upstream via reopen).
  if (open.length === 0) {
    if (looksLikeProblemReturned(body)) return "UPDATE"
    if (looksLikeProblemReport(body) || inferIssueTypeFromText(body)) {
      return "NEW_ISSUE"
    }
    if (hasMedia) return "PHOTO_UPDATE"
    return "OTHER"
  }

  // Open work exists — prefer existing context only for maintenance-shaped messages.
  if (looksLikeExistingWorkInquiry(body)) {
    if (open.length > 1 && matchOpenRequests(body, open).length !== 1) {
      // Vague "who's coming?" across several jobs → clarify which.
      if (!inferIssueTypeFromText(body) || matchOpenRequests(body, open).length === 0) {
        return "AMBIGUOUS"
      }
    }
    if (WORK_ACTOR_OR_VISIT.test(body) && looksLikeInquiry(body)) {
      return "VENDOR_QUESTION"
    }
    return "STATUS"
  }

  if (sameTradeAmbiguousNewSymptom(body, open)) {
    return "AMBIGUOUS"
  }

  if (isDistinctNewIssue(body, open) && (looksLikeProblemReport(body) || looksLikeAdditionalIssue(body))) {
    return "NEW_ISSUE"
  }

  // Same trade / related text without a clear new problem report → existing work.
  if (matchOpenRequests(body, open).length > 0 || inferIssueTypeFromText(body)) {
    if (looksLikeInquiry(body)) return "STATUS"
    if (looksLikeProblemReport(body) && !isDistinctNewIssue(body, open)) {
      // e.g. same-trade symptom, no "also/now/kitchen" → treat as update on existing
      return "UPDATE"
    }
  }

  if (hasMedia && !looksLikeProblemReport(body)) {
    return "PHOTO_UPDATE"
  }

  // Open tickets must not hijack unrelated intents (rent, lease, chit-chat).
  if (open.length > 0 && !isDistinctNewIssue(body, open)) {
    if (
      looksLikeMaintenanceRelatedMessage(body) ||
      looksLikeProblemReport(body) ||
      heuristic === "maintenance_new" ||
      heuristic === "maintenance_update"
    ) {
      return "AMBIGUOUS"
    }
    return "OTHER"
  }

  if (looksLikeProblemReport(body) || inferIssueTypeFromText(body)) {
    return "NEW_ISSUE"
  }

  return "OTHER"
}
