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
const PARSE_MODEL = "gpt-4o"

/** True when `timeZone` is a usable IANA name for Intl. */
export function isValidIanaTimeZone(timeZone: string): boolean {
  const trimmed = timeZone.trim()
  if (!trimmed) return false
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: trimmed }).format(new Date(0))
    return true
  } catch {
    return false
  }
}

/**
 * Resolve the requester schedule zone: configured IANA → env → documented default.
 * Never substitutes the process/server timezone for an invalid setting.
 */
export function resolveScheduleTimeZone(
  configured?: string | null,
): string {
  const fromConfig = configured?.trim()
  if (fromConfig && isValidIanaTimeZone(fromConfig)) return fromConfig
  const fromEnv = Deno.env.get("VENDOR_SCHEDULE_TZ")?.trim()
  if (fromEnv && isValidIanaTimeZone(fromEnv)) return fromEnv
  return DEFAULT_TZ
}

export function scheduleTimeZone(): string {
  return resolveScheduleTimeZone(null)
}

/**
 * Chrono-compatible UTC offset in minutes at `instant` for an IANA zone.
 * Chrono convention: local = UTC + offsetMinutes (EDT = -240, NPT = +345).
 * Uses Intl wall-clock parts — not `Date#getTimezoneOffset()` / process TZ.
 */
export function chronoUtcOffsetMinutesAt(
  instant: Date,
  timeZone: string,
): number | null {
  if (!isValidIanaTimeZone(timeZone) || Number.isNaN(instant.getTime())) {
    return null
  }
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant)
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value)
  let hour = get("hour")
  if (hour === 24) hour = 0
  const asUtcMs = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    hour,
    get("minute"),
    get("second"),
  )
  return Math.round((asUtcMs - instant.getTime()) / 60_000)
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
  const zone = isValidIanaTimeZone(timeZone) ? timeZone.trim() : DEFAULT_TZ
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
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

function wallPartsMatch(
  actual: ReturnType<typeof zonedParts>,
  want: {
    year: number
    month: number
    day: number
    hour: number
    minute: number
  },
): boolean {
  return (
    actual.year === want.year &&
    actual.month === want.month &&
    actual.day === want.day &&
    actual.hour === want.hour &&
    actual.minute === want.minute
  )
}

/**
 * Convert IANA wall-clock components to a UTC Date at the **target** calendar
 * date (DST-aware). Policy:
 * - Invalid IANA → NaN Date
 * - Nonexistent spring-forward wall → NaN Date (caller clarifies)
 * - Ambiguous fall-back wall → earlier UTC instant (still in DST)
 */
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
  if (!isValidIanaTimeZone(timeZone)) return new Date(NaN)

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

  // Collect matching candidates near the guess (±3h covers US DST folds).
  const candidates: number[] = []
  for (const deltaHours of [-3, -2, -1, 0, 1, 2, 3]) {
    const probe = utcMs + deltaHours * 60 * 60 * 1000
    const refined = asUtcGuess - offsetFor(probe)
    if (wallPartsMatch(zonedParts(new Date(refined), timeZone), parts)) {
      candidates.push(refined)
    }
  }
  const unique = [...new Set(candidates)].sort((a, b) => a - b)
  if (unique.length === 0) {
    // Nonexistent wall time (e.g. 2:30 AM on spring-forward day).
    return new Date(NaN)
  }
  // Ambiguous: prefer the earlier UTC instant.
  return new Date(unique[0]!)
}

/** Fixed-offset wall → UTC using Chrono's minute-east-of-UTC convention. */
export function wallTimeWithChronoOffsetToUtc(
  parts: {
    year: number
    month: number
    day: number
    hour: number
    minute: number
  },
  chronoOffsetMinutes: number,
): Date {
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    0,
  )
  return new Date(asUtc - chronoOffsetMinutes * 60_000)
}

