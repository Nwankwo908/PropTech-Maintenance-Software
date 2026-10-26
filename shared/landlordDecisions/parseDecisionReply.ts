/**
 * Pure parser for batched landlord decision replies.
 * Does not read or write ticket state.
 */

export type TicketClass = "reactive" | "proactive"

export type DecisionAction = "yes" | "no" | "options" | "self" | "fixed" | "snooze" | "skip"

export type DecisionCandidate = {
  displayId: number
  ticketClass: TicketClass
}

export type DecisionIntent = {
  displayId: number
  action: DecisionAction
  /** Calendar date YYYY-MM-DD in the landlord's time zone, when action is snooze. */
  snoozeUntil?: string
}

export type ParseDecisionReplyResult = {
  intents: DecisionIntent[]
  /** Segments that were not a safe decision. Last duplicate id wins in intents. */
  unclear: string[]
  yesAll: boolean
}

const ACTION_WORDS: Record<string, DecisionAction> = {
  yes: "yes",
  y: "yes",
  yeah: "yes",
  yep: "yes",
  approve: "yes",
  approved: "yes",
  book: "yes",
  no: "no",
  n: "no",
  nope: "no",
  decline: "no",
  declined: "no",
  deny: "no",
  reject: "no",
  options: "options",
  option: "options",
  alternatives: "options",
  alternative: "options",
  self: "self",
  myself: "self",
  fixed: "fixed",
  resolved: "fixed",
  // Legacy power-user words — still parsed, never shown in outbound copy.
  skip: "skip",
  pass: "skip",
  snooze: "snooze",
  later: "snooze",
}

const WEEKDAY_INDEX: Record<string, number> = {
  sun: 0,
  sunday: 0,
  mon: 1,
  monday: 1,
  tue: 2,
  tues: 2,
  tuesday: 2,
  wed: 3,
  wednesday: 3,
  thu: 4,
  thur: 4,
  thurs: 4,
  thursday: 4,
  fri: 5,
  friday: 5,
  sat: 6,
  saturday: 6,
}

type Ymd = { y: number; m: number; d: number; weekday: number }

function zonedYmd(date: Date, timeZone: string): Ymd {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  })
  const parts = Object.fromEntries(
    fmt.formatToParts(date).map((part) => [part.type, part.value]),
  )
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(
    parts.weekday ?? "",
  )
  return {
    y: Number(parts.year),
    m: Number(parts.month),
    d: Number(parts.day),
    weekday: weekday < 0 ? 0 : weekday,
  }
}

function addDays(ymd: Ymd, days: number): Ymd {
  const dt = new Date(Date.UTC(ymd.y, ymd.m - 1, ymd.d + days))
  return {
    y: dt.getUTCFullYear(),
    m: dt.getUTCMonth() + 1,
    d: dt.getUTCDate(),
    weekday: dt.getUTCDay(),
  }
}

export function formatDecisionYmd(ymd: Ymd): string {
  const m = String(ymd.m).padStart(2, "0")
  const d = String(ymd.d).padStart(2, "0")
  return `${ymd.y}-${m}-${d}`
}

function compareYmd(a: Ymd, b: Ymd): number {
  return formatDecisionYmd(a).localeCompare(formatDecisionYmd(b))
}

function splitSegments(body: string): string[] {
  return body
    .split(/\s*(?:,|;|\n|\band\b)\s*/i)
    .map((part) => part.trim())
    .filter(Boolean)
}

function isYesAllSegment(segment: string): boolean {
  return /^(yes\s+all|yes\s+to\s+all)$/i.test(segment.trim())
}

/** Bare FIXED applies only when exactly one item is open. */
export function isBareFixedPhrase(segment: string): boolean {
  return /^(fixed|it'?s fixed|its fixed|resolved|works now|all good)$/i.test(segment.trim())
}

function mapAction(word: string): DecisionAction | null {
  return ACTION_WORDS[word.trim().toLowerCase()] ?? null
}

function resolveSnoozeDate(input: {
  args: string
  ticketClass: TicketClass
  now: Date
  landlordTz: string
}): { until: string } | { unclear: true } {
  const today = zonedYmd(input.now, input.landlordTz)
  const args = input.args.trim().toLowerCase()

  let target: Ymd | null = null
  if (!args) {
    if (input.ticketClass === "proactive") {
      target = addDays(today, 7)
    } else {
      target = zonedYmd(
        new Date(input.now.getTime() + 48 * 60 * 60 * 1000),
        input.landlordTz,
      )
    }
  } else if (args === "tomorrow") {
    target = addDays(today, 1)
  } else if (args === "next week") {
    target = addDays(today, 7)
  } else if (WEEKDAY_INDEX[args] != null) {
    const want = WEEKDAY_INDEX[args]!
    let delta = (want - today.weekday + 7) % 7
    if (delta === 0) delta = 7
    target = addDays(today, delta)
  } else {
    const md = args.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/)
    if (!md) return { unclear: true }
    const month = Number(md[1])
    const day = Number(md[2])
    let year = md[3] ? Number(md[3]) : today.y
    if (year < 100) year += 2000
    if (month < 1 || month > 12 || day < 1 || day > 31) return { unclear: true }
    const probe = new Date(Date.UTC(year, month - 1, day))
    if (probe.getUTCMonth() + 1 !== month || probe.getUTCDate() !== day) {
      return { unclear: true }
    }
    target = { y: year, m: month, d: day, weekday: probe.getUTCDay() }
  }

  if (!target || compareYmd(target, today) < 0) return { unclear: true }
  return { until: formatDecisionYmd(target) }
}

