/**
 * Daily priorities — shared Ask Ulo contract for SMS + chat.
 *
 * Cross-system briefing: emergencies → costly deadlines → landlord approvals →
 * visits scheduled today. Auth filtering is server-side before any model context.
 */

import { resolveScheduleTimeZone } from "../../../vendor_availability_parse.ts"
export { isDailyPrioritiesQuestion } from "./dailyPrioritiesDetect.ts"

export type DailyPriorityActorRole = "landlord" | "tenant"

export type DailyPriorityCategory =
  | "emergency"
  | "deadline"
  | "approval"
  | "visit_today"

export type DailyPriorityOfferedAction =
  | "assign"
  | "approve"
  | "confirm_location"
  | "none"

export type DailyPriorityEntityType =
  | "maintenance_request"
  | "inspection"
  | "estimate"
  | "appointment"

export type DailyPriorityCandidate = {
  /** Stable dedupe key — same underlying job collapses to one list slot. */
  dedupeKey: string
  category: DailyPriorityCategory
  entityType: DailyPriorityEntityType
  entityId: string
  /** Landlord-facing display id when known (e.g. 102 for "102 YES"). */
  displayId?: number | null
  title: string
  propertyLabel: string | null
  unitLabel: string | null
  propertyId?: string | null
  unitId?: string | null
  /** Exact deadline / appointment instant (UTC ISO). */
  instantAt: string | null
  blocker: string | null
  /** Trade evidence for assign gates (pest never offers generalists). */
  issueCategory?: string | null
  addressKnown: boolean
  /** Eligible vendor present for assign (same-state specialist when required). */
  canAssign: boolean
  /** Landlord-only fields — stripped for tenants before model/context. */
  landlordOnly?: boolean
  residentId?: string | null
  urgencyRank?: number
}

export type DailyPriorityListItem = {
  position: number
  category: DailyPriorityCategory
  entityType: DailyPriorityEntityType
  entityId: string
  displayId: number | null
  title: string
  propertyLabel: string | null
  unitLabel: string | null
  propertyId: string | null
  unitId: string | null
  instantAt: string | null
  blocker: string | null
  offeredAction: DailyPriorityOfferedAction
  replyToken: string
  replyInstruction: string | null
  residentId: string | null
}

export type DailyPrioritiesResult = {
  available: boolean
  partialSources: string[]
  items: DailyPriorityListItem[]
  markdown: string
  smsText: string
  emptyReason: "none" | "no_actionable" | "unauthorized" | "identity_unresolved"
}

const CATEGORY_ORDER: Record<DailyPriorityCategory, number> = {
  emergency: 0,
  deadline: 1,
  approval: 2,
  visit_today: 3,
}

