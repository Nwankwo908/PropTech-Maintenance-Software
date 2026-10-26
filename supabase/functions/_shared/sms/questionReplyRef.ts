/** Question references identify a proposal/version, never authorize the sender. */
export type QuestionReplyRef = {
  kind: "schedule" | "estimate"
  ref: string
  body: string
}
const TOKEN = /\b([SE])-([0-9a-f]{12})\b/gi

export function parseQuestionReplyRef(body: string): QuestionReplyRef | null {
  const hits = [...body.matchAll(TOKEN)]
  if (hits.length !== 1) return null
  return {
    kind: hits[0][1].toUpperCase() === "S" ? "schedule" : "estimate",
    ref: hits[0][0].toUpperCase(),
    body: body.replace(TOKEN, " ").replace(/\s+/g, " ").trim(),
  }
}

export function hasQuestionReplyRef(body: string): boolean {
  return /\b[SE]-[a-z0-9]+\b/i.test(body)
}

export function estimateReplyRef(estimateId: string): string {
  const compact = estimateId.replace(/-/g, "")
  if (!/^[a-f0-9]{32}$/i.test(compact)) throw new Error("Invalid estimate ID")
  return `E-${compact.slice(0, 12).toUpperCase()}`
}

export function estimateRefBounds(
  ref: string,
): { lower: string; upper: string } {
  if (!/^E-[a-f0-9]{12}$/i.test(ref)) {
    throw new Error("Invalid estimate reference")
  }
  const prefix = ref.slice(2).toLowerCase()
  const uuid = (value: string) =>
    `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${
      value.slice(16, 20)
    }-${value.slice(20)}`
  return {
    lower: uuid(prefix + "0".repeat(20)),
    upper: uuid(prefix + "f".repeat(20)),
  }
}

export type ScheduleQuestion = Record<string, unknown>
const KEY = "schedule_reply_questions"
function record(value: unknown): ScheduleQuestion | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as ScheduleQuestion
    : null
}
export function scheduleQuestions(
  intake: Record<string, unknown>,
): ScheduleQuestion[] {
  const rows = Array.isArray(intake[KEY])
    ? intake[KEY].map(record).filter((v): v is ScheduleQuestion => Boolean(v))
    : []
  const legacy = record(intake.awaiting_schedule_confirmation)
  // Older code clears/updates the legacy slot. Honor that as invalidation, not
  // permission to resurrect a question from the compatibility collection.
  if (!legacy) return []
  const ticket = legacy.ticket_id ?? legacy.ticketId
  const compatible = rows.filter((r) =>
    (r.ticket_id ?? r.ticketId) !== ticket ||
    (r.reply_ref && r.reply_ref === legacy.reply_ref)
  )
  if (
    !compatible.some((r) => r.reply_ref && r.reply_ref === legacy.reply_ref)
  ) compatible.push(legacy)
  return compatible
}

export function addScheduleQuestion(
  intake: Record<string, unknown>,
  question: ScheduleQuestion,
): Record<string, unknown> {
  // A new proposal for the same job supersedes that job's old proposal only.
  const rows = scheduleQuestions(intake).filter((r) =>
    r.ticket_id !== question.ticket_id
  )
  return {
    ...intake,
    [KEY]: [...rows, question],
    awaiting_schedule_confirmation: question,
  }
}

export function removeScheduleQuestion(
  intake: Record<string, unknown>,
  question: ScheduleQuestion,
): Record<string, unknown> {
  const rows = scheduleQuestions(intake).filter((r) =>
    question.reply_ref
      ? r.reply_ref !== question.reply_ref
      : r.ticket_id !== question.ticket_id
  )
  const next: Record<string, unknown> = { ...intake, [KEY]: rows }
  delete next.awaiting_schedule_confirmation
  if (rows.length) next.awaiting_schedule_confirmation = rows[rows.length - 1]
  return next
}

export function selectScheduleQuestion(
  intake: Record<string, unknown>,
  body: string,
  now = Date.now(),
): { kind: "selected"; question: ScheduleQuestion; body: string } | {
  kind: "clarify"
  body: string
} | { kind: "none" } {
  const rows = scheduleQuestions(intake)
  const explicit = parseQuestionReplyRef(body)
  if (explicit?.kind === "estimate") return { kind: "none" }
  if (hasQuestionReplyRef(body) && !explicit) {
    return {
      kind: "clarify",
      body: "Please include one question reference and your answer.",
    }
  }
  const matches = explicit
    ? rows.filter((r) => r.reply_ref === explicit.ref)
    : rows.filter((r) =>
      typeof r.expires_at !== "string" ||
      !Number.isFinite(Date.parse(r.expires_at)) ||
      now < Date.parse(r.expires_at)
    )
  if (!explicit && rows.length && !matches.length) {
    return {
      kind: "clarify",
      body:
        "Those visit questions have expired. Please ask for a fresh visit proposal; I haven't changed the schedule.",
    }
  }
  if (explicit && matches.length !== 1) {
    return {
      kind: "clarify",
      body:
        "That visit question is no longer open or has been replaced. Please reply to the current visit question; I haven't changed the schedule.",
    }
  }
  if (!matches.length) return { kind: "none" }
  if (matches.length > 1) {
    return {
      kind: "clarify",
      body: "Which visit are you answering?\n" +
        matches.map((r) =>
          `${r.reply_ref || "Earlier visit"}: ${
            r.window_text || "proposed visit"
          } — reply ${r.reply_ref || "with the job reference and"} YES or NO.`
        ).join("\n"),
    }
  }
  const question = matches[0]
  const expiry = typeof question.expires_at === "string"
    ? Date.parse(question.expires_at)
    : NaN
  if (Number.isFinite(expiry) && now >= expiry) {
    return {
      kind: "clarify",
      body:
        "That visit question has expired. Please ask for a fresh visit proposal; I haven't confirmed the old time.",
    }
  }
  return { kind: "selected", question, body: explicit?.body ?? body }
}
