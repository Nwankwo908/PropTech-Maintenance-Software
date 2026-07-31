/**
 * Vendor availability parsing architecture:
 * 1) Dynamic anchor date/timezone in parse + LLM prompt context
 * 2) Structured outputs via OpenAI function calling
 * 3) Dedicated NL date parser (chrono-node) before LLM
 * 4) Soft confirmations / clarifications instead of hard error copy
 */
import * as chrono from "https://esm.sh/chrono-node@2.7.8"

export type ScheduleAnchor = {
  now: Date
  timeZone: string
  /** e.g. "Monday, July 20, 2026" */
  todayLabel: string
  /** e.g. "1:39 PM" */
  nowTimeLabel: string
  /** ISO instant used as chrono reference */
  nowIso: string
}

export type AvailabilityConfidence = "high" | "medium" | "low"

/** Structured arrival slot preserved through confirm / correction (not a single timestamp). */
export type ArrivalEntityType = "WINDOW" | "EXACT"

export type ArrivalEntity = {
  /** Calendar date in landlord TZ (YYYY-MM-DD). */
  date: string
  type: ArrivalEntityType
  /** Wall-clock HH:mm in landlord TZ. */
  start_time: string
  /** Wall-clock HH:mm in landlord TZ; null for EXACT. */
  end_time: string | null
  display_text: string
}

export type ResolvedAvailability = {
  scheduledAt: string
  endAt: string | null
  /** Human label for SMS / admin (prefer vendor wording when clear). */
  windowLabel: string
  confidence: AvailabilityConfidence
  source: "chrono" | "regex" | "llm"
  /** Structured window/exact entity — source of truth for confirm copy. */
  entity?: ArrivalEntity
}

export type AvailabilityResolveResult =
  | { status: "resolved"; value: ResolvedAvailability }
  | {
    status: "needs_confirmation"
    value: ResolvedAvailability
    softPrompt: string
  }
  | { status: "needs_clarification"; softPrompt: string }

const DEFAULT_TZ = "America/New_York"
const PARSE_MODEL = "gpt-4o-mini"

export function scheduleTimeZone(): string {
  const raw = Deno.env.get("VENDOR_SCHEDULE_TZ")?.trim()
  return raw || DEFAULT_TZ
}

function pad2(n: number): string {
  return String(n).padStart(2, "0")
}

/** Wall-clock parts in a timezone for an instant. */
export function zonedParts(
  date: Date,
  timeZone: string,
): {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  weekday: string
  monthName: string
  dayNum: number
} {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: false,
  })
  const parts = dtf.formatToParts(date)
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? ""
  let hour = Number(get("hour"))
  if (hour === 24) hour = 0
  return {
    year: Number(get("year")),
    month: monthNameToNumber(get("month")),
    day: Number(get("day")),
    hour,
    minute: Number(get("minute")),
    weekday: get("weekday"),
    monthName: get("month"),
    dayNum: Number(get("day")),
  }
}

function monthNameToNumber(name: string): number {
  const idx = [
    "january",
    "february",
    "march",
    "april",
    "may",
    "june",
    "july",
    "august",
    "september",
    "october",
    "november",
    "december",
  ].indexOf(name.trim().toLowerCase())
  return idx >= 0 ? idx + 1 : 1
}

/** Convert a timezone wall-clock datetime to a UTC Date. */
export function zonedWallTimeToUtc(
  parts: {
    year: number
    month: number
    day: number
    hour: number
    minute: number
  },
  timeZone: string,
): Date {
  const asUtcGuess = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    0,
  )

  const offsetFor = (utcMs: number): number => {
    const z = zonedParts(new Date(utcMs), timeZone)
    const asIfUtc = Date.UTC(
      z.year,
      z.month - 1,
      z.day,
      z.hour,
      z.minute,
      0,
    )
    return asIfUtc - utcMs
  }

  let utcMs = asUtcGuess - offsetFor(asUtcGuess)
  utcMs = asUtcGuess - offsetFor(utcMs)
  return new Date(utcMs)
}

export function buildScheduleAnchor(
  now = new Date(),
  timeZone = scheduleTimeZone(),
): ScheduleAnchor {
  const z = zonedParts(now, timeZone)
  const hour12 = ((z.hour + 11) % 12) + 1
  const ampm = z.hour >= 12 ? "PM" : "AM"
  return {
    now,
    timeZone,
    todayLabel: `${z.weekday}, ${z.monthName} ${z.dayNum}, ${z.year}`,
    nowTimeLabel: `${hour12}:${pad2(z.minute)} ${ampm}`,
    nowIso: now.toISOString(),
  }
}