/**
 * Last mention of a display id wins. "cancel" is not skip and is not an opt-out.
 * A bare yes/approve applies only when there is exactly one candidate.
 */
export function parseDecisionReply(
  body: string,
  candidates: DecisionCandidate[],
  now: Date,
  landlordTz: string,
): ParseDecisionReplyResult {
  const byId = new Map(candidates.map((row) => [row.displayId, row]))
  const intents = new Map<number, DecisionIntent>()
  const unclear: string[] = []
  let yesAll = false

  const whole = body.trim()
  if (/^(yes\s+all|yes\s+to\s+all)$/i.test(whole)) {
    return { intents: [], unclear: [], yesAll: true }
  }

  for (const segment of splitSegments(body)) {
    if (isYesAllSegment(segment)) {
      yesAll = true
      continue
    }

    if (/^(yes|y|yeah|yep|approve|approved)$/i.test(segment)) {
      if (candidates.length === 1) {
        intents.set(candidates[0]!.displayId, {
          displayId: candidates[0]!.displayId,
          action: "yes",
        })
      } else {
        unclear.push(segment)
      }
      continue
    }

    if (/^(no|n|nope|decline|declined|deny|reject)$/i.test(segment)) {
      if (candidates.length === 1) {
        intents.set(candidates[0]!.displayId, {
          displayId: candidates[0]!.displayId,
          action: "no",
        })
      } else {
        unclear.push(segment)
      }
      continue
    }

    if (isBareFixedPhrase(segment)) {
      if (candidates.length === 1) {
        intents.set(candidates[0]!.displayId, {
          displayId: candidates[0]!.displayId,
          action: "fixed",
        })
      } else {
        unclear.push(segment)
      }
      continue
    }

    if (/^(skip|pass)$/i.test(segment)) {
      if (candidates.length === 1) {
        intents.set(candidates[0]!.displayId, {
          displayId: candidates[0]!.displayId,
          action: "skip",
        })
      } else {
        unclear.push(segment)
      }
      continue
    }

    const bareSnooze = segment.match(/^(snooze|later)(?:\s+(.+))?$/i)
    if (bareSnooze) {
      if (candidates.length !== 1) {
        unclear.push(segment)
        continue
      }
      const only = candidates[0]!
      const resolved = resolveSnoozeDate({
        args: bareSnooze[2] ?? "",
        ticketClass: only.ticketClass,
        now,
        landlordTz,
      })
      if ("unclear" in resolved) {
        unclear.push(segment)
        continue
      }
      intents.set(only.displayId, {
        displayId: only.displayId,
        action: "snooze",
        snoozeUntil: resolved.until,
      })
      continue
    }

    // A number with no action is never an approval.
    if (/^(?:#)?\d+$/.test(segment)) {
      unclear.push(segment)
      continue
    }

    const idFirst = segment.match(
      /^(?:#)?(\d+)\s+([a-z]+)(?:\s+(.+))?$/i,
    )
    const actionFirst = segment.match(
      /^([a-z]+)\s+(?:#)?(\d+)(?:\s+(.+))?$/i,
    )
    const match = idFirst
      ? { id: Number(idFirst[1]), word: idFirst[2] ?? "", args: idFirst[3] ?? "" }
      : actionFirst
        ? { id: Number(actionFirst[2]), word: actionFirst[1] ?? "", args: actionFirst[3] ?? "" }
        : null

    if (!match || !Number.isInteger(match.id)) {
      unclear.push(segment)
      continue
    }

    const candidate = byId.get(match.id)
    const action = mapAction(match.word)
    if (!candidate || !action) {
      unclear.push(segment)
      continue
    }

    if (action === "snooze") {
      const resolved = resolveSnoozeDate({
        args: match.args,
        ticketClass: candidate.ticketClass,
        now,
        landlordTz,
      })
      if ("unclear" in resolved) {
        unclear.push(segment)
        continue
      }
      intents.set(candidate.displayId, {
        displayId: candidate.displayId,
        action: "snooze",
        snoozeUntil: resolved.until,
      })
      continue
    }

    intents.set(candidate.displayId, {
      displayId: candidate.displayId,
      action,
    })
  }

  return { intents: [...intents.values()], unclear, yesAll }
}
