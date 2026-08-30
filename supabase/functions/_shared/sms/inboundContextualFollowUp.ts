/**
 * Contextual follow-up — before a tenant SMS starts a new workflow,
 * decide whether it continues an existing request.
 *
 * This is interpretation policy, not a registry handler.
 */
import {
  inferIssueTypeFromText,
  isTimeOrDurationPhrase,
  type IssueType,
} from "./residentIntakeTypes.ts"
import {
  looksLikeCancelRepair,
  looksLikeMaintenanceStatusAsk,
  type TenantSmsIntent,
} from "./inboundInterpretation.ts"
import {
  allowsNewMaintenanceTicket,
  resolveMaintenanceWorkIntent,
  tenantIntentForResolved,
  type ResolvedMaintenanceIntent,
} from "./resolveMaintenanceWorkIntent.ts"
import {
  isActiveMaintenanceTicketStatus,
  looksLikeClosedRepairStatusAsk,
  looksLikeProblemReturned,
  partitionMaintenanceTicketsByStatus,
} from "./maintenanceTicketContext.ts"

export type FollowUpKind =
  | "update"
  | "worse"
  | "reopen"
  | "correction"
  | "photo"
  | "resolved"
  | "no_show"
  | "schedule"
  | "access"

export type OpenRequestSummary = {
  id: string
  description: string | null
  vendor_work_status: string | null
  issue_category?: string | null
}

export type ContextualFollowUpDecision =
  | { action: "new_issue" }
  | { action: "switch_intent" }
  | { action: "continue_intake" }
  | {
    action: "follow_up"
    intent: TenantSmsIntent
    slots: Record<string, string>
    ticketId?: string
  }
  | { action: "clarify"; ticketIds: string[] }

const ADDITIONAL_ISSUE =
  /\b(also|another (issue|problem|thing|repair)|as well|on top of that|plus my|and my (ac|hvac|heater|sink|toilet|fridge))\b/i