function formatWindowLabel(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date)
}

function normalizeVendorText(raw: string): string {
  return raw.trim().replace(/\s+/g, " ")
}

/** Max length for an accepted bounded arrival window (4 hours). */
export const MAX_BOUNDED_WINDOW_MS = 4 * 60 * 60 * 1000
/** Soft-anchor length when a vendor sends an oversized range. */
export const PREFERRED_WINDOW_MS = 3 * 60 * 60 * 1000

export type ArrivalWindowKind = "exact" | "bounded" | "oversized" | "unbounded"

function looksVague(text: string): boolean {
  const t = text.toLowerCase()
  if (
    /\b(asap|soon|whenever|this week|next week|morning|afternoon|evening|later)\b/
      .test(t) &&
    !/\b\d{1,2}\b/.test(t)
  ) {
    return true
  }
  if (/^(tomorrow|today|monday|tuesday|wednesday|thursday|friday|saturday|sunday)$/i.test(t)) {
    return true
  }
  return false
}

function hasExplicitClock(text: string): boolean {
  return (
    /\b\d{1,2}(?::\d{2})?\s*(a\.?m\.?|p\.?m\.?)\b/i.test(text) ||
    /\b([01]?\d|2[0-3]):([0-5]\d)\b/.test(text) ||
    /\b\d{1,2}\s*[-–—to]+\s*\d{1,2}/i.test(text)
  )
}

/** Open-ended / vague inputs that should not go to the tenant yet. */
export function isUnboundedAvailabilityText(text: string): boolean {
  const t = normalizeVendorText(text).toLowerCase()
  if (!t) return true
  if (
    /\b(sometime|whenever|asap|soon|flexible|this week|next week)\b/.test(t) &&
    !/\d\s*[-–—to]+\s*\d/.test(t)
  ) {
    return true
  }
  // "after 3pm" / "before noon" without an end bound
  if (
    /\b(after|before)\s+\d{1,2}/i.test(t) &&
    !/\d\s*[-–—to]+\s*\d/.test(t)
  ) {
    return true
  }
  if (looksVague(t) && !hasExplicitClock(t)) return true
  return false
}

export function windowDurationMs(value: ResolvedAvailability): number {
  const start = Date.parse(value.scheduledAt)
  if (Number.isNaN(start)) return 0
  if (!value.endAt) return 0
  const end = Date.parse(value.endAt)
  if (Number.isNaN(end) || end <= start) return 0
  return end - start
}

export function classifyArrivalWindow(
  value: ResolvedAvailability,
  rawText: string,
): ArrivalWindowKind {
  if (isUnboundedAvailabilityText(rawText) && windowDurationMs(value) <= 0) {
    return "unbounded"
  }
  if (isUnboundedAvailabilityText(rawText) && !hasExplicitClock(rawText)) {
    return "unbounded"
  }
  const duration = windowDurationMs(value)
  if (duration <= 15 * 60 * 1000) return "exact"
  if (duration <= MAX_BOUNDED_WINDOW_MS) return "bounded"
  return "oversized"
}

function wallTimeHm(date: Date, timeZone: string): string {
  const z = zonedParts(date, timeZone)
  return `${pad2(z.hour)}:${pad2(z.minute)}`
}

function calendarDateYmd(date: Date, timeZone: string): string {
  const z = zonedParts(date, timeZone)
  return `${z.year}-${pad2(z.month)}-${pad2(z.day)}`
}

export function formatArrivalWindowLabel(
  startIso: string,
  endIso: string | null,
  timeZone: string,
): string {
  const start = new Date(startIso)
  if (Number.isNaN(start.getTime())) return "that time"
  const day = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
    month: "short",
    day: "numeric",
  }).format(start)
  const startTime = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  }).format(start)
  if (!endIso) return `${day} at ${startTime}`
  const end = new Date(endIso)
  if (Number.isNaN(end.getTime())) return `${day} at ${startTime}`
  const duration = end.getTime() - start.getTime()
  if (duration <= 15 * 60 * 1000) return `${day} at ${startTime}`
  const endTime = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  }).format(end)
  return `${day} between ${startTime} and ${endTime}`
}

