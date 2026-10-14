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
  issue?: string | null
  unitLabel?: string | null
}

export type DecisionLineKind = "applied" | "unknown" | "unclear"

export type DecisionStatusLine = {
  displayId: number | null
  text: string
  kind: DecisionLineKind
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
    return {
      mutation: { kind: "book", ticketId: candidate.ticketId, displayId: candidate.displayId },
      text: `#${candidate.displayId} approved.`,
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

export function buildDecisionConfirmation(
  lines: DecisionStatusLine[],
  question: string | null,
): string {
  const applied = lines.filter((line) => line.kind === "applied" && line.text.trim())
  const other = lines.filter((line) => line.kind !== "applied" && line.text.trim())
  const parts: string[] = []
  if (applied.length > 0) {
    parts.push(`Done: ${applied.map((line) => line.text.trim()).join(" ")}`)
  }
  for (const line of other) parts.push(line.text.trim())
  if (question?.trim()) parts.push(question.trim())
  return parts.join("\n")
}

function openCandidates(candidates: BatchCandidate[]): BatchCandidate[] {
  return candidates.filter((row) => row.awaitingPick)
}

function unknownIdRecovery(displayId: number, candidates: BatchCandidate[]): string {
  const open = openCandidates(candidates)
  if (open.length === 1) {
    const one = open[0]!
    const issue = one.issue?.trim() || "request"
    const unit = one.unitLabel?.trim()
    const where = unit
      ? (/^unit\b/i.test(unit) ? unit : `Unit ${unit}`)
      : "that unit"
    return `I couldn't find #${displayId}. Did you mean the ${issue} in ${where}? Reply YES to approve or SNOOZE FRI.`
  }
  const ids = open.map((row) => `#${row.displayId}`).join(", ")
  if (!ids) return `I couldn't find #${displayId}.`
  return `I couldn't find #${displayId}. Your open requests are ${ids}.`
}

function bareDisplayId(segment: string): number | null {
  const match = segment.trim().match(/^(?:#)?(\d+)$/)
  if (!match) return null
  const id = Number(match[1])
  return Number.isInteger(id) ? id : null
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
  const bareIds = new Set<number>()
  for (const segment of input.parsed.unclear) {
    const id = bareDisplayId(segment)
    if (id != null) bareIds.add(id)
  }
  const intents = new Map<number, DecisionIntent>()

  if (input.parsed.yesAll) {
    for (const candidate of input.candidates) {
      if (!candidate.awaitingPick) continue
      intents.set(candidate.displayId, { displayId: candidate.displayId, action: "yes" })
    }
  }
  for (const intent of input.parsed.intents) intents.set(intent.displayId, intent)
  for (const intent of input.llmIntents ?? []) {
    if (bareIds.has(intent.displayId)) continue
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
        kind: "unknown",
        text: unknownIdRecovery(intent.displayId, input.candidates),
      })
      continue
    }
    const applied = lineFor(intent, candidate)
    if (applied.mutation) mutations.push(applied.mutation)
    lines.push({
      displayId: candidate.displayId,
      text: applied.text,
      kind: applied.mutation ? "applied" : "unclear",
    })
  }

  const mentionedUnknown = new Set<number>()
  let question: string | null = null
  for (const segment of input.parsed.unclear) {
    const bare = bareDisplayId(segment)
    if (bare != null && byId.has(bare)) {
      const candidate = byId.get(bare)!
      if (!covered.has(candidate.displayId) && !question) {
        const issue = candidate.issue?.trim() || "that request"
        question =
          `What should I do with #${candidate.displayId} (${issue})? Reply YES, SNOOZE FRI, or SKIP.`
      }
      continue
    }
    const id = unknownIdFromSegment(segment, known)
    if (id == null || mentionedUnknown.has(id)) continue
    mentionedUnknown.add(id)
    lines.push({
      displayId: id,
      kind: "unknown",
      text: unknownIdRecovery(id, input.candidates),
    })
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