/** Local calendar day [start, end) in UTC for the requester IANA zone. */
export function localDayBoundsUtc(
  now: Date,
  timeZoneInput: string | null | undefined,
): { start: Date; end: Date; timeZone: string; localDate: string } {
  const timeZone = resolveScheduleTimeZone(timeZoneInput)
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now)
  const y = Number(parts.find((p) => p.type === "year")?.value)
  const m = Number(parts.find((p) => p.type === "month")?.value)
  const d = Number(parts.find((p) => p.type === "day")?.value)
  const localDate = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`

  // Walk UTC candidates near local midnight until wall date matches.
  const guess = Date.UTC(y, m - 1, d, 12, 0, 0)
  let startMs = guess - 36 * 3600_000
  let start: Date | null = null
  for (let i = 0; i < 72; i++) {
    const cand = new Date(startMs + i * 3600_000)
    const candParts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(cand)
    const cy = Number(candParts.find((p) => p.type === "year")?.value)
    const cm = Number(candParts.find((p) => p.type === "month")?.value)
    const cd = Number(candParts.find((p) => p.type === "day")?.value)
    const ch = Number(candParts.find((p) => p.type === "hour")?.value)
    const cmin = Number(candParts.find((p) => p.type === "minute")?.value)
    if (cy === y && cm === m && cd === d && ch === 0 && cmin === 0) {
      start = cand
      break
    }
  }
  if (!start) {
    // Fallback: approximate midnight via noon offset (DST-safe enough for tests).
    start = new Date(Date.UTC(y, m - 1, d, 5, 0, 0))
  }
  const end = new Date(start.getTime() + 24 * 3600_000)
  return { start, end, timeZone, localDate }
}

export function instantIsOnLocalDay(
  instantIso: string | null | undefined,
  now: Date,
  timeZone: string | null | undefined,
): boolean {
  if (!instantIso) return false
  const t = new Date(instantIso)
  if (Number.isNaN(t.getTime())) return false
  const { start, end } = localDayBoundsUtc(now, timeZone)
  return t.getTime() >= start.getTime() && t.getTime() < end.getTime()
}

/**
 * Server-side scope filter — never rely on the model to hide landlord data.
 * Unresolved identity → empty unauthorized set.
 */
export function filterDailyPriorityCandidates(input: {
  role: DailyPriorityActorRole | "unresolved"
  residentId?: string | null
  candidates: DailyPriorityCandidate[]
}): DailyPriorityCandidate[] {
  if (input.role === "unresolved") return []
  if (input.role === "landlord") {
    return [...input.candidates]
  }
  const rid = input.residentId?.trim() || ""
  if (!rid) return []
  return input.candidates.filter((c) => {
    if (c.landlordOnly) return false
    if (c.category === "approval") return false
    return (c.residentId ?? "").trim() === rid
  })
}

function resolveOfferedAction(c: DailyPriorityCandidate): DailyPriorityOfferedAction {
  if (c.category === "emergency" && !c.addressKnown) return "confirm_location"
  if (c.category === "approval") return "approve"
  // canAssign must already be specialist-gated (pest never true for generalists).
  if (
    (c.category === "emergency" || c.category === "deadline") &&
    c.canAssign &&
    c.addressKnown
  ) {
    return "assign"
  }
  return "none"
}

function replyFor(
  position: number,
  action: DailyPriorityOfferedAction,
  displayId: number | null,
): { token: string; instruction: string | null } {
  if (action === "approve" && displayId != null) {
    return {
      token: `${displayId} YES`,
      instruction:
        `Reply ${displayId} YES to select this estimate. It is not approved until you reply APPROVE or DECLINE.`,
    }
  }
  if (action === "assign" || action === "confirm_location") {
    return {
      token: String(position),
      instruction: action === "confirm_location"
        ? `Reply ${position} to select this job. The address still has to be confirmed before a vendor is booked.`
        : `Reply ${position} to select this job. A vendor is not assigned until you confirm on the vendor text.`,
    }
  }
  return { token: String(position), instruction: null }
}

/** What a priority reply did. Selection is not assignment or approval. */
export function dailyPrioritySelectionMessage(
  item: Pick<DailyPriorityListItem, "title" | "displayId" | "offeredAction">,
  alreadySelected = false,
): string {
  const title = item.title.trim() || "that item"
  if (alreadySelected) {
    return `I already selected ${title}. I didn't select it again. Nothing was assigned or approved.`
  }
  if (item.offeredAction === "approve") {
    const ref = item.displayId != null ? ` (request ${item.displayId})` : ""
    return [
      `I selected ${title}${ref}. The estimate is not approved.`,
      "",
      "Reply APPROVE to accept that estimate, or DECLINE if you need a revised one.",
    ].join("\n")
  }
  if (item.offeredAction === "assign") {
    return [
      `I selected ${title}. A vendor is not assigned.`,
      "",
      "When the vendor text for this job arrives, reply with the number next to the vendor you want.",
    ].join("\n")
  }
  if (item.offeredAction === "confirm_location") {
    return `I selected ${title}. I still need the correct address before a vendor can be booked.`
  }
  return `I selected ${title}. There's no confirmation step for this item.`
}

function placeLabel(c: DailyPriorityCandidate): string {
  const prop = (c.propertyLabel ?? "").trim()
  const unit = (c.unitLabel ?? "").trim()
  if (prop && unit) return `${prop} ${unit.startsWith("#") ? unit : `#${unit}`}`
  if (prop) return prop
  if (unit) return unit.startsWith("#") ? unit : `#${unit}`
  return ""
}

export function rankDailyPriorityCandidates(
  candidates: DailyPriorityCandidate[],
  opts?: { maxItems?: number },
): DailyPriorityListItem[] {
  const maxItems = Math.min(5, Math.max(0, opts?.maxItems ?? 5))
  const byKey = new Map<string, DailyPriorityCandidate>()
  for (const c of candidates) {
    const key = c.dedupeKey.trim() || `${c.entityType}:${c.entityId}`
    const prev = byKey.get(key)
    if (!prev || CATEGORY_ORDER[c.category] < CATEGORY_ORDER[prev.category]) {
      byKey.set(key, c)
    } else if (
      prev &&
      CATEGORY_ORDER[c.category] === CATEGORY_ORDER[prev.category] &&
      (c.urgencyRank ?? 99) < (prev.urgencyRank ?? 99)
    ) {
      byKey.set(key, c)
    }
  }

  const sorted = [...byKey.values()].sort((a, b) => {
    const ca = CATEGORY_ORDER[a.category]
    const cb = CATEGORY_ORDER[b.category]
    if (ca !== cb) return ca - cb
    const ua = a.urgencyRank ?? 50
    const ub = b.urgencyRank ?? 50
    if (ua !== ub) return ua - ub
    const ta = a.instantAt ? new Date(a.instantAt).getTime() : Number.POSITIVE_INFINITY
    const tb = b.instantAt ? new Date(b.instantAt).getTime() : Number.POSITIVE_INFINITY
    if (ta !== tb) return ta - tb
    return a.entityId.localeCompare(b.entityId)
  })

  return sorted.slice(0, maxItems).map((c, idx) => {
    const position = idx + 1
    const offeredAction = resolveOfferedAction(c)
    const displayId = c.displayId ?? null
    const { token, instruction } = replyFor(position, offeredAction, displayId)
    return {
      position,
      category: c.category,
      entityType: c.entityType,
      entityId: c.entityId,
      displayId,
      title: c.title.trim() || "Open request",
      propertyLabel: c.propertyLabel,
      unitLabel: c.unitLabel,
      propertyId: c.propertyId ?? null,
      unitId: c.unitId ?? null,
      instantAt: c.instantAt,
      blocker: c.blocker,
      offeredAction,
      replyToken: token,
      replyInstruction: instruction,
      residentId: c.residentId ?? null,
    }
  })
}