/** Build structured WINDOW/EXACT entity from resolved instants. */
export function toArrivalEntity(
  scheduledAt: string,
  endAt: string | null,
  timeZone: string,
): ArrivalEntity {
  const start = new Date(scheduledAt)
  const date = calendarDateYmd(start, timeZone)
  const start_time = wallTimeHm(start, timeZone)
  const duration = endAt ? Date.parse(endAt) - Date.parse(scheduledAt) : 0
  const isWindow = Number.isFinite(duration) && duration > 15 * 60 * 1000
  if (isWindow && endAt) {
    return {
      date,
      type: "WINDOW",
      start_time,
      end_time: wallTimeHm(new Date(endAt), timeZone),
      display_text: formatArrivalWindowLabel(scheduledAt, endAt, timeZone),
    }
  }
  return {
    date,
    type: "EXACT",
    start_time,
    end_time: null,
    display_text: formatArrivalWindowLabel(scheduledAt, null, timeZone),
  }
}

const WEEKDAY_ALIASES: Record<string, number> = {
  sun: 0,
  sunday: 0,
  mon: 1,
  monday: 1,
  tue: 2,
  tues: 2,
  tuesday: 2,
  wed: 3,
  weds: 3,
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

/** Extract named weekday index (0=Sun) from free text, or null. */
export function extractNamedWeekdayIndex(text: string): number | null {
  const t = text.toLowerCase()
  // Longer aliases first so "thursday" wins over "thu".
  const keys = Object.keys(WEEKDAY_ALIASES).sort((a, b) => b.length - a.length)
  for (const key of keys) {
    if (new RegExp(`\\b${key}\\b`, "i").test(t)) return WEEKDAY_ALIASES[key]!
  }
  return null
}

/**
 * Resolve a named weekday against the system anchor.
 * Never returns today when the vendor named a different weekday.
 */
export function resolveNamedWeekdayDate(
  namedWeekdayIndex: number,
  anchor: ScheduleAnchor,
): { year: number; month: number; day: number } {
  const zNow = zonedParts(anchor.now, anchor.timeZone)
  const todayIndex = [
    "sunday",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
  ].indexOf(zNow.weekday.toLowerCase())

  // Different weekday named → start searching tomorrow (never pin to today).
  const startAdd = todayIndex === namedWeekdayIndex ? 0 : 1
  for (let add = startAdd; add <= startAdd + 7; add++) {
    const probe = new Date(
      zonedWallTimeToUtc(
        {
          year: zNow.year,
          month: zNow.month,
          day: zNow.day,
          hour: 12,
          minute: 0,
        },
        anchor.timeZone,
      ).getTime() + add * 24 * 60 * 60 * 1000,
    )
    const zp = zonedParts(probe, anchor.timeZone)
    const idx = [
      "sunday",
      "monday",
      "tuesday",
      "wednesday",
      "thursday",
      "friday",
      "saturday",
    ].indexOf(zp.weekday.toLowerCase())
    if (idx === namedWeekdayIndex) {
      return { year: zp.year, month: zp.month, day: zp.day }
    }
  }
  return { year: zNow.year, month: zNow.month, day: zNow.day }
}

/** True when text looks like a start–end clock range (incl. "9am-12pm"). */
export function hasClockRange(text: string): boolean {
  return (
    /\d\s*[-–—to]+\s*\d/i.test(text) ||
    /\b\d{1,2}(?::\d{2})?\s*(a\.?m\.?|p\.?m\.?)\s*[-–—to]+\s*\d{1,2}/i.test(
      text,
    )
  )
}

/** Cap an oversized range to a preferred arrival window from the start. */
export function softAnchorArrivalWindow(
  value: ResolvedAvailability,
  timeZone: string,
  windowMs = PREFERRED_WINDOW_MS,
): ResolvedAvailability {
  const start = new Date(value.scheduledAt)
  const end = new Date(start.getTime() + windowMs)
  const endAt = end.toISOString()
  const entity = toArrivalEntity(value.scheduledAt, endAt, timeZone)
  return {
    ...value,
    endAt,
    windowLabel: entity.display_text,
    confidence: "medium",
    entity,
  }
}

export function buildOversizedWindowPrompt(anchored: ResolvedAvailability): string {
  const when = anchored.windowLabel.trim() || "that arrival window"
  return (
    `Got it — I'll propose ${when} (a tighter arrival window from what you sent). ` +
    `Reply YES to send that to the tenant, or reply with a tighter window ` +
    `(e.g. Wed 9am–12pm).`
  )
}

/** Regex/range fallback when chrono misses (kept timezone-aware). */
export function parseAvailabilityRegex(
  raw: string,
  anchor: ScheduleAnchor,
): ResolvedAvailability | null {
  const text = raw.trim().toLowerCase().replace(/\s+/g, " ")
  if (!text) return null

  const rangeMatch = text.match(
    /\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?\s*[-–—to]+\s*(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)\b/i,
  )
  let hours: number | null = null
  let minutes = 0
  let endHours: number | null = null
  let endMinutes = 0

  if (rangeMatch) {
    hours = Number(rangeMatch[1])
    minutes = rangeMatch[2] ? Number(rangeMatch[2]) : 0
    const startMer = (rangeMatch[3] ?? "").toLowerCase().replace(/\./g, "")
    endHours = Number(rangeMatch[4])
    endMinutes = rangeMatch[5] ? Number(rangeMatch[5]) : 0
    const endMer = (rangeMatch[6] ?? "").toLowerCase().replace(/\./g, "")
    let meridiem = startMer
    if (!meridiem) {
      if (endMer.startsWith("p") && (endHours === 12 || hours > endHours)) {
        meridiem = "am"
      } else {
        meridiem = endMer || "am"
      }
    }
    if (meridiem.startsWith("p") && hours < 12) hours += 12
    if (meridiem.startsWith("a") && hours === 12) hours = 0
    if (endMer.startsWith("p") && endHours < 12) endHours += 12
    if (endMer.startsWith("a") && endHours === 12) endHours = 0
  } else {
    const timeMatch = text.match(
      /\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)\b/i,
    )
    if (timeMatch) {
      hours = Number(timeMatch[1])
      minutes = timeMatch[2] ? Number(timeMatch[2]) : 0
      const meridiem = (timeMatch[3] ?? "").toLowerCase().replace(/\./g, "")
      if (meridiem.startsWith("p") && hours < 12) hours += 12
      if (meridiem.startsWith("a") && hours === 12) hours = 0
    } else {
      const military = text.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/)
      if (military) {
        hours = Number(military[1])
        minutes = Number(military[2])
      }
    }
  }

  if (hours == null) return null

  const zNow = zonedParts(anchor.now, anchor.timeZone)
  let year = zNow.year
  let month = zNow.month
  let day = zNow.day

  if (/\btomorrow\b/.test(text)) {
    const noonToday = zonedWallTimeToUtc(
      { year, month, day, hour: 12, minute: 0 },
      anchor.timeZone,
    )
    const zT = zonedParts(
      new Date(noonToday.getTime() + 24 * 60 * 60 * 1000),
      anchor.timeZone,
    )
    year = zT.year
    month = zT.month
    day = zT.day
  } else if (!/\btoday\b/.test(text)) {
    const namedIdx = extractNamedWeekdayIndex(text)
    if (namedIdx != null) {
      const resolved = resolveNamedWeekdayDate(namedIdx, anchor)
      year = resolved.year
      month = resolved.month
      day = resolved.day
      // Same weekday as today but wall time already passed → next week.
      const candidate = zonedWallTimeToUtc(
        { year, month, day, hour: hours, minute: minutes },
        anchor.timeZone,
      )
      const todayIdx = [
        "sunday",
        "monday",
        "tuesday",
        "wednesday",
        "thursday",
        "friday",
        "saturday",
      ].indexOf(zNow.weekday.toLowerCase())
      if (
        namedIdx === todayIdx &&
        candidate.getTime() < anchor.now.getTime() - 60_000
      ) {
        const nextWeek = resolveNamedWeekdayDate(namedIdx, {
          ...anchor,
          now: new Date(anchor.now.getTime() + 24 * 60 * 60 * 1000),
        })
        year = nextWeek.year
        month = nextWeek.month
        day = nextWeek.day
      }
    }
  }

  const start = zonedWallTimeToUtc(
    { year, month, day, hour: hours, minute: minutes },
    anchor.timeZone,
  )
  if (Number.isNaN(start.getTime())) return null

  let endAt: string | null = null
  if (endHours != null) {
    const end = zonedWallTimeToUtc(
      { year, month, day, hour: endHours, minute: endMinutes },
      anchor.timeZone,
    )
    if (!Number.isNaN(end.getTime())) endAt = end.toISOString()
  }

  const scheduledAt = start.toISOString()
  const entity = toArrivalEntity(scheduledAt, endAt, anchor.timeZone)
  return {
    scheduledAt,
    endAt: entity.type === "WINDOW" ? endAt : null,
    windowLabel: entity.display_text,
    confidence: hasExplicitClock(text) ? "high" : "medium",
    source: "regex",
    entity,
  }
}

