/**
 * Contextual interpretation of resident inbound SMS.
 *
 * STOP/HELP never enter this module (fast-path in the processor).
 * Heuristics run first; the existing classifyMaintenanceRequest LLM is
 * widened only when the text is still ambiguous — not a second model call.
 */
import { classifyMaintenanceRequest } from "../maintenance_classification/mod.ts"
import type { ClassifyMaintenanceSmsContext } from "../maintenance_classification/types.ts"
import type { LlmClassificationDraft } from "../maintenance_classification/llmClassify.ts"
import { isLeaseRenewalInquirySms } from "./leaseRenewalInquiry.ts"
import {
  classifyTenantComplianceKeyword,
} from "./tenantMessaging.ts"
import {
  extractFirstNoticedFromText,
  inferIssueTypeFromText,
  isAffirmativeReply,
  normalizeRoomOrArea,
  parseContactMethod,
  parseIssueType,
  parseUrgency,
  resolveUrgencyReply,
  type IntakeStep,
  type SmsIntakeState,
} from "./residentIntakeTypes.ts"
import { looksLikeClosedRepairStatusAsk } from "./maintenanceTicketContext.ts"
import {
  classifyRentSmsIntent,
} from "./rentIntent.ts"
import { looksLikeBareRepairRequest } from "./resolveMaintenanceWorkIntent.ts"
import {
  classifyLeaseTopic,
  looksLikeMaintenanceStatusAsk,
  looksLikeMoveOutIntent,
} from "./nonRepairIntents.ts"
import {
  isRepairRecognition,
  recognizeInboundIntentSync,
  type InboundIntentRecognition,
} from "./recognizeInboundIntent.ts"
import {
  extractTenantInspectionNotice,
  hasStrongRepairAsk,
  looksLikeTenantInspectionNotice,
} from "../../../../shared/maintenance/tenantInspectionNotice.ts"
import { hasTenantScheduleTimeCue } from "./tenantSchedulePreferredWindow.ts"

export { looksLikeRentBalanceAsk } from "./rentIntent.ts"
export { looksLikeMaintenanceStatusAsk } from "./nonRepairIntents.ts"

export const TENANT_SMS_INTENTS = [
  "maintenance_new",
  "maintenance_status",
  "maintenance_update",
  "maintenance_cancel",
  "schedule_change",
  "access_instruction",
  "rent_balance",
  "rent_late",
  "rent_payment_platform",
  "lease_info",
  "move_out_intent",
  "inspection_notice",
  "other",
] as const

export type TenantSmsIntent = (typeof TENANT_SMS_INTENTS)[number]

export type InboundInterpretation = {
  addressesPending: boolean
  pendingAnswer?: string
  intent: TenantSmsIntent | null
  extractedSlots: Record<string, string>
  needsClarification: boolean
  source: "heuristic" | "llm" | "fast_path_skip"
  /** Which recognizer layer decided, and how sure it was. Logged per inbound. */
  recognition?: InboundIntentRecognition
  /** Request-local context reused by intake classification, never model-side memory. */
  smsContext?: ClassifyMaintenanceSmsContext
}

export type InterpretationPendingContext = {
  intakeStep?: IntakeStep | null
  recommendedUrgency?: string | null
  awaitingTicketUpdateConfirm?: boolean
  awaitingTicketCancelConfirm?: boolean
  awaitingMoveOutConfirm?: boolean
  awaitingWhichRequest?: boolean
  activeIntake: boolean
  draftTicketId?: string | null
  hasMedia?: boolean
}

/** Intents that are not an answer to the current maintenance question. */
const PENDING_BREAKOUT_INTENTS = new Set<TenantSmsIntent>([
  "lease_info",
  "rent_balance",
  "rent_late",
  "rent_payment_platform",
  "move_out_intent",
  "inspection_notice",
  "other",
  "maintenance_status",
  "schedule_change",
  "access_instruction",
])

/** True when the tenant skipped the photo ask (SKIP), not a missing caption. */
export function looksLikePhotoSkip(body: string): boolean {
  return /^(skip|no\s*photo|without a photo)([.!?\s]|$)/i.test(body.trim())
}

/** Whole-message cancel / close: natural ways tenants say maintenance is done. */
const CANCEL_SHORT =
  /^(cancel(?:led)?\s+(?:it|that|this|the request|the repair|the work order|the ticket|the job)|never ?mind|nvm|forget it|false alarm|it'?s (?:fixed|working|fine)(?: now)?|it is (?:fixed|working|fine)(?: now)?|everything'?s? (?:good|fine|fixed|ok|okay)(?: now)?|we'?re all good|you can close (?:it|that|this)|close (?:it|that|this|the request|the repair)|i don'?t need anyone(?: anymore)?|the problem stopped|all good)\s*[.!]?\s*$/i