export function buildScheduleAnchor(
  now = new Date(),
  timeZone = scheduleTimeZone(),
): ScheduleAnchor {
  const zone = resolveScheduleTimeZone(timeZone)
  const z = zonedParts(now, zone)
  const hour12 = ((z.hour + 11) % 12) + 1
  const ampm = z.hour >= 12 ? "PM" : "AM"
  return {
    now,
    timeZone: zone,
    todayLabel: `${z.weekday}, ${z.monthName} ${z.dayNum}, ${z.year}`,
    nowTimeLabel: `${hour12}:${pad2(z.minute)} ${ampm}`,
    nowIso: now.toISOString(),
  }
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
    hasClockRange(text)
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

/** en-US time formatting. ICU in Deno 2.1 inserts U+202F before AM/PM; SMS copy uses a normal space. */
function formatEnUs(date: Date, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat("en-US", options)
    .format(date)
    .replace(/[\u202f\u00a0]/g, " ")
}

export function formatArrivalWindowLabel(
  startIso: string,
  endIso: string | null,
  timeZone: string,
): string {
  const start = new Date(startIso)
  if (Number.isNaN(start.getTime())) return "that time"
  const day = formatEnUs(start, {
    timeZone,
    weekday: "long",
    month: "short",
    day: "numeric",
  })
  const startTime = formatEnUs(start, {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  })
  if (!endIso) return `${day} at ${startTime}`
  const end = new Date(endIso)
  if (Number.isNaN(end.getTime())) return `${day} at ${startTime}`
  const duration = end.getTime() - start.getTime()
  if (duration <= 15 * 60 * 1000) return `${day} at ${startTime}`
  const endTime = formatEnUs(end, {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  })
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

const CLOCK_RANGE_SEPARATOR = String.raw`(?:[-–—]|to|and)`

/** True when text looks like a start–end clock range (incl. "9am-12pm" and "between 2pm and 4pm"). */
export function hasClockRange(text: string): boolean {
  return new RegExp(
    String.raw`\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)?\s*${CLOCK_RANGE_SEPARATOR}\s*\d{1,2}(?::\d{2})?(?!\d)`,
    "i",
  ).test(text)
}

/** A daypart with no start and end. "Thursday afternoon" is not a 2–4 window. */
export function isDaypartWithoutClock(text: string): boolean {
  return /\b(morning|afternoon|evening)\b/i.test(text) && !hasClockRange(text) &&
    !/\b\d{1,2}(?::\d{2})?\s*(a\.?m\.?|p\.?m\.?)\b/i.test(text)
}

/** A numeric range with no AM/PM and no morning/afternoon/evening. */
export function clockRangeLacksMeridiem(text: string): boolean {
  if (!hasClockRange(text)) return false
  if (/(?:a\.?m\.?|p\.?m\.?)/i.test(text)) return false
  if (/\b(morning|afternoon|evening)\b/i.test(text)) return false
  return true
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
    new RegExp(
      String.raw`\b(?:between|from)?\s*(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?\s*${CLOCK_RANGE_SEPARATOR}\s*(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?`,
      "i",
    ),
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
    const daypart = /\bafternoon\b|\bevening\b/.test(text)
      ? "pm"
      : /\bmorning\b/.test(text)
      ? "am"
      : ""
    let meridiem = startMer
    if (!meridiem) {
      if (endMer.startsWith("p") && (endHours === 12 || hours > endHours)) {
        meridiem = "am"
      } else {
        meridiem = endMer || daypart
      }
    }
    if (!meridiem || !endMer && !daypart && !startMer) {
      return null
    }
    if (meridiem.startsWith("p") && hours < 12) hours += 12
    if (meridiem.startsWith("a") && hours === 12) hours = 0
    const endMeridiem = endMer || meridiem
    if (endMeridiem.startsWith("p") && endHours < 12) endHours += 12
    if (endMeridiem.startsWith("a") && endHours === 12) endHours = 0
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

  const absoluteMonth = text.match(
    /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s*(\d{4}))?\b/i,
  )

  if (/\btomorrow\b/.test(text)) {
    const next = addCalendarDays(zNow.year, zNow.month, zNow.day, 1)
    year = next.year
    month = next.month
    day = next.day
  } else if (/\b(today|tonight)\b/.test(text)) {
    year = zNow.year
    month = zNow.month
    day = zNow.day
  } else if (absoluteMonth) {
    const monthNum = monthNameToNumber(absoluteMonth[1]!)
    year = absoluteMonth[3] ? Number(absoluteMonth[3]) : zNow.year
    month = monthNum
    day = Number(absoluteMonth[2])
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
        !Number.isNaN(candidate.getTime()) &&
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

/** Add whole calendar days in a Y-M-D space (UTC noon stepping — DST-safe). */
export function addCalendarDays(
  year: number,
  month: number,
  day: number,
  deltaDays: number,
): { year: number; month: number; day: number } {
  const noon = new Date(Date.UTC(year, month - 1, day + deltaDays, 12, 0, 0))
  return {
    year: noon.getUTCFullYear(),
    month: noon.getUTCMonth() + 1,
    day: noon.getUTCDate(),
  }
}

/**
 * Chrono 2.7.8 computes today/tomorrow from the process-local calendar of
 * `instant`, ignoring ParsingReference.timezone for relative days. Re-anchor
 * those phrases to the requester IANA calendar.
 */
export function applyRequesterRelativeCalendarDay(
  text: string,
  parts: { year: number; month: number; day: number },
  anchor: ScheduleAnchor,
): { year: number; month: number; day: number } {
  const z = zonedParts(anchor.now, anchor.timeZone)
  if (/\btomorrow\b/i.test(text)) {
    return addCalendarDays(z.year, z.month, z.day, 1)
  }
  if (/\b(today|tonight)\b/i.test(text)) {
    return { year: z.year, month: z.month, day: z.day }
  }
  return parts
}

/**
 * Precedence for wall→UTC after Chrono resolves calendar components against the
 * requester reference:
 * 1) Certain timezoneOffset on the Chrono result (explicit abbr/offset in SMS)
 * 2) Requester IANA zone at the **target** appointment wall time
 * Never pass IANA names into Chrono's `timezone` field (2.7.8 only accepts
 * minute offsets or abbr map keys).
 */
function wallComponentsToUtc(
  parts: {
    year: number
    month: number
    day: number
    hour: number
    minute: number
  },
  anchor: ScheduleAnchor,
  explicitChronoOffsetMinutes: number | null,
): Date {
  if (typeof explicitChronoOffsetMinutes === "number") {
    return wallTimeWithChronoOffsetToUtc(parts, explicitChronoOffsetMinutes)
  }
  return zonedWallTimeToUtc(parts, anchor.timeZone)
}

export function parseAvailabilityChrono(
  raw: string,
  anchor: ScheduleAnchor,
): ResolvedAvailability | null {
  const text = normalizeVendorText(raw)
  if (!text) return null

  try {
    const refOffset = chronoUtcOffsetMinutesAt(anchor.now, anchor.timeZone)
    if (refOffset == null) return null

    const results = chrono.parse(text, {
      instant: anchor.now,
      timezone: refOffset,
    }, { forwardDate: true })
    const first = results[0]
    if (!first?.start) return null

    const startDate = first.start.date()
    if (Number.isNaN(startDate.getTime())) return null

    const explicitStartOffset = first.start.isCertain("timezoneOffset")
      ? first.start.get("timezoneOffset")
      : null
    const explicitEndOffset = first.end?.isCertain("timezoneOffset")
      ? first.end.get("timezoneOffset")
      : null

    // Prefer component rebuild in requester IANA (or explicit message offset).
    let y = first.start.get("year")
    let m = first.start.get("month")
    let d = first.start.get("day")
    const h = first.start.get("hour")
    const min = first.start.get("minute") ?? 0
    let scheduled: Date
    if (
      typeof y === "number" &&
      typeof m === "number" &&
      typeof d === "number" &&
      typeof h === "number"
    ) {
      const cal = applyRequesterRelativeCalendarDay(
        text,
        { year: y, month: m, day: d },
        anchor,
      )
      y = cal.year
      m = cal.month
      d = cal.day
      scheduled = wallComponentsToUtc(
        { year: y, month: m, day: d, hour: h, minute: min },
        anchor,
        typeof explicitStartOffset === "number" ? explicitStartOffset : null,
      )
    } else {
      scheduled = startDate
    }
    if (Number.isNaN(scheduled.getTime())) return null

    let endAt: string | null = null
    if (first.end) {
      let ey = first.end.get("year") ?? y
      let em = first.end.get("month") ?? m
      let ed = first.end.get("day") ?? d
      const eh = first.end.get("hour")
      const emin = first.end.get("minute") ?? 0
      if (
        typeof ey === "number" &&
        typeof em === "number" &&
        typeof ed === "number" &&
        typeof eh === "number"
      ) {
        const endCal = applyRequesterRelativeCalendarDay(
          text,
          { year: ey, month: em, day: ed },
          anchor,
        )
        ey = endCal.year
        em = endCal.month
        ed = endCal.day
        const endDate = wallComponentsToUtc(
          { year: ey, month: em, day: ed, hour: eh, minute: emin },
          anchor,
          typeof explicitEndOffset === "number"
            ? explicitEndOffset
            : typeof explicitStartOffset === "number"
            ? explicitStartOffset
            : null,
        )
        if (!Number.isNaN(endDate.getTime())) endAt = endDate.toISOString()
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

export function buildDaypartClarificationPrompt(): string {
  return "What start and end time works? Reply with a day and a window, like Thu 2–4pm."
}

export function buildMeridiemClarificationPrompt(): string {
  return "Do you mean morning or afternoon? Reply with AM or PM, like Thu 2–4pm."
}

export function buildMissingDayClarificationPrompt(): string {
  return "Which day should that window be? Reply with the day and time, like Thu 2–4pm."
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
function calendarPartsFromText(
  text: string,
  anchor: ScheduleAnchor,
): { year: number; month: number; day: number } | null {
  const lower = text.toLowerCase()
  const zNow = zonedParts(anchor.now, anchor.timeZone)
  if (/\btomorrow\b/.test(lower)) {
    return addCalendarDays(zNow.year, zNow.month, zNow.day, 1)
  }
  if (/\b(today|tonight)\b/.test(lower)) {
    return { year: zNow.year, month: zNow.month, day: zNow.day }
  }
  const absoluteMonth = lower.match(
    /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s*(\d{4}))?\b/i,
  )
  if (absoluteMonth) {
    return {
      year: absoluteMonth[3] ? Number(absoluteMonth[3]) : zNow.year,
      month: monthNameToNumber(absoluteMonth[1]!),
      day: Number(absoluteMonth[2]),
    }
  }
  const namedIdx = extractNamedWeekdayIndex(text)
  if (namedIdx == null) return null
  return resolveNamedWeekdayDate(namedIdx, anchor)
}

function lastContextCalendarParts(
  context: string,
  anchor: ScheduleAnchor,
): { year: number; month: number; day: number } | null {
  const lines = context.split(/\n/).map((line) => line.trim()).filter(Boolean)
  for (let i = lines.length - 1; i >= 0; i--) {
    const parts = calendarPartsFromText(lines[i]!, anchor)
    if (parts) return parts
  }
  return null
}

function restampArrivalDate(
  value: ResolvedAvailability,
  parts: { year: number; month: number; day: number },
  timeZone: string,
): ResolvedAvailability {
  const startZ = zonedParts(new Date(value.scheduledAt), timeZone)
  const scheduledAt = zonedWallTimeToUtc(
    {
      year: parts.year,
      month: parts.month,
      day: parts.day,
      hour: startZ.hour,
      minute: startZ.minute,
    },
    timeZone,
  ).toISOString()
  let endAt = value.endAt
  if (endAt) {
    const endZ = zonedParts(new Date(endAt), timeZone)
    endAt = zonedWallTimeToUtc(
      {
        year: parts.year,
        month: parts.month,
        day: parts.day,
        hour: endZ.hour,
        minute: endZ.minute,
      },
      timeZone,
    ).toISOString()
  }
  const entity = toArrivalEntity(scheduledAt, endAt, timeZone)
  return {
    ...value,
    scheduledAt,
    endAt: entity.type === "WINDOW" ? endAt : null,
    windowLabel: entity.display_text,
    entity,
  }
}

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
  const timeZone = resolveScheduleTimeZone(options?.timeZone)
  const anchor = buildScheduleAnchor(options?.now ?? new Date(), timeZone)
  const text = normalizeVendorText(raw)
  const clarifyAttempts = options?.clarifyAttempts ?? 0
  if (!text) {
    return {
      status: "needs_clarification",
      softPrompt: buildSoftClarificationPrompt(),
    }
  }
  if (isDaypartWithoutClock(text)) {
    return {
      status: "needs_clarification",
      softPrompt: buildDaypartClarificationPrompt(),
    }
  }
  if (clockRangeLacksMeridiem(text)) {
    return {
      status: "needs_clarification",
      softPrompt: buildMeridiemClarificationPrompt(),
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

  if (!calendarPartsFromText(text, anchor)) {
    const hinted = options?.conversationContext
      ? lastContextCalendarParts(options.conversationContext, anchor)
      : null
    if (!hinted) {
      return {
        status: "needs_clarification",
        softPrompt: buildMissingDayClarificationPrompt(),
      }
    }
    resolved = restampArrivalDate(resolved, hinted, timeZone)
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
  const zone = resolveScheduleTimeZone(timeZone)
  const anchor = buildScheduleAnchor(now, zone)
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
  return hit ? standardizeWindowLabel(hit, zone) : null
}

/** Backward-compatible helper: ISO start or null. */
export function parseAvailabilityToScheduledAt(
  raw: string,
  now = new Date(),
  timeZone = scheduleTimeZone(),
): string | null {
  return parseAvailabilityResolved(raw, now, timeZone)?.scheduledAt ?? null
}