export function parseAvailabilityChrono(
  raw: string,
  anchor: ScheduleAnchor,
): ResolvedAvailability | null {
  const text = normalizeVendorText(raw)
  if (!text) return null

  try {
    const results = chrono.parse(text, {
      instant: anchor.now,
      timezone: anchor.timeZone,
    }, { forwardDate: true })
    const first = results[0]
    if (!first?.start) return null

    const startDate = first.start.date()
    if (Number.isNaN(startDate.getTime())) return null

    // Prefer component rebuild in landlord TZ when chrono returns a Date
    // that may be UTC-shifted on edge runtimes.
    const y = first.start.get("year")
    const m = first.start.get("month")
    const d = first.start.get("day")
    const h = first.start.get("hour")
    const min = first.start.get("minute") ?? 0
    let scheduled: Date
    if (
      typeof y === "number" &&
      typeof m === "number" &&
      typeof d === "number" &&
      typeof h === "number"
    ) {
      scheduled = zonedWallTimeToUtc(
        { year: y, month: m, day: d, hour: h, minute: min },
        anchor.timeZone,
      )
    } else {
      scheduled = startDate
    }

    let endAt: string | null = null
    if (first.end) {
      const ey = first.end.get("year") ?? y
      const em = first.end.get("month") ?? m
      const ed = first.end.get("day") ?? d
      const eh = first.end.get("hour")
      const emin = first.end.get("minute") ?? 0
      if (
        typeof ey === "number" &&
        typeof em === "number" &&
        typeof ed === "number" &&
        typeof eh === "number"
      ) {
        endAt = zonedWallTimeToUtc(
          { year: ey, month: em, day: ed, hour: eh, minute: emin },
          anchor.timeZone,
        ).toISOString()
      }
    }

    const certain = first.start.isCertain("hour") &&
      (first.start.isCertain("day") || first.start.isCertain("weekday") ||
        /\b(today|tomorrow)\b/i.test(text))
    const confidence: AvailabilityConfidence =
      certain && hasExplicitClock(text)
        ? "high"
        : certain
        ? "medium"
        : "low"

    if (confidence === "low" && looksVague(text)) return null

    // Prefer named-weekday calendar date over chrono when they disagree
    // (chrono can still land on "today" for abbreviations in edge cases).
    const namedIdx = extractNamedWeekdayIndex(text)
    let scheduledAt = scheduled.toISOString()
    if (namedIdx != null && !/\b(today|tomorrow)\b/i.test(text)) {
      const dateParts = resolveNamedWeekdayDate(namedIdx, anchor)
      const startZ = zonedParts(scheduled, anchor.timeZone)
      const rebuilt = zonedWallTimeToUtc(
        {
          year: dateParts.year,
          month: dateParts.month,
          day: dateParts.day,
          hour: startZ.hour,
          minute: startZ.minute,
        },
        anchor.timeZone,
      )
      scheduledAt = rebuilt.toISOString()
      if (endAt) {
        const endZ = zonedParts(new Date(endAt), anchor.timeZone)
        endAt = zonedWallTimeToUtc(
          {
            year: dateParts.year,
            month: dateParts.month,
            day: dateParts.day,
            hour: endZ.hour,
            minute: endZ.minute,
          },
          anchor.timeZone,
        ).toISOString()
      }
    }

    const entity = toArrivalEntity(scheduledAt, endAt, anchor.timeZone)
    return {
      scheduledAt,
      endAt: entity.type === "WINDOW" ? endAt : null,
      windowLabel: entity.display_text,
      confidence,
      source: "chrono",
      entity,
    }
  } catch (e) {
    console.error("[vendor-availability] chrono parse", e)
    return null
  }
}