export function formatDailyPrioritiesList(
  items: DailyPriorityListItem[],
  opts?: { lead?: string },
): { markdown: string; smsText: string } {
  const lead = opts?.lead ?? "Today's priorities:"
  if (items.length === 0) {
    const empty =
      "Nothing actionable is waiting on you right now across emergencies, deadlines, approvals, or today's visits."
    return { markdown: empty, smsText: empty }
  }
  const lines = items.map((item) => {
    const place = placeLabel({
      dedupeKey: "",
      category: item.category,
      entityType: item.entityType,
      entityId: item.entityId,
      title: item.title,
      propertyLabel: item.propertyLabel,
      unitLabel: item.unitLabel,
      instantAt: item.instantAt,
      blocker: item.blocker,
      addressKnown: true,
      canAssign: false,
    })
    const bits = [item.title]
    if (place) bits.push(place)
    if (item.blocker) bits.push(item.blocker)
    else if (item.category === "visit_today" && item.instantAt) {
      bits.push("Visit scheduled today")
    }
    let line = `${item.position}. ${bits.join(". ")}`
    if (item.replyInstruction) line += `. ${item.replyInstruction}.`
    return line.replace(/\.\s*\./g, ".")
  })
  const body = `${lead}\n${lines.join("\n")}`
  return { markdown: body, smsText: body }
}

export function buildDailyPrioritiesResult(input: {
  role: DailyPriorityActorRole | "unresolved"
  residentId?: string | null
  candidates: DailyPriorityCandidate[]
  partialSources?: string[]
  available?: boolean
}): DailyPrioritiesResult {
  if (input.role === "unresolved") {
    return {
      available: false,
      partialSources: input.partialSources ?? [],
      items: [],
      markdown: "I couldn't verify who is asking, so I can't share account priorities.",
      smsText: "I couldn't verify who is asking, so I can't share account priorities.",
      emptyReason: "identity_unresolved",
    }
  }

  const scoped = filterDailyPriorityCandidates({
    role: input.role,
    residentId: input.residentId,
    candidates: input.candidates,
  })
  const items = rankDailyPriorityCandidates(scoped)
  const formatted = formatDailyPrioritiesList(items)
  const available = input.available !== false
  const partial = input.partialSources ?? []

  let emptyReason: DailyPrioritiesResult["emptyReason"] = "none"
  if (items.length === 0) {
    emptyReason = input.role === "tenant" && !input.residentId?.trim()
      ? "unauthorized"
      : "no_actionable"
  }

  let text = formatted.markdown
  if (!available || partial.length > 0) {
    const note =
      partial.length > 0
        ? `Some sources were temporarily unavailable (${partial.join(", ")}), so this list may be incomplete.`
        : "Some priority sources were temporarily unavailable, so this list may be incomplete."
    text = items.length === 0 ? note : `${formatted.markdown}\n\n${note}`
  }

  return {
    available,
    partialSources: partial,
    items,
    markdown: text,
    smsText: text,
    emptyReason,
  }
}

/** Pure reply → list item binding (does not re-rank). */
export function resolveDailyPriorityReplyToken(
  body: string,
  items: DailyPriorityListItem[],
): { ok: true; item: DailyPriorityListItem } | { ok: false; reason: "no_match" | "ambiguous" } {
  const raw = body.trim()
  if (!raw || items.length === 0) return { ok: false, reason: "no_match" }

  const approve = raw.match(/^(\d+)\s*(YES|APPROVE|OK)\b/i)
  if (approve) {
    const displayId = Number(approve[1])
    const matches = items.filter(
      (i) =>
        i.offeredAction === "approve" &&
        i.displayId === displayId,
    )
    if (matches.length === 1) return { ok: true, item: matches[0]! }
    if (matches.length > 1) return { ok: false, reason: "ambiguous" }
  }

  const bare = raw.match(/^(\d+)\s*[.)]?$/)
  if (bare) {
    const n = Number(bare[1])
    const byPosition = items.filter((i) => i.position === n)
    if (byPosition.length === 1) return { ok: true, item: byPosition[0]! }
    // Bare number is NEVER a global ticket id — only list position / offered token.
    const byToken = items.filter((i) => i.replyToken === String(n))
    if (byToken.length === 1) return { ok: true, item: byToken[0]! }
    if (byPosition.length > 1 || byToken.length > 1) {
      return { ok: false, reason: "ambiguous" }
    }
  }

  return { ok: false, reason: "no_match" }
}