const NO_SHOW =
  /\b((they|he|she|the )?(vendor|plumber|electrician|tech|technician|repair ?person) (never|didn'?t|did not) (show|came|come|arrive)|never showed up|no-?show|didn'?t show up)\b/i

const PHOTO =
  /\b((here'?s|here is) (a |another )?(better |new )?(pic|picture|photo|image)|better (pic|picture|photo)|another (pic|picture|photo))\b/i

const CORRECTION =
  /\b(i meant|not the \w+|wrong (room|unit|place|area)|actually (it'?s|its|in) (the )?\w+|bathroom,? not the kitchen|kitchen,? not the bathroom)\b/i

const SCHEDULE_FOLLOW_UP =
  /\b(tomorrow (doesn'?t|does not|won'?t|will not) work|doesn'?t work for me|does not work for me|can they come|after \d{1,2}|before \d{1,2}|come after|come before)\b/i

const FOLLOW_UP_PRONOUN =
  /\b(it'?s|its|the (leak|sink|ac|heater|repair|issue|problem)|that (repair|issue|problem|leak))\b/i

const FOLLOW_UP_INTENTS = new Set<TenantSmsIntent>([
  "maintenance_update",
  "maintenance_cancel",
  "maintenance_status",
  "schedule_change",
  "access_instruction",
])

/** Intents that leave the current intake question instead of answering it. */
const PENDING_BREAKOUT_INTENTS = new Set<TenantSmsIntent>([
  "lease_info",
  "rent_balance",
  "rent_late",
  "move_out_intent",
  "other",
  "maintenance_cancel",
  "maintenance_status",
  "schedule_change",
  "access_instruction",
])

/**
 * Active pending question wins over an existing draft/open ticket, unless the
 * inbound is a clear break-out (lease, cancel, new issue, schedule, …).
 */
export function shouldKeepActivePendingContext(input: {
  body: string
  intent: TenantSmsIntent | null
  openTickets: OpenRequestSummary[]
  activeIntake: boolean
}): boolean {
  if (!input.activeIntake) return false
  if (input.intent && PENDING_BREAKOUT_INTENTS.has(input.intent)) return false
  if (looksLikeCancelRepair(input.body)) return false

  const resolved = resolveMaintenanceWorkIntent({
    body: input.body,
    heuristicIntent: input.intent,
    openTickets: input.openTickets,
  })
  if (
    resolved === "STATUS" ||
    resolved === "VENDOR_QUESTION" ||
    resolved === "SCHEDULING" ||
    resolved === "CANCEL" ||
    resolved === "RESOLVED" ||
    resolved === "NO_SHOW"
  ) {
    return false
  }

  if (
    inferIssueTypeFromText(input.body) &&
    isDistinctNewIssue(input.body, input.openTickets)
  ) {
    return false
  }
  return true
}

export function looksLikeAdditionalIssue(body: string): boolean {
  return ADDITIONAL_ISSUE.test(body.trim())
}

export function classifyFollowUpKind(
  body: string,
  hasMedia: boolean,
): FollowUpKind | null {
  const text = body.trim()
  if (looksLikeMaintenanceStatusAsk(text)) return null
  if (looksLikeCancelRepair(text)) return "resolved"
  if (NO_SHOW.test(text)) return "no_show"
  if (PHOTO.test(text) || (hasMedia && text.length < 80 && !inferIssueTypeFromText(text))) {
    return "photo"
  }
  if (CORRECTION.test(text)) return "correction"
  if (SCHEDULE_FOLLOW_UP.test(text)) return "schedule"
  if (/\b(getting worse|worse now|it'?s worse|its worse|getting (really )?bad)\b/i.test(text)) {
    return "worse"
  }
  if (looksLikeProblemReturned(text)) {
    return "reopen"
  }
  if (
    /\b(still (broken|leaking|not fixed|going on)|same (problem|issue|leak)|not working)\b/i
      .test(text)
  ) {
    return "update"
  }
  if (
    FOLLOW_UP_PRONOUN.test(text) &&
    text.length < 80 &&
    !looksLikeAdditionalIssue(text) &&
    !/\b(stopped working|isn'?t working|won'?t (turn on|cool|heat|start))\b/i.test(text)
  ) {
    return "update"
  }
  if (hasMedia && !inferIssueTypeFromText(text) && !looksLikeAdditionalIssue(text)) {
    return "photo"
  }
  return null
}

function isOpenStatus(status: string | null | undefined): boolean {
  return isActiveMaintenanceTicketStatus(status)
}

function ticketIssueType(ticket: OpenRequestSummary): IssueType | null {
  return inferIssueTypeFromText(
    `${ticket.issue_category ?? ""} ${ticket.description ?? ""}`,
  )
}

/** Collapse leak/plumbing (and similar aliases) so same-trade updates stay on one ticket. */
export function tradeFamilyFromIssue(
  kind: IssueType | string | null | undefined,
): string | null {
  if (kind == null) return null
  const k = String(kind).trim().toLowerCase()
  if (!k) return null
  if (k === "leak" || k.includes("plumb") || k.includes("leak") || k.includes("pipe")) {
    return "plumbing"
  }
  if (k === "hvac" || k.includes("hvac") || k.includes("heat") || k.includes("cool") || k === "ac") {
    return "hvac"
  }
  if (k === "electrical" || k.includes("electric")) return "electrical"
  if (k === "appliance" || k.includes("appliance")) return "appliance"
  if (k === "pest" || k.includes("pest")) return "pest"
  if (k === "lock" || k.includes("lock")) return "lock"
  return k
}

export function isDistinctNewIssue(
  body: string,
  tickets: OpenRequestSummary[],
): boolean {
  if (looksLikeAdditionalIssue(body) && inferIssueTypeFromText(body)) return true
  const next = inferIssueTypeFromText(body)
  if (!next) return looksLikeAdditionalIssue(body)
  const nextFamily = tradeFamilyFromIssue(next)
  const open = tickets.filter((row) => isOpenStatus(row.vendor_work_status))
  if (open.length === 0) return true
  // Different trade than every open ticket → new work order, even if an open
  // ticket has no inferrable category.
  return !open.some((row) => {
    const existing = tradeFamilyFromIssue(ticketIssueType(row) ?? row.issue_category)
    return existing != null && existing === nextFamily
  })
}

export function ticketFirstLine(ticket: OpenRequestSummary): string {
  const raw = (ticket.description ?? ticket.issue_category ?? "").trim()
  return (raw.split(/[.!\n]/)[0]?.trim() || raw).toLowerCase()
}

/**
 * True when a ticket description is really a status/assignment question that was
 * mistakenly minted as a work order (e.g. "Who is coming to fix my electrical issue?").
 * Those must not appear in cancel / which-repair lists.
 */
export function looksLikeStatusInquiryTicketDescription(
  description: string | null | undefined,
): boolean {
  const text = (description ?? "").trim()
  if (!text) return false
  const firstLine = (text.split(/\n/)[0] ?? text).trim()
  if (!firstLine) return false
  if (/\?/.test(firstLine)) return true
  if (
    /^(who|what|when|where|which|how|has|have|had|did|does|do|is|are|any)\b/i.test(firstLine) &&
    /\b(coming|status|update|assigned|assignment|scheduled|schedule|electrician|plumber|technician|vendor|someone|anyone|showing up|be here|eta|fix|repair|issue)\b/i
      .test(firstLine)
  ) {
    return true
  }
  return false
}

/** Skip leftover intake-restart tickets whose title is just "today" / "start". */
export function isIdentifiableRequestLabel(ticket: OpenRequestSummary): boolean {
  if (looksLikeStatusInquiryTicketDescription(ticket.description)) return false
  const line = ticketFirstLine(ticket)
  if (!line || line.length < 4) return false
  return !isTimeOrDurationPhrase(line)
}

/** Collapse duplicate titles from restarted intake so SMS never lists the same request twice. */
export function dedupeTicketsByRequestLabel<T extends OpenRequestSummary>(
  tickets: T[],
): T[] {
  const seen = new Set<string>()
  const out: T[] = []
  for (const ticket of tickets) {
    const label = ticketFirstLine(ticket) || ticket.id
    if (seen.has(label)) continue
    seen.add(label)
    out.push(ticket)
  }
  return out
}

export function ticketsSharingRequestLabel<T extends OpenRequestSummary>(
  tickets: T[],
  ticket: T,
): T[] {
  const label = ticketFirstLine(ticket)
  if (!label) return [ticket]
  return tickets.filter((row) => ticketFirstLine(row) === label)
}

/** Prefer the request whose title the resident quoted over a shared trade (two leaks). */
function uniqueLabelMatch(
  body: string,
  tickets: OpenRequestSummary[],
): OpenRequestSummary | null {
  const hay = body.trim().toLowerCase().replace(/[.!?]+$/g, "").trim()
  if (hay.length < 4) return null
  const scored = tickets.map((ticket) => {
    const label = ticketFirstLine(ticket)
    const blob = `${ticket.issue_category ?? ""} ${ticket.description ?? ""}`.toLowerCase()
    let score = 0
    if (label && (hay === label || label.startsWith(hay) || hay.startsWith(label))) score = 100
    else if (
      hay.length >= 8 &&
      label.length >= 8 &&
      (blob.includes(hay) || hay.includes(label))
    ) {
      score = 80
    }
    return { ticket, score }
  }).filter((row) => row.score > 0)
  if (scored.length === 0) return null
  const best = Math.max(...scored.map((row) => row.score))
  const winners = scored.filter((row) => row.score === best)
  if (winners.length === 1) return winners[0].ticket
  const labels = new Set(winners.map((row) => ticketFirstLine(row.ticket)))
  // Same visible title (restarted intake) is one request, not a which-one loop.
  if (labels.size === 1) return winners[0].ticket
  return null
}

export function matchOpenRequests(
  body: string,
  tickets: OpenRequestSummary[],
): OpenRequestSummary[] {
  const byLabel = uniqueLabelMatch(body, tickets)
  if (byLabel) return [byLabel]

  const inferred = inferIssueTypeFromText(body)
  const hay = body.toLowerCase()
  const hits: OpenRequestSummary[] = []
  for (const ticket of tickets) {
    const blob = `${ticket.issue_category ?? ""} ${ticket.description ?? ""}`.toLowerCase()
    const existing = ticketIssueType(ticket)
    if (inferred && existing && inferred === existing) {
      hits.push(ticket)
      continue
    }
    if (inferred && blob.includes(inferred.toLowerCase())) {
      hits.push(ticket)
      continue
    }
    const tokens = hay.split(/\W+/).filter((w) => w.length > 3)
    if (tokens.some((token) => blob.includes(token))) {
      hits.push(ticket)
    }
  }
  return hits
}

function intentForKind(kind: FollowUpKind): TenantSmsIntent {
  if (kind === "resolved") return "maintenance_cancel"
  if (kind === "schedule") return "schedule_change"
  if (kind === "access") return "access_instruction"
  return "maintenance_update"
}

function slotsForKind(kind: FollowUpKind, body: string): Record<string, string> {
  if (kind === "resolved") return {}
  if (kind === "schedule") return {}
  return { update: body.trim().slice(0, 240), kind }
}

export function resolveContextualFollowUp(input: {
  body: string
  hasMedia: boolean
  intent: TenantSmsIntent | null
  openTickets: OpenRequestSummary[]
  activeIntake: boolean
}): ContextualFollowUpDecision {
  const body = input.body.trim()
  const intent = input.intent
  const partitioned = partitionMaintenanceTicketsByStatus(input.openTickets)
  const open = partitioned.active.filter(
    (row) => !looksLikeStatusInquiryTicketDescription(row.description),
  )
  const historical = partitioned.historical.filter(
    (row) =>
      !looksLikeStatusInquiryTicketDescription(row.description) &&
      isIdentifiableRequestLabel(row),
  )
  // Recurrence pool: historical closed/canceled tickets + any still-open matches.
  const related = [
    ...open,
    ...historical,
  ]

  if (
    intent === "lease_info" ||
    intent === "rent_balance" ||
    intent === "rent_late" ||
    intent === "move_out_intent" ||
    intent === "other"
  ) {
    return { action: "switch_intent" }
  }

  if (
    looksLikeMaintenanceStatusAsk(body) ||
    looksLikeClosedRepairStatusAsk(body) ||
    intent === "maintenance_status"
  ) {
    // Prefer active context; fall back to historical when asking about a closed repair.
    if (open.length > 0) {
      return followUpForOpenTickets({
        intent: "maintenance_status",
        slots: {},
        open,
        related,
        body,
        kind: null,
      })
    }
    if (historical.length > 0) {
      const matched = matchOpenRequests(body, historical)
      const ticket = matched[0] ?? historical[0]
      return {
        action: "follow_up",
        intent: "maintenance_status",
        slots: { historical: "true" },
        ticketId: ticket.id,
      }
    }
    return { action: "follow_up", intent: "maintenance_status", slots: {} }
  }

  if (
    shouldKeepActivePendingContext({
      body,
      intent,
      openTickets: open,
      activeIntake: input.activeIntake,
    })
  ) {
    return { action: "continue_intake" }
  }

  if (
    intent !== "maintenance_cancel" &&
    open.length > 0 &&
    inferIssueTypeFromText(body) &&
    isDistinctNewIssue(body, open)
  ) {
    return { action: "new_issue" }
  }

  if (intent && FOLLOW_UP_INTENTS.has(intent)) {
    const followKind = classifyFollowUpKind(body, input.hasMedia)
    // Mid-wizard cancel is this request. Don't list duplicate titles.
    if (intent === "maintenance_cancel" && input.activeIntake) {
      const matched = matchOpenRequests(body, open)
      return {
        action: "follow_up",
        intent,
        slots: {},
        ...(matched.length === 1 ? { ticketId: matched[0].id } : {}),
      }
    }
    if (intent === "maintenance_update" || intent === "maintenance_cancel") {
      const kind = followKind
      const pool = kind === "reopen" || looksLikeProblemReturned(body)
        ? related
        : open
      const unique = dedupeTicketsByRequestLabel(
        pool.filter(isIdentifiableRequestLabel),
      )
      if (unique.length > 1) {
        const matched = matchOpenRequests(body, pool)
        if (matched.length !== 1) {
          return { action: "clarify", ticketIds: unique.map((row) => row.id) }
        }
        return {
          action: "follow_up",
          intent,
          slots: kind === "reopen" ? slotsForKind("reopen", body) : {},
          ticketId: matched[0].id,
        }
      }
      if (unique.length === 1) {
        return {
          action: "follow_up",
          intent,
          slots: kind === "reopen" ? slotsForKind("reopen", body) : {},
          ticketId: unique[0].id,
        }
      }
      // Cancel against historical only → still handle (idempotent already-closed).
      if (intent === "maintenance_cancel" && historical.length > 0) {
        const matched = matchOpenRequests(body, historical)
        return {
          action: "follow_up",
          intent,
          slots: { historical: "true" },
          ticketId: matched[0]?.id ?? historical[0].id,
        }
      }
    }
    return { action: "follow_up", intent, slots: {} }
  }

  const kind = classifyFollowUpKind(body, input.hasMedia)
  const distinctNewTrade =
    Boolean(inferIssueTypeFromText(body)) && isDistinctNewIssue(body, open)
  if (kind && !distinctNewTrade) {
    const pool = kind === "reopen" ? related : open
    if (pool.length === 0 && input.activeIntake) {
      return { action: "continue_intake" }
    }
    if (pool.length === 0 && !input.activeIntake) {
      // Closure/cancel with only historical tickets → confirm already closed.
      if (kind === "resolved" && historical.length > 0) {
        const matched = matchOpenRequests(body, historical)
        return {
          action: "follow_up",
          intent: "maintenance_cancel",
          slots: { historical: "true" },
          ticketId: matched[0]?.id ?? historical[0].id,
        }
      }
      return { action: "new_issue" }
    }
    return followUpForOpenTickets({
      intent: intentForKind(kind),
      slots: slotsForKind(kind, body),
      open: pool,
      related: pool,
      body,
      kind,
    })
  }

  // Intent-level gate: active work orders + message shape before any new ticket.
  const resolved = resolveMaintenanceWorkIntent({
    body,
    hasMedia: input.hasMedia,
    heuristicIntent: intent,
    openTickets: open,
  })

  if (!allowsNewMaintenanceTicket(resolved)) {
    const decision = decisionFromResolvedIntent({
      resolved,
      body,
      open,
      related,
      activeIntake: input.activeIntake,
      kind,
    })
    if (decision) return decision
  }

  if (allowsNewMaintenanceTicket(resolved)) {
    return { action: "new_issue" }
  }

  if (input.activeIntake) return { action: "continue_intake" }
  // Prefer clarification over a false ticket when active work exists.
  if (open.length > 0) {
    const unique = dedupeTicketsByRequestLabel(
      open.filter(isIdentifiableRequestLabel),
    )
    if (unique.length > 1) {
      return { action: "clarify", ticketIds: unique.map((row) => row.id) }
    }
    if (unique.length === 1) {
      return {
        action: "follow_up",
        intent: "maintenance_status",
        slots: {},
        ticketId: unique[0].id,
      }
    }
  }
  return { action: "new_issue" }
}

function followUpForOpenTickets(input: {
  intent: TenantSmsIntent
  slots: Record<string, string>
  open: OpenRequestSummary[]
  related: OpenRequestSummary[]
  body: string
  kind: FollowUpKind | null
}): ContextualFollowUpDecision {
  const pool = input.open
  if (pool.length === 0) {
    return { action: "follow_up", intent: input.intent, slots: input.slots }
  }
  if (pool.length === 1) {
    return {
      action: "follow_up",
      intent: input.intent,
      slots: input.slots,
      ticketId: pool[0].id,
    }
  }
  const unique = dedupeTicketsByRequestLabel(
    pool.filter(isIdentifiableRequestLabel),
  )
  const matched = matchOpenRequests(input.body, pool)
  if (unique.length > 1 && matched.length !== 1) {
    return { action: "clarify", ticketIds: unique.map((row) => row.id) }
  }
  return {
    action: "follow_up",
    intent: input.intent,
    slots: input.slots,
    ticketId: matched[0]?.id ?? unique[0]?.id ?? pool[0]?.id,
  }
}

function decisionFromResolvedIntent(input: {
  resolved: ResolvedMaintenanceIntent
  body: string
  open: OpenRequestSummary[]
  related: OpenRequestSummary[]
  activeIntake: boolean
  kind: FollowUpKind | null
}): ContextualFollowUpDecision | null {
  const { resolved, body, open, related, activeIntake } = input

  if (resolved === "OTHER") {
    return { action: "switch_intent" }
  }

  if (resolved === "AMBIGUOUS") {
    // Only active, identifiable tickets can drive RELATED/SEPARATE.
    const contextTickets = open.filter(isIdentifiableRequestLabel)
    if (contextTickets.length > 1) {
      const unique = dedupeTicketsByRequestLabel(contextTickets)
      if (unique.length > 1) {
        return { action: "clarify", ticketIds: unique.map((row) => row.id) }
      }
    }
    if (contextTickets.length >= 1) {
      // Same-trade new symptom, or vague existing-work ask: one clarification.
      return {
        action: "follow_up",
        intent: "maintenance_update",
        slots: {
          update: body.slice(0, 240),
          kind: "ambiguous_related",
          needs_related_clarify: "true",
        },
        ticketId: matchOpenRequests(body, contextTickets)[0]?.id ??
          contextTickets[0]?.id,
      }
    }
    if (activeIntake) return { action: "continue_intake" }
    return null
  }

  const mapped = tenantIntentForResolved(resolved)
  const followKind = input.kind ??
    (resolved === "WORSENED"
      ? "worse"
      : resolved === "NO_SHOW"
      ? "no_show"
      : resolved === "PHOTO_UPDATE"
      ? "photo"
      : resolved === "UPDATE"
      ? "update"
      : resolved === "RESOLVED" || resolved === "CANCEL"
      ? "resolved"
      : resolved === "SCHEDULING"
      ? "schedule"
      : null)

  if (
    mapped === "maintenance_status" ||
    mapped === "maintenance_update" ||
    mapped === "maintenance_cancel" ||
    mapped === "schedule_change" ||
    mapped === "access_instruction"
  ) {
    const pool = followKind === "reopen" ? related : open
    if (pool.length === 0 && activeIntake) return { action: "continue_intake" }
    if (pool.length === 0) {
      // Status ask with nothing open — still don't invent a repair ticket.
      if (mapped === "maintenance_status") {
        return { action: "follow_up", intent: "maintenance_status", slots: {} }
      }
      return null
    }
    return followUpForOpenTickets({
      intent: mapped,
      slots: followKind
        ? slotsForKind(followKind, body)
        : mapped === "maintenance_status"
        ? {}
        : { update: body.slice(0, 240), kind: "update" },
      open: pool,
      related: pool,
      body,
      kind: followKind,
    })
  }

  return null
}