type LlmAvailabilityArgs = {
  understood?: boolean
  start_local?: string
  end_local?: string | null
  display_label?: string
  confidence?: number
  needs_clarification?: boolean
  clarification_question?: string
}

function parseToolArgs(raw: unknown): LlmAvailabilityArgs {
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as LlmAvailabilityArgs
    } catch {
      return {}
    }
  }
  if (raw && typeof raw === "object") return raw as LlmAvailabilityArgs
  return {}
}

/** Parse "YYYY-MM-DDTHH:mm" or "YYYY-MM-DD HH:mm" as wall time in anchor TZ. */
function localStampToUtcIso(
  stamp: string,
  anchor: ScheduleAnchor,
): string | null {
  const m = stamp.trim().match(
    /^(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2})(?::(\d{2}))?/,
  )
  if (!m) return null
  const dt = zonedWallTimeToUtc(
    {
      year: Number(m[1]),
      month: Number(m[2]),
      day: Number(m[3]),
      hour: Number(m[4]),
      minute: Number(m[5]),
    },
    anchor.timeZone,
  )
  if (Number.isNaN(dt.getTime())) return null
  return dt.toISOString()
}

export async function extractAvailabilityWithLlm(
  raw: string,
  anchor: ScheduleAnchor,
  apiKey = Deno.env.get("OPENAI_API_KEY")?.trim() ?? "",
  conversationContext?: string,
): Promise<ResolvedAvailability | { clarification: string } | null> {
  if (!apiKey || !normalizeVendorText(raw)) return null

  const thread =
    (conversationContext ?? "").trim()
      ? `\nRecent scheduling thread (oldest → newest):\n${conversationContext!.trim().slice(0, 1200)}\n`
      : ""

  const system =
    `You extract a vendor's earliest job availability from a short SMS.\n` +
    `Anchor context (authoritative):\n` +
    `- Today is ${anchor.todayLabel}\n` +
    `- Current local time is ${anchor.nowTimeLabel}\n` +
    `- Timezone is ${anchor.timeZone}\n` +
    `- Reference instant (UTC): ${anchor.nowIso}\n` +
    thread +
    `Rules:\n` +
    `- Interpret relative phrases (today, tomorrow, Monday) from the anchor date.\n` +
    `- Use the thread for pronoun/ellipsis resolution (e.g. "yes", "that works", "same").\n` +
    `- For ranges like "9-12pm", use the start as start_local and the end as end_local.\n` +
    `- start_local / end_local must be wall-clock in ${anchor.timeZone} as YYYY-MM-DDTHH:mm (no timezone suffix).\n` +
    `- If unsure, set needs_clarification=true and ask a short SMS-friendly question.\n` +
    `- Always call the save_vendor_availability tool.`

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: PARSE_MODEL,
        temperature: 0,
        messages: [
          { role: "system", content: system },
          { role: "user", content: normalizeVendorText(raw).slice(0, 500) },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "save_vendor_availability",
              description:
                "Structured availability extracted from the vendor SMS.",
              parameters: {
                type: "object",
                properties: {
                  understood: {
                    type: "boolean",
                    description: "True when a concrete start time is known.",
                  },
                  start_local: {
                    type: "string",
                    description: "Wall-clock start YYYY-MM-DDTHH:mm in anchor TZ",
                  },
                  end_local: {
                    type: ["string", "null"],
                    description: "Optional wall-clock end YYYY-MM-DDTHH:mm",
                  },
                  display_label: {
                    type: "string",
                    description: "Short human label for confirmations",
                  },
                  confidence: {
                    type: "number",
                    description: "0-1 confidence",
                  },
                  needs_clarification: { type: "boolean" },
                  clarification_question: {
                    type: "string",
                    description: "SMS-friendly clarification if needed",
                  },
                },
                required: ["understood", "needs_clarification"],
              },
            },
          },
        ],
        tool_choice: {
          type: "function",
          function: { name: "save_vendor_availability" },
        },
      }),
    })
    if (!res.ok) {
      console.error("[vendor-availability] llm http", res.status)
      return null
    }
    const data = (await res.json()) as {
      choices?: Array<{
        message?: {
          tool_calls?: Array<{
            function?: { name?: string; arguments?: string }
          }>
        }
      }>
    }
    const call = data.choices?.[0]?.message?.tool_calls?.[0]
    if (!call?.function?.arguments) return null
    const args = parseToolArgs(call.function.arguments)

    if (args.needs_clarification || args.understood === false) {
      const q = (args.clarification_question ?? "").trim()
      return {
        clarification: q ||
          "Thanks — what day and time works best? For example: Tomorrow 9am.",
      }
    }

    const startIso = typeof args.start_local === "string"
      ? localStampToUtcIso(args.start_local, anchor)
      : null
    if (!startIso) {
      return {
        clarification:
          "Thanks — what day and time works best? For example: Tomorrow 9am.",
      }
    }
    const endIso = typeof args.end_local === "string" && args.end_local.trim()
      ? localStampToUtcIso(args.end_local, anchor)
      : null
    const confNum = Number(args.confidence)
    const confidence: AvailabilityConfidence = Number.isFinite(confNum)
      ? confNum >= 0.85
        ? "high"
        : confNum >= 0.55
        ? "medium"
        : "low"
      : "medium"

    const entity = toArrivalEntity(startIso, endIso, anchor.timeZone)
    return {
      scheduledAt: startIso,
      endAt: entity.type === "WINDOW" ? endIso : null,
      windowLabel: entity.display_text,
      confidence,
      source: "llm",
      entity,
    }
  } catch (e) {
    console.error("[vendor-availability] llm extract", e)
    return null
  }
}

