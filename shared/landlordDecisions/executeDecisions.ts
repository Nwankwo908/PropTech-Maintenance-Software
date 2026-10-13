/**
 * Validates parser/LLM intents against the latest batch snapshot and plans
 * state transitions. Callers apply the mutations; this module does no I/O.
 */
import type { DecisionAction, DecisionIntent, ParseDecisionReplyResult, TicketClass } from "./parseDecisionReply.ts"

export type BatchCandidate = {
  ticketId: string
  displayId: number
  ticketClass: TicketClass
  /** Still awaiting landlord pick. */
  awaitingPick: boolean
  vendorName: string
  windowLabel: string
  vendorAvailable: boolean
  windowAvailable: boolean
}

export type DecisionStatusLine = {
  displayId: number | null
  text: string
}

export type DecisionMutation =
  | { kind: "book"; ticketId: string; displayId: number }
  | { kind: "snooze"; ticketId: string; displayId: number; until: string }
  | { kind: "self"; ticketId: string; displayId: number }
  | { kind: "skip"; ticketId: string; displayId: number }
  | { kind: "options"; ticketId: string; displayId: number }

export type ExecuteDecisionsResult = {
  mutations: DecisionMutation[]
  lines: DecisionStatusLine[]
  /** Ask at most one follow-up. */
  question: string | null
  executed: boolean
}

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

export function formatSnoozeLabel(ymd: string): string {
  const match = ymd.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return ymd
  const dt = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
  const weekday = WEEKDAY[dt.getUTCDay()] ?? ""
  return `${weekday} ${Number(match[2])}/${Number(match[3])}`
}

function unknownIdFromSegment(segment: string, known: Set<number>): number | null {
  const match = segment.match(/(?:#)?(\d+)/)
  if (!match) return null
  const id = Number(match[1])
  if (!Number.isInteger(id) || known.has(id)) return null
  return id
}

function lineFor(intent: DecisionIntent, candidate: BatchCandidate): {
  mutation: DecisionMutation | null
  text: string
} {
  if (!candidate.awaitingPick) {
    return { mutation: null, text: `#${candidate.displayId} already decided.` }
  }
  if (intent.action === "skip" && candidate.ticketClass !== "proactive") {
    return {
      mutation: null,
      text: `#${candidate.displayId} can't skip a tenant request — reply self or snooze.`,
    }
  }
  if (intent.action === "yes") {
    if (!candidate.vendorAvailable || !candidate.windowAvailable) {
      return {
        mutation: null,
        text: `#${candidate.displayId} isn't available as offered. Reply ${candidate.displayId} options.`,
      }
    }
    const window = candidate.windowLabel.trim()
    const vendor = candidate.vendorName.trim() || "the vendor"
    const when = window ? `${window} with ${vendor}` : vendor
    return {
      mutation: { kind: "book", ticketId: candidate.ticketId, displayId: candidate.displayId },
      text: `#${candidate.displayId} booked ${when}.`,
    }
  }
  if (intent.action === "snooze") {
    const until = intent.snoozeUntil ?? ""
    return {
      mutation: {
        kind: "snooze",
        ticketId: candidate.ticketId,
        displayId: candidate.displayId,
        until,
      },
      text: `#${candidate.displayId} snoozed to ${formatSnoozeLabel(until)}.`,
    }
  }
  if (intent.action === "self") {
    return {
      mutation: { kind: "self", ticketId: candidate.ticketId, displayId: candidate.displayId },
      text: `#${candidate.displayId} marked for you to handle.`,
    }
  }
  if (intent.action === "skip") {
    return {
      mutation: { kind: "skip", ticketId: candidate.ticketId, displayId: candidate.displayId },
      text: `#${candidate.displayId} skipped.`,
    }
  }
  return {
    mutation: { kind: "options", ticketId: candidate.ticketId, displayId: candidate.displayId },
    text: `#${candidate.displayId} — I'll list the other options.`,
  }
}

export function buildDecisionConfirmation(lines: string[], question: string | null): string {
  const done = lines.filter(Boolean)
  const body = done.length > 0 ? `Done: ${done.join(" ")}` : "Done."
  if (!question) return body
  return done.length > 0 ? `${body} ${question}` : question
}

/**
 * YES ALL expands to every still-open candidate, then explicit intents override
 * (last wins, already applied by the parser). A YES ALL inside 10 minutes of a
 * superseding batch asks once and does not execute.
 */
export function executeDecisionPlan(input: {
  candidates: BatchCandidate[]
  parsed: ParseDecisionReplyResult
  llmIntents?: DecisionIntent[]
  yesAllNeedsConfirm?: boolean
}): ExecuteDecisionsResult {
  if (input.parsed.yesAll && input.yesAllNeedsConfirm) {
    return {
      mutations: [],
      lines: [],
      question:
        "That list was just replaced. Reply YES ALL again to approve the current list.",
      executed: false,
    }
  }

  const byId = new Map(input.candidates.map((row) => [row.displayId, row]))
  const known = new Set(byId.keys())
  const intents = new Map<number, DecisionIntent>()

  if (input.parsed.yesAll) {
    for (const candidate of input.candidates) {
      if (!candidate.awaitingPick) continue
      intents.set(candidate.displayId, { displayId: candidate.displayId, action: "yes" })
    }
  }
  for (const intent of input.parsed.intents) intents.set(intent.displayId, intent)
  for (const intent of input.llmIntents ?? []) {
    if (!intents.has(intent.displayId)) intents.set(intent.displayId, intent)
  }

  const lines: DecisionStatusLine[] = []
  const mutations: DecisionMutation[] = []
  const covered = new Set<number>()

  for (const intent of intents.values()) {
    const candidate = byId.get(intent.displayId)
    covered.add(intent.displayId)
    if (!candidate) {
      lines.push({
        displayId: intent.displayId,
        text: `#${intent.displayId} isn't in your list.`,
      })
      continue
    }
    const applied = lineFor(intent, candidate)
    if (applied.mutation) mutations.push(applied.mutation)
    lines.push({ displayId: candidate.displayId, text: applied.text })
  }

  const mentionedUnknown = new Set<number>()
  for (const segment of input.parsed.unclear) {
    const id = unknownIdFromSegment(segment, known)
    if (id == null || mentionedUnknown.has(id)) continue
    mentionedUnknown.add(id)
    lines.push({ displayId: id, text: `#${id} isn't in your list.` })
  }

  let question: string | null = null
  const unresolved = input.parsed.unclear.filter((segment) => {
    const id = unknownIdFromSegment(segment, known)
    return id == null
  })
  const firstUnclear = unresolved[0]
  if (firstUnclear) {
    const idMatch = firstUnclear.match(/(?:#)?(\d+)/)
    const id = idMatch ? Number(idMatch[1]) : null
    const candidate = id != null ? byId.get(id) : undefined
    if (candidate && !covered.has(candidate.displayId)) {
      const choices = candidate.ticketClass === "proactive"
        ? "yes, options, self, snooze, or skip"
        : "yes, options, self, or snooze"
      question =
        `#${candidate.displayId} still needs a decision — reply ${candidate.displayId} ${choices}.`
    } else if (!candidate) {
      question = `I didn't catch "${firstUnclear}". Reply with the request number and yes, options, self, or snooze.`
    }
  }

  return {
    mutations,
    lines,
    question,
    executed: true,
  }
}

export function decisionActionAllowed(
  action: DecisionAction,
  ticketClass: TicketClass,
): boolean {
  if (action === "skip") return ticketClass === "proactive"
  return true
}