const CANCEL_PHRASE =
  /\b(?:please )?cancel(?:\s+(?:my |the |this |that )?(?:repair|request|work order|ticket|job|it))(?:\s+please)?\b|\b(?:please )?close(?:\s+(?:my |the |this |that )?(?:repair|request|work order|ticket|job|it))\b|\byou can close (?:it|that|this|the (?:repair|request))\b|\bdon'?t (?:need|want) (?:it|this|the (?:repair|request|work order)|anyone)(?: anymore)?\b|\bdon'?t worry about (?:it|this)\b|\bnever ?mind(?!,?\s+i meant)\b|\b(?:i |we )(?:already )?(?:fixed|repaired|took care of) (?:it\b|(?:the |my |our )[a-z0-9][\w' -]{0,48})|\b(?:the )?(?:plumber|electrician|vendor|tech(?:nician)?) (?:already )?(?:fixed|repaired|took care of) it\b|\bit stopped(?!\s+working)\b|\bthe problem stopped\b|\bit'?s (?:fine|fixed|working) now\b|\bit is (?:fine|fixed|working) now\b|\beverything'?s? (?:good|fine|fixed|ok|okay)(?: now)?\b|\bwe'?re all good\b|\bno longer (?:an? )?(?:issue|problem|broken|leaking)\b|\bstopped leaking\b/i

/** True when the resident is stopping / resolving the current request. */
export function looksLikeCancelRepair(body: string): boolean {
  const text = body.trim()
  if (!text) return false
  if (/\bnever ?mind\b/i.test(text) && /\bi meant\b/i.test(text)) return false
  return CANCEL_SHORT.test(text) || CANCEL_PHRASE.test(text)
}

const REOPEN_REPAIR =
  /\b((wasn'?t|was not|still not) fixed|not fixed( yet)?|came back|broke again|broken again|happening again|same (problem|issue|leak) after|repair didn'?t work|leaking again|sparking again|stopped working again|doing the same thing again|the problem came back)\b/i

const URGENCY_WORSE =
  /\b(getting worse|worse now|it'?s worse|its worse|emergency now|getting (really )?bad)\b/i

const MAINTENANCE_UPDATE =
  /\b(still (broken|leaking|not fixed|going on)|getting worse|not fixed|same (problem|issue|leak)|happening again|came back|still not working)\b/i

const WEEKDAY_WORD =
  "mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:rs(?:day)?)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?"

const SCHEDULE_CHANGE =
  /\b(reschedule|re-?schedule|different time|another time|can'?t make\b|cannot make\b|change(?:\s+the)?\s+(?:time|appointment|visit)|move(?:\s+the)?\s+(?:appointment|visit|time)|tomorrow (?:doesn'?t|does not|won'?t|will not) work|(?:doesn'?t|does not) work for me|can they come|come after|come before|after \d{1,2}|before \d{1,2})\b/i

function normalizeScheduleText(text: string): string {
  return text.replace(/[‘’ʼ]/g, "'").replace(/\s+/g, " ").trim()
}

/** A resident is asking to move a visit, including a counter-window such as "Thursday 2–4 works better". */
export function looksLikeTenantScheduleChange(text: string): boolean {
  const body = normalizeScheduleText(text)
  if (!body) return false
  if (SCHEDULE_CHANGE.test(body)) return true
  return /\b(?:works|work) better\b/i.test(body) && hasTenantScheduleTimeCue(body)
}

function weekdayName(raw: string): string {
  const token = raw.toLowerCase()
  const names: Record<string, string> = {
    mon: "Monday", tue: "Tuesday", tues: "Tuesday", wed: "Wednesday",
    thu: "Thursday", thur: "Thursday", thurs: "Thursday", fri: "Friday",
    sat: "Saturday", sun: "Sunday",
  }
  if (names[token]) return names[token]
  return token.charAt(0).toUpperCase() + token.slice(1)
}

/**
 * The day the resident wants instead.
 * "Reschedule Wednesday" names the visit to move, so it is not a new preference.
 */
export function offeredVisitWeekday(text: string): string | null {
  const body = normalizeScheduleText(text)
  if (/\b(?:works|work) better\b/i.test(body)) {
    return extractWeekdayPreference(body)
  }
  const directed = body.match(
    new RegExp(
      `\\b(?:reschedul\\w*|re-?schedul\\w*|move|change|come)\\s+(?:it\\s+)?(?:to|for|on)\\s+(${WEEKDAY_WORD})\\b`,
      "i",
    ),
  )
  return directed ? weekdayName(directed[1]) : null
}

/**
 * Days that point at the existing visit ("can't make tomorrow", "reschedule Wednesday").
 * A directed new day ("reschedule to Thursday") is not included.
 */
export function existingVisitDayHints(text: string): string[] {
  const body = normalizeScheduleText(text)
  const hints: string[] = []
  if (
    /\b(?:can'?t|cannot)\s+make\s+tomorrow\b/i.test(body) ||
    /\btomorrow\s+(?:doesn'?t|does\s+not|won'?t|will\s+not)\s+work\b/i.test(body)
  ) {
    hints.push("tomorrow")
  }
  if (
    /\b(?:can'?t|cannot)\s+make\s+today\b/i.test(body) ||
    /\btoday\s+(?:doesn'?t|does\s+not|won'?t|will\s+not)\s+work\b/i.test(body)
  ) {
    hints.push("today")
  }
  const declined = body.match(
    new RegExp(`\\b(?:can'?t|cannot)\\s+make(?:\\s+the)?\\s+(${WEEKDAY_WORD})\\b`, "i"),
  )
  if (declined) hints.push(weekdayName(declined[1]))
  const moved = body.match(
    new RegExp(
      `\\b(?:reschedul\\w*|re-?schedul\\w*)\\s+(?!to\\b|for\\b|on\\b)(?:the\\s+)?(${WEEKDAY_WORD})\\b`,
      "i",
    ),
  )
  if (moved) hints.push(weekdayName(moved[1]))
  return [...new Set(hints)]
}

const NEW_VISIT_CLOCK =
  /\b\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)\b|\b(?:after|before|between|from)\s+\d{1,2}\b|\b\d{1,2}\s*[–—-]\s*\d{1,2}\b|\b(?:morning|afternoon|evening|noon)\b/i

const NEW_VISIT_DATE =
  /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?|\d{1,2}\/\d{1,2})\b/i

/** The resident offered a different day and a time, not only the visit they want to move. */
export function hasClearNewVisitWindow(text: string): boolean {
  const body = normalizeScheduleText(text)
  if (!body || !NEW_VISIT_CLOCK.test(body)) return false
  if (offeredVisitWeekday(body)) return true
  if (NEW_VISIT_DATE.test(body)) return true
  const hints = new Set(existingVisitDayHints(body).map((hint) => hint.toLowerCase()))
  const weekdays = body.match(new RegExp(`\\b(${WEEKDAY_WORD})\\b`, "gi")) ?? []
  if (weekdays.some((day) => !hints.has(weekdayName(day).toLowerCase()))) return true
  if (/\btomorrow\b/i.test(body) && !hints.has("tomorrow")) return true
  if (/\btoday\b/i.test(body) && !hints.has("today")) return true
  if (/\btonight\b/i.test(body)) return true
  return false
}

/** A scheduling reply that still lacks a new day, a new time, or both. */
export function isPartialRescheduleWindow(text: string): boolean {
  if (hasClearNewVisitWindow(text)) return false
  const body = normalizeScheduleText(text)
  if (!body) return false
  if (looksLikeTenantScheduleChange(body)) return true
  if (inferIssueTypeFromText(body)) return false
  return hasTenantScheduleTimeCue(body)
}

const ACCESS_INSTRUCTION =
  /\b(let (him|her|them|the vendor|the plumber) in|key(s)? (is |are )?(under|in|on)|lock ?box|gate code|don'?t (come in|enter)|do not (come in|enter)|i'?ll be home|i will be home|leave it (at|with|outside)|use the (side|back|front) (door|gate))\b/i

const NO_SHOW =
  /\b((they|he|she|the )?(vendor|plumber|electrician|tech|technician|repair ?person) (never|didn'?t|did not) (show|came|come|arrive)|never showed up|no-?show|didn'?t show up)\b/i

const PHOTO_FOLLOW_UP =
  /\b((here'?s|here is) (a |another )?(better |new )?(pic|picture|photo|image)|better (pic|picture|photo)|another (pic|picture|photo))\b/i

const CORRECTION =
  /\b(i meant|wrong (room|unit|place|area)|actually (it'?s|its|in) (the )?\w+|bathroom,? not the kitchen|kitchen,? not the bathroom)\b/i

const NOT_REPAIR =
  /\b(not (a |what i'?m |what i am )?(asking|maintenance|a repair|repair)|not what i'?m asking|neither|wrong (question|thing)|that'?s not (it|what)|this isn'?t (a )?(repair|maintenance))\b/i

function isTenantSmsIntent(raw: unknown): raw is TenantSmsIntent {
  return typeof raw === "string" &&
    (TENANT_SMS_INTENTS as readonly string[]).includes(raw)
}

function asSlots(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {}
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === "string" && value.trim()) {
      out[key] = value.trim().slice(0, 240)
    }
  }
  return out
}

export function shouldSkipInboundInterpretation(body: string): boolean {
  return classifyTenantComplianceKeyword(body) != null
}

export function pendingContextFromIntake(
  intake: SmsIntakeState | Record<string, unknown> | null | undefined,
): InterpretationPendingContext {
  if (!intake || typeof intake !== "object") {
    return { activeIntake: false }
  }
  const step = typeof intake.step === "string" ? intake.step as IntakeStep : null
  const activeIntake = Boolean(step && step !== "submitted")
  return {
    intakeStep: step,
    recommendedUrgency: typeof intake.recommended_urgency === "string"
      ? intake.recommended_urgency
      : null,
    awaitingTicketUpdateConfirm: intake.awaiting_ticket_update_confirm === true,
    awaitingTicketCancelConfirm: intake.awaiting_ticket_cancel_confirm === true,
    awaitingMoveOutConfirm: intake.awaiting_move_out_confirm === true,
    awaitingWhichRequest: intake.awaiting_which_request === true,
    activeIntake,
    draftTicketId: typeof intake.draft_ticket_id === "string"
      ? intake.draft_ticket_id
      : typeof intake.pending_ticket_update_id === "string"
      ? intake.pending_ticket_update_id
      : null,
  }
}

function pendingAnswerForStep(
  body: string,
  pending: InterpretationPendingContext,
): { addressesPending: boolean; pendingAnswer?: string } {
  if (pending.awaitingTicketUpdateConfirm) {
    if (isAffirmativeReply(body)) {
      return { addressesPending: true, pendingAnswer: "yes" }
    }
    if (/^(n|no|nope|nah)([.!?\s]|$)/i.test(body.trim())) {
      return { addressesPending: true, pendingAnswer: "no" }
    }
    return { addressesPending: false }
  }

  if (pending.awaitingTicketCancelConfirm || pending.awaitingMoveOutConfirm) {
    if (isAffirmativeReply(body)) {
      return { addressesPending: true, pendingAnswer: "yes" }
    }
    if (/^(n|no|nope|nah)([.!?\s]|$)/i.test(body.trim())) {
      return { addressesPending: true, pendingAnswer: "no" }
    }
    return { addressesPending: false }
  }

  const step = pending.intakeStep
  if (!step || step === "submitted") return { addressesPending: false }

  if (step === "urgency") {
    const urgency = resolveUrgencyReply(body, pending.recommendedUrgency) ??
      parseUrgency(body)
    if (urgency) return { addressesPending: true, pendingAnswer: urgency }
    return { addressesPending: false }
  }

  if (step === "issue_type") {
    const parsed = parseIssueType(body)
    if (parsed) return { addressesPending: true, pendingAnswer: parsed }
    return { addressesPending: false }
  }

  if (step === "preferred_contact_method") {
    const parsed = parseContactMethod(body)
    if (parsed) return { addressesPending: true, pendingAnswer: parsed }
    return { addressesPending: false }
  }

  if (step === "photo") {
    if (pending.hasMedia) {
      return { addressesPending: true, pendingAnswer: "photo" }
    }
    if (looksLikePhotoSkip(body)) {
      return { addressesPending: true, pendingAnswer: "skip" }
    }
    return { addressesPending: false }
  }

  if (step === "first_noticed") {
    const noticed = extractFirstNoticedFromText(body) ?? (body.trim() || null)
    if (noticed) return { addressesPending: true, pendingAnswer: noticed }
    return { addressesPending: false }
  }

  if (step === "diagnostic") {
    if (body.trim()) return { addressesPending: true, pendingAnswer: body.trim() }
    return { addressesPending: false }
  }

  if (step === "safety_concerns") {
    if (body.trim()) return { addressesPending: true, pendingAnswer: body.trim() }
    return { addressesPending: false }
  }

  if (step === "room_or_area") {
    const room = normalizeRoomOrArea(body)
    if (room) return { addressesPending: true, pendingAnswer: room }
    const noticed = extractFirstNoticedFromText(body)
    if (noticed) return { addressesPending: true, pendingAnswer: noticed }
    return { addressesPending: false }
  }

  if (
    step === "classification_clarification" ||
    step === "awaiting_edit_selection"
  ) {
    if (body.trim()) return { addressesPending: true, pendingAnswer: body.trim() }
    return { addressesPending: false }
  }

  if (step === "awaiting_confirm" || step === "awaiting_multi_issue_confirm") {
    if (/^summary$/i.test(body.trim())) {
      return { addressesPending: true, pendingAnswer: "summary" }
    }
    if (isAffirmativeReply(body)) {
      return { addressesPending: true, pendingAnswer: "yes" }
    }
    if (/^(n|no|nope|edit|change)([.!?\s]|$)/i.test(body.trim())) {
      return { addressesPending: true, pendingAnswer: body.trim() }
    }
  }

  return { addressesPending: false }
}

const WEEKDAY =
  /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)\b/i

const ACCESS_ALLOW =
  /\b(won'?t be home|will not be home|vendor can enter|can enter without me|let (him|her|them|the vendor|the plumber) in)\b/i

const ACCESS_RESTRICT =
  /\b(don'?t enter unless|do not enter unless|must be home|i (need to |have to )?be (home|there)|not unless i'?m home)\b/i

const MONTH_INDEX: Record<string, number> = {
  january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3,
  april: 4, apr: 4, may: 5, june: 6, jun: 6, july: 7, jul: 7,
  august: 8, aug: 8, september: 9, sep: 9, sept: 9, october: 10, oct: 10,
  november: 11, nov: 11, december: 12, dec: 12,
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

function isoDate(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  const dt = new Date(year, month - 1, day)
  if (dt.getFullYear() !== year || dt.getMonth() !== month - 1 || dt.getDate() !== day) {
    return null
  }
  return `${year}-${pad2(month)}-${pad2(day)}`
}

/** Parse a move-out / calendar date from resident SMS. Returns YYYY-MM-DD or null. */
export function parseResidentCalendarDate(
  text: string,
  now = new Date(),
): string | null {
  const t = text.trim()
  const iso = t.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/)
  if (iso) return isoDate(Number(iso[1]), Number(iso[2]), Number(iso[3]))

  const named = t.match(
    /\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s*(20\d{2}))?\b/i,
  )
  if (named) {
    const month = MONTH_INDEX[named[1].toLowerCase()]
    const day = Number(named[2])
    let year = named[3] ? Number(named[3]) : now.getFullYear()
    if (!named[3] && month && month < now.getMonth() + 1) year += 1
    if (!named[3] && month === now.getMonth() + 1 && day < now.getDate()) year += 1
    return month ? isoDate(year, month, day) : null
  }

  const md = t.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/)
  if (md) {
    const month = Number(md[1])
    const day = Number(md[2])
    let year = md[3] ? Number(md[3]) : now.getFullYear()
    if (year < 100) year += 2000
    if (!md[3]) {
      const candidate = new Date(year, month - 1, day)
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
      if (candidate < today) year += 1
    }
    return isoDate(year, month, day)
  }
  return null
}

export function extractWeekdayPreference(text: string): string | null {
  const match = text.match(WEEKDAY)
  if (!match) return null
  const raw = match[1].toLowerCase()
  const names: Record<string, string> = {
    mon: "Monday", tue: "Tuesday", tues: "Tuesday", wed: "Wednesday",
    thu: "Thursday", thur: "Thursday", thurs: "Thursday", fri: "Friday",
    sat: "Saturday", sun: "Sunday",
  }
  if (names[raw]) return names[raw]
  return raw.charAt(0).toUpperCase() + raw.slice(1)
}

export function accessInstructionKind(
  text: string,
): "allow" | "restrict" | "note" {
  if (ACCESS_RESTRICT.test(text)) return "restrict"
  if (ACCESS_ALLOW.test(text)) return "allow"
  return "note"
}

export function nextStepForVendorStatus(
  status: string | null,
  hasWindow: boolean,
): string {
  const v = (status ?? "").trim().toLowerCase()
  if (v === "unassigned") return "Next: we're matching a vendor."
  if (v === "pending_accept") {
    return "Next: waiting for the vendor to accept. We'll follow up if they don't."
  }
  if (v === "accepted" && !hasWindow) {
    return "Next: we'll text you when a visit time is set."
  }
  if ((v === "accepted" || v === "in_progress") && hasWindow) {
    return "Next: no action needed unless that time doesn't work."
  }
  if (v === "in_progress") return "Next: the vendor is working this repair."
  if (v === "completed") {
    return "Next: reply here if something still isn't right."
  }
  return "Next: the property team will follow up if anything changes."
}

export function formatRentDueDayLabel(day: number, now = new Date()): string | null {
  if (!Number.isFinite(day) || day < 1 || day > 28) return null
  const d = Math.trunc(day)
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  let due = new Date(now.getFullYear(), now.getMonth(), d)
  if (due < today) due = new Date(now.getFullYear(), now.getMonth() + 1, d)
  return due.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  })
}

function heuristicIntent(
  body: string,
  pending: InterpretationPendingContext,
  recognized: InboundIntentRecognition,
  recentTurns?: string | null,
): {
  intent: TenantSmsIntent | null
  extractedSlots: Record<string, string>
  confident: boolean
} {
  const text = body.trim()
  if (!text) {
    return { intent: null, extractedSlots: {}, confident: false }
  }

  const leaseTopic = classifyLeaseTopic(text)
  if (leaseTopic) {
    return {
      intent: "lease_info",
      extractedSlots: { topic: leaseTopic },
      confident: true,
    }
  }

  {
    const rent = classifyRentSmsIntent(text, { recentTurns })
    if (rent.kind === "rent_late") {
      return {
        intent: "rent_late",
        extractedSlots: { reason: text.slice(0, 240) },
        confident: rent.confident,
      }
    }
    if (rent.kind === "rent_payment_platform") {
      return {
        intent: "rent_payment_platform",
        extractedSlots: {
          topic: "payment_platform",
          issue_summary: text.slice(0, 240),
        },
        confident: rent.confident,
      }
    }
    if (rent.kind === "rent_balance" && rent.topic) {
      return {
        intent: "rent_balance",
        extractedSlots: {
          topic: rent.topic,
          ...(rent.needsClarification ? { needs_rent_clarify: "true" } : {}),
        },
        confident: rent.confident && !rent.needsClarification,
      }
    }
    if (rent.kind === "rent_general") {
      return {
        intent: "other",
        extractedSlots: {
          topic: rent.topic ?? "rent_general",
          rent_topic: rent.topic ?? "general",
        },
        confident: true,
      }
    }
  }

  if (looksLikeMoveOutIntent(text)) {
    const date = parseResidentCalendarDate(text)
    return {
      intent: "move_out_intent",
      extractedSlots: date ? { move_out_date: date } : {},
      confident: true,
    }
  }

  if (looksLikeCancelRepair(text)) {
    return { intent: "maintenance_cancel", extractedSlots: {}, confident: true }
  }

  if (NO_SHOW.test(text)) {
    return {
      intent: "maintenance_update",
      extractedSlots: { update: text.slice(0, 240), kind: "no_show" },
      confident: true,
    }
  }

  if (PHOTO_FOLLOW_UP.test(text)) {
    return {
      intent: "maintenance_update",
      extractedSlots: { update: text.slice(0, 240), kind: "photo" },
      confident: true,
    }
  }

  if (CORRECTION.test(text)) {
    return {
      intent: "maintenance_update",
      extractedSlots: { update: text.slice(0, 240), kind: "correction" },
      confident: true,
    }
  }

  if (looksLikeMaintenanceStatusAsk(text) || looksLikeClosedRepairStatusAsk(text)) {
    return { intent: "maintenance_status", extractedSlots: {}, confident: true }
  }

  if (ACCESS_INSTRUCTION.test(text) || ACCESS_ALLOW.test(text) || ACCESS_RESTRICT.test(text)) {
    return {
      intent: "access_instruction",
      extractedSlots: {
        access: text.slice(0, 240),
        access_kind: accessInstructionKind(text),
      },
      confident: true,
    }
  }

  if (looksLikeTenantScheduleChange(text) && (!pending.activeIntake || pending.draftTicketId)) {
    const weekday = offeredVisitWeekday(text)
    return {
      intent: "schedule_change",
      extractedSlots: weekday ? { preferred_day: weekday } : {},
      confident: true,
    }
  }

  if (REOPEN_REPAIR.test(text)) {
    if (pending.activeIntake && !pending.draftTicketId) {
      return { intent: "maintenance_new", extractedSlots: {}, confident: true }
    }
    return {
      intent: "maintenance_update",
      extractedSlots: { update: text.slice(0, 240), kind: "reopen" },
      confident: true,
    }
  }

  if (URGENCY_WORSE.test(text) || MAINTENANCE_UPDATE.test(text)) {
    if (pending.activeIntake && !pending.draftTicketId) {
      return { intent: "maintenance_new", extractedSlots: {}, confident: true }
    }
    return {
      intent: "maintenance_update",
      extractedSlots: {
        update: text.slice(0, 240),
        kind: URGENCY_WORSE.test(text) ? "worse" : "update",
      },
      confident: true,
    }
  }

  if (NOT_REPAIR.test(text)) {
    return { intent: "other", extractedSlots: {}, confident: true }
  }

  // Tenant-forwarded inspection schedule notice (HABC / annual visit) —
  // not a repair ticket. Compound notice+repair is still inspection_notice;
  // the act path creates the inspection_reports row then continues repair
  // as a checklist item under that visit.
  if (looksLikeTenantInspectionNotice(text)) {
    const notice = extractTenantInspectionNotice(text)
    return {
      intent: "inspection_notice",
      extractedSlots: {
        ...(notice.inspectionDate
          ? { inspection_date: notice.inspectionDate }
          : {}),
        ...(hasStrongRepairAsk(text) ? { also_repair: "1" } : {}),
      },
      confident: true,
    }
  }

  // One shared recognizer decides "is this a repair?" — no second keyword list.
  if (isRepairRecognition(recognized) || looksLikeBareRepairRequest(text)) {
    return {
      intent: "maintenance_new",
      extractedSlots: repairSlots(recognized),
      confident: true,
    }
  }

  return { intent: null, extractedSlots: {}, confident: false }
}

/** What the recognizer understood, so intake can confirm it in the first question. */
function repairSlots(
  recognized: InboundIntentRecognition,
): Record<string, string> {
  return {
    ...(recognized.issueSummary ? { issue_summary: recognized.issueSummary } : {}),
    ...(recognized.confirmation
      ? { confirm_interpretation: recognized.confirmation }
      : {}),
  }
}

export function heuristicInterpretInbound(
  body: string,
  pending: InterpretationPendingContext = { activeIntake: false },
  recentTurns?: string | null,
): InboundInterpretation {
  if (shouldSkipInboundInterpretation(body)) {
    return {
      addressesPending: false,
      intent: null,
      extractedSlots: {},
      needsClarification: false,
      source: "fast_path_skip",
    }
  }

  const pendingMatch = pendingAnswerForStep(body, pending)
  const recognition = recognizeInboundIntentSync(body, {
    activeIntake: pending.activeIntake,
  })
  if (pendingMatch.pendingAnswer === "summary" && pendingMatch.addressesPending) {
    return {
      addressesPending: true,
      pendingAnswer: "summary",
      intent: "maintenance_new",
      extractedSlots: {},
      needsClarification: false,
      source: "heuristic",
      recognition,
    }
  }
  const guessed = heuristicIntent(body, pending, recognition, recentTurns)
  const withRecognition = (
    interpretation: InboundInterpretation,
  ): InboundInterpretation => ({ ...interpretation, recognition })

  if (
    guessed.intent === "maintenance_cancel" &&
    !pending.awaitingTicketCancelConfirm
  ) {
    return withRecognition({
      addressesPending: false,
      intent: "maintenance_cancel",
      extractedSlots: guessed.extractedSlots,
      needsClarification: false,
      source: "heuristic",
    })
  }

  if (
    guessed.intent &&
    PENDING_BREAKOUT_INTENTS.has(guessed.intent) &&
    !pending.awaitingMoveOutConfirm
  ) {
    return withRecognition({
      addressesPending: false,
      intent: guessed.intent,
      extractedSlots: guessed.extractedSlots,
      needsClarification: false,
      source: "heuristic",
    })
  }

  if (pending.awaitingTicketUpdateConfirm && pendingMatch.addressesPending) {
    return withRecognition({
      addressesPending: true,
      pendingAnswer: pendingMatch.pendingAnswer,
      intent: "maintenance_update",
      extractedSlots: guessed.extractedSlots,
      needsClarification: false,
      source: "heuristic",
    })
  }

  if (pending.awaitingTicketCancelConfirm && pendingMatch.addressesPending) {
    return withRecognition({
      addressesPending: true,
      pendingAnswer: pendingMatch.pendingAnswer,
      intent: "maintenance_cancel",
      extractedSlots: guessed.extractedSlots,
      needsClarification: false,
      source: "heuristic",
    })
  }

  if (pending.awaitingMoveOutConfirm && pendingMatch.addressesPending) {
    return withRecognition({
      addressesPending: true,
      pendingAnswer: pendingMatch.pendingAnswer,
      intent: "move_out_intent",
      extractedSlots: guessed.extractedSlots,
      needsClarification: false,
      source: "heuristic",
    })
  }

  if (pendingMatch.addressesPending) {
    return withRecognition({
      addressesPending: true,
      pendingAnswer: pendingMatch.pendingAnswer,
      intent: guessed.intent ?? "maintenance_new",
      extractedSlots: guessed.extractedSlots,
      needsClarification: false,
      source: "heuristic",
    })
  }

  return withRecognition({
    addressesPending: false,
    intent: guessed.intent,
    extractedSlots: guessed.extractedSlots,
    needsClarification: !guessed.confident,
    source: "heuristic",
  })
}

export function shouldHandleInterpretedIntent(
  interpretation: InboundInterpretation,
  body: string,
  pending?: InterpretationPendingContext,
): boolean {
  if (interpretation.source === "fast_path_skip") return false
  if (isLeaseRenewalInquirySms(body)) return false
  if (
    pending?.awaitingTicketUpdateConfirm &&
    interpretation.intent === "maintenance_update"
  ) {
    return true
  }
  if (
    pending?.awaitingTicketCancelConfirm &&
    interpretation.intent === "maintenance_cancel"
  ) {
    return true
  }
  if (
    pending?.awaitingMoveOutConfirm &&
    interpretation.intent === "move_out_intent"
  ) {
    return true
  }
  if (interpretation.addressesPending) return false
  if (
    pending?.activeIntake &&
    pending.intakeStep &&
    pending.intakeStep !== "submitted" &&
    isAffirmativeReply(body)
  ) {
    return false
  }
  const intent = interpretation.intent
  if (!intent || intent === "maintenance_new") return false
  if (intent === "other" && interpretation.needsClarification) return false
  return true
}

/** Safety-net for classifyWorkflow: don't pin maintenance_intake to a non-repair ask. */
export function shouldUnpinMaintenanceForInterpretation(
  interpretation: InboundInterpretation | null | undefined,
  body: string,
): boolean {
  if (isLeaseRenewalInquirySms(body)) return true
  if (!interpretation) return false
  if (interpretation.extractedSlots.contextual_action === "new_issue") return true
  return shouldHandleInterpretedIntent(interpretation, body)
}

/**
 * A distinct new repair should leave a stuck intake pin, then start a new
 * maintenance_intake run — not fall through to unknown-number onboarding.
 */
export function shouldRejectMaintenanceTemplateForInterpretation(
  interpretation: InboundInterpretation | null | undefined,
  body: string,
): boolean {
  if (interpretation?.extractedSlots.contextual_action === "new_issue") return false
  return shouldUnpinMaintenanceForInterpretation(interpretation, body)
}

function interpretationFromLlm(
  draft: LlmClassificationDraft | null | undefined,
): Partial<InboundInterpretation> | null {
  const raw = draft?.interpretation
  if (!raw) return null
  return {
    addressesPending: raw.addressesPending,
    pendingAnswer: raw.pendingAnswer,
    intent: isTenantSmsIntent(raw.intent) ? raw.intent : null,
    extractedSlots: asSlots(raw.extractedSlots),
    needsClarification: raw.needsClarification,
  }
}

export async function interpretInboundSms(params: {
  body: string
  pending?: InterpretationPendingContext
  hasMedia?: boolean
  skipLlm?: boolean
  recentTurns?: string | null
  smsContext?: ClassifyMaintenanceSmsContext
}): Promise<InboundInterpretation> {
  const pending: InterpretationPendingContext = {
    ...(params.pending ?? { activeIntake: false }),
    hasMedia: params.hasMedia === true || params.pending?.hasMedia === true,
  }
  const smsContext: ClassifyMaintenanceSmsContext = {
    ...params.smsContext,
    pendingStep: pending.awaitingTicketUpdateConfirm
      ? "awaiting_ticket_update_confirm"
      : pending.intakeStep ?? null,
    pendingQuestion: params.smsContext?.pendingQuestion ?? (pending.activeIntake
      ? `Resident is in maintenance intake step ${pending.intakeStep ?? "unknown"}`
      : null),
    recentTurns: params.smsContext?.recentTurns ?? params.recentTurns ?? null,
  }
  const heuristic = { ...heuristicInterpretInbound(
    params.body,
    pending,
    smsContext.recentTurns,
  ), smsContext }

  if (heuristic.source === "fast_path_skip") return heuristic
  if (!heuristic.needsClarification) return heuristic
  if (params.skipLlm) return heuristic

  // Don't add a second model call on a fresh thread — intake still classifies repairs.
  // Use the widened LLM only when a pending intake ask didn't match.
  if (
    !pending.activeIntake &&
    !pending.awaitingTicketUpdateConfirm &&
    !pending.awaitingTicketCancelConfirm &&
    !pending.awaitingMoveOutConfirm
  ) {
    return heuristic
  }

  const classification = await classifyMaintenanceRequest({
    rawDescription: params.body,
    skipEmbeddings: !Deno.env.get("OPENAI_API_KEY")?.trim(),
    smsContext,
  })

  const llmDraft = classification.audit?.llm as LlmClassificationDraft | undefined
  const fromLlm = interpretationFromLlm(llmDraft)
  if (!fromLlm || fromLlm.intent == null) {
    return heuristic
  }

  return {
    addressesPending: fromLlm.addressesPending ?? false,
    pendingAnswer: fromLlm.pendingAnswer,
    intent: fromLlm.intent,
    extractedSlots: {
      ...heuristic.extractedSlots,
      ...fromLlm.extractedSlots,
    },
    needsClarification: fromLlm.needsClarification ?? false,
    source: "llm",
    recognition: heuristic.recognition,
    smsContext,
  }
}