export function buildSoftConfirmationPrompt(
  value: ResolvedAvailability,
  timeZone = DEFAULT_TZ,
): string {
  const when = (value.entity?.display_text ?? value.windowLabel).trim() ||
    toArrivalEntity(value.scheduledAt, value.endAt, timeZone).display_text ||
    "that arrival window"
  return `Got it — ${when}. Reply YES to send that to the tenant, or send a different window.`
}

export function buildSoftClarificationPrompt(custom?: string): string {
  const q = (custom ?? "").trim()
  if (q) return q
  return (
    "Please reply with a specific date and arrival window " +
    "(e.g. Tomorrow between 9am–12pm), or an exact time (e.g. Tomorrow at 10am)."
  )
}

function standardizeWindowLabel(
  value: ResolvedAvailability,
  timeZone: string,
): ResolvedAvailability {
  const entity = toArrivalEntity(value.scheduledAt, value.endAt, timeZone)
  return {
    ...value,
    endAt: entity.type === "WINDOW" ? value.endAt : null,
    windowLabel: entity.display_text,
    entity,
  }
}

/**
 * Merge regex clock range with chrono/weekday calendar date so abbreviations
 * like "Wed 9-12pm" keep both the WINDOW bounds and the correct day.
 */
function mergeRangeWithBestDate(
  regexHit: ResolvedAvailability | null,
  chronoHit: ResolvedAvailability | null,
  text: string,
  anchor: ScheduleAnchor,
): ResolvedAvailability | null {
  if (!regexHit && !chronoHit) return null
  if (!regexHit) return chronoHit
  if (!chronoHit) return regexHit

  const namedIdx = extractNamedWeekdayIndex(text)
  // Prefer regex times (more reliable for "9-12pm") + chrono/weekday date.
  let scheduledAt = regexHit.scheduledAt
  let endAt = regexHit.endAt
  if (namedIdx != null && !/\b(today|tomorrow)\b/i.test(text)) {
    const dateParts = resolveNamedWeekdayDate(namedIdx, anchor)
    const startZ = zonedParts(new Date(regexHit.scheduledAt), anchor.timeZone)
    scheduledAt = zonedWallTimeToUtc(
      {
        year: dateParts.year,
        month: dateParts.month,
        day: dateParts.day,
        hour: startZ.hour,
        minute: startZ.minute,
      },
      anchor.timeZone,
    ).toISOString()
    if (endAt) {
      const endZ = zonedParts(new Date(endAt), anchor.timeZone)
      endAt = zonedWallTimeToUtc(
        {
          year: dateParts.year,
          month: dateParts.month,
          day: dateParts.day,
          hour: endZ.hour,
          minute: endZ.minute,
        },
        anchor.timeZone,
      ).toISOString()
    }
  } else if (chronoHit.scheduledAt) {
    // No explicit weekday — keep regex times on chrono's date when available.
    const chronoDay = zonedParts(new Date(chronoHit.scheduledAt), anchor.timeZone)
    const startZ = zonedParts(new Date(regexHit.scheduledAt), anchor.timeZone)
    scheduledAt = zonedWallTimeToUtc(
      {
        year: chronoDay.year,
        month: chronoDay.month,
        day: chronoDay.day,
        hour: startZ.hour,
        minute: startZ.minute,
      },
      anchor.timeZone,
    ).toISOString()
    if (endAt) {
      const endZ = zonedParts(new Date(endAt), anchor.timeZone)
      endAt = zonedWallTimeToUtc(
        {
          year: chronoDay.year,
          month: chronoDay.month,
          day: chronoDay.day,
          hour: endZ.hour,
          minute: endZ.minute,
        },
        anchor.timeZone,
      ).toISOString()
    }
  }

  const entity = toArrivalEntity(scheduledAt, endAt, anchor.timeZone)
  const confidence =
    regexHit.confidence === "high" || chronoHit.confidence === "high"
      ? "high"
      : regexHit.confidence
  return {
    scheduledAt,
    endAt: entity.type === "WINDOW" ? endAt : null,
    windowLabel: entity.display_text,
    confidence,
    source: "regex",
    entity,
  }
}

