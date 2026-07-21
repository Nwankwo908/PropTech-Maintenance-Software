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

export type ResolvedAvailability = {
  scheduledAt: string
  endAt: string | null
  /** Human label for SMS / admin (prefer vendor wording when clear). */
  windowLabel: string
  confidence: AvailabilityConfidence
  source: "chrono" | "regex" | "llm"
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
    // Weekday names: next occurrence (including today if still ahead)
    const weekdays = [
      "sunday",
      "monday",
      "tuesday",
      "wednesday",
      "thursday",
      "friday",
      "saturday",
    ]
    const wd = weekdays.find((d) => new RegExp(`\\b${d}\\b`).test(text))
    if (wd) {
      for (let add = 0; add <= 7; add++) {
        const probe = new Date(
          zonedWallTimeToUtc(
            { year: zNow.year, month: zNow.month, day: zNow.day, hour: 12, minute: 0 },
            anchor.timeZone,
          ).getTime() + add * 24 * 60 * 60 * 1000,
        )
        const zp = zonedParts(probe, anchor.timeZone)
        const name = zp.weekday.toLowerCase()
        if (name === wd) {
          year = zp.year
          month = zp.month
          day = zp.day
          const candidate = zonedWallTimeToUtc(
            { year, month, day, hour: hours, minute: minutes },
            anchor.timeZone,
          )
          if (candidate.getTime() >= anchor.now.getTime() - 60_000 || add > 0) {
            break
          }
        }
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

  const vendorLabel = normalizeVendorText(raw)
  return {
    scheduledAt: start.toISOString(),
    endAt,
    windowLabel: vendorLabel || formatWindowLabel(start, anchor.timeZone),
    confidence: hasExplicitClock(text) ? "high" : "medium",
    source: "regex",
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

    return {
      scheduledAt: scheduled.toISOString(),
      endAt,
      windowLabel: text,
      confidence,
      source: "chrono",
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

    return {
      scheduledAt: startIso,
      endAt: endIso,
      windowLabel: (args.display_label ?? normalizeVendorText(raw)).trim() ||
        normalizeVendorText(raw),
      confidence,
      source: "llm",
    }
  } catch (e) {
    console.error("[vendor-availability] llm extract", e)
    return null
  }
}

export function buildSoftConfirmationPrompt(value: ResolvedAvailability): string {
  const when = value.windowLabel.trim() || "that time"
  return `Got it — ${when}. Reply YES to confirm, or send a different time.`
}

export function buildSoftClarificationPrompt(custom?: string): string {
  const q = (custom ?? "").trim()
  if (q) return q
  return "Thanks — what day and time works best? For example: Tomorrow 9am."
}

/**
 * Resolve vendor free-text availability:
 * chrono → regex → LLM function call, then soft confirm / clarify.
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
  },
): Promise<AvailabilityResolveResult> {
  const anchor = buildScheduleAnchor(
    options?.now ?? new Date(),
    options?.timeZone ?? scheduleTimeZone(),
  )
  const text = normalizeVendorText(raw)
  if (!text) {
    return {
      status: "needs_clarification",
      softPrompt: buildSoftClarificationPrompt(),
    }
  }

  // Ranges like "9-12pm" are more reliable via regex (chrono often treats 9 as pm).
  const hasRange = /\d\s*[-–—to]+\s*\d/i.test(text)
  let resolved = hasRange
    ? (parseAvailabilityRegex(text, anchor) ??
      parseAvailabilityChrono(text, anchor))
    : (parseAvailabilityChrono(text, anchor) ??
      parseAvailabilityRegex(text, anchor))

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

  if (resolved.confidence === "low" || looksVague(text)) {
    return {
      status: "needs_confirmation",
      value: resolved,
      softPrompt: buildSoftConfirmationPrompt(resolved),
    }
  }

  if (resolved.confidence === "medium") {
    return {
      status: "needs_confirmation",
      value: resolved,
      softPrompt: buildSoftConfirmationPrompt(resolved),
    }
  }

  return { status: "resolved", value: resolved }
}

/** Backward-compatible helper: ISO start or null. */
export function parseAvailabilityToScheduledAt(
  raw: string,
  now = new Date(),
  timeZone = scheduleTimeZone(),
): string | null {
  const anchor = buildScheduleAnchor(now, timeZone)
  const hasRange = /\d\s*[-–—to]+\s*\d/i.test(raw)
  const hit = hasRange
    ? (parseAvailabilityRegex(raw, anchor) ??
      parseAvailabilityChrono(raw, anchor))
    : (parseAvailabilityChrono(raw, anchor) ??
      parseAvailabilityRegex(raw, anchor))
  return hit?.scheduledAt ?? null
}