/**
 * Resolve vendor free-text availability:
 * chrono → regex → LLM function call, then classify exact / bounded / oversized / unbounded.
 */
export async function resolveVendorAvailability(
  raw: string,
  options?: {
    now?: Date
    timeZone?: string
    apiKey?: string | null
    /** Skip network LLM (tests). */
    allowLlm?: boolean
    /** Rolling SMS thread for LLM context integrity. */
    conversationContext?: string
    /** Prior clarify prompts on this schedule thread (anti-loop). */
    clarifyAttempts?: number
  },
): Promise<AvailabilityResolveResult> {
  const timeZone = options?.timeZone ?? scheduleTimeZone()
  const anchor = buildScheduleAnchor(options?.now ?? new Date(), timeZone)
  const text = normalizeVendorText(raw)
  const clarifyAttempts = options?.clarifyAttempts ?? 0
  if (!text) {
    return {
      status: "needs_clarification",
      softPrompt: buildSoftClarificationPrompt(),
    }
  }

  // Ranges: merge regex times with chrono/weekday date (never drop WINDOW end).
  const range = hasClockRange(text)
  let resolved: ResolvedAvailability | null = null
  if (range) {
    resolved = mergeRangeWithBestDate(
      parseAvailabilityRegex(text, anchor),
      parseAvailabilityChrono(text, anchor),
      text,
      anchor,
    )
  } else {
    resolved = parseAvailabilityChrono(text, anchor) ??
      parseAvailabilityRegex(text, anchor)
  }

  if (!resolved && options?.allowLlm !== false) {
    const llm = await extractAvailabilityWithLlm(
      text,
      anchor,
      options?.apiKey ?? Deno.env.get("OPENAI_API_KEY")?.trim() ?? "",
      options?.conversationContext,
    )
    if (llm && "clarification" in llm) {
      return {
        status: "needs_clarification",
        softPrompt: buildSoftClarificationPrompt(llm.clarification),
      }
    }
    if (llm) resolved = llm
  }

  if (!resolved) {
    return {
      status: "needs_clarification",
      softPrompt: buildSoftClarificationPrompt(),
    }
  }

  resolved = standardizeWindowLabel(resolved, timeZone)
  const kind = classifyArrivalWindow(resolved, text)

  // Unbounded / vague — re-prompt (after 2 attempts, soft-anchor any usable start).
  if (kind === "unbounded") {
    if (clarifyAttempts >= 1 && resolved.scheduledAt) {
      const anchored = softAnchorArrivalWindow(resolved, timeZone)
      return {
        status: "needs_confirmation",
        value: anchored,
        softPrompt: buildOversizedWindowPrompt(anchored),
      }
    }
    return {
      status: "needs_clarification",
      softPrompt: buildSoftClarificationPrompt(),
    }
  }

  // Oversized range — propose a tighter arrival window for 1-tap YES.
  if (kind === "oversized") {
    const anchored = softAnchorArrivalWindow(resolved, timeZone)
    return {
      status: "needs_confirmation",
      value: anchored,
      softPrompt: buildOversizedWindowPrompt(anchored),
    }
  }

  // Bounded window or exact slot.
  if (resolved.confidence === "high" && (kind === "bounded" || kind === "exact")) {
    return { status: "resolved", value: resolved }
  }

  if (resolved.confidence === "low" || resolved.confidence === "medium") {
    return {
      status: "needs_confirmation",
      value: resolved,
      softPrompt: buildSoftConfirmationPrompt(resolved, timeZone),
    }
  }

  return { status: "resolved", value: resolved }
}

/**
 * Full re-parse for correction / persist fallback — preserves WINDOW endAt.
 * Prefer carrying pendingScheduledAt/pendingEndAt instead of re-parsing.
 */
export function parseAvailabilityResolved(
  raw: string,
  now = new Date(),
  timeZone = scheduleTimeZone(),
): ResolvedAvailability | null {
  const anchor = buildScheduleAnchor(now, timeZone)
  const text = normalizeVendorText(raw)
  if (!text) return null
  const hit = hasClockRange(text)
    ? mergeRangeWithBestDate(
      parseAvailabilityRegex(text, anchor),
      parseAvailabilityChrono(text, anchor),
      text,
      anchor,
    )
    : (parseAvailabilityChrono(text, anchor) ??
      parseAvailabilityRegex(text, anchor))
  return hit ? standardizeWindowLabel(hit, timeZone) : null
}

/** Backward-compatible helper: ISO start or null. */
export function parseAvailabilityToScheduledAt(
  raw: string,
  now = new Date(),
  timeZone = scheduleTimeZone(),
): string | null {
  return parseAvailabilityResolved(raw, now, timeZone)?.scheduledAt ?? null
}

