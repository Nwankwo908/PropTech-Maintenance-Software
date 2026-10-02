/**
 * Detect multiple distinct maintenance asks in one SMS and prepare
 * per-issue tickets (each can get its own vendor assignment).
 *
 * Same-trade splits (e.g. two plumbing problems) are kept when the message
 * uses clear markers ("Also", paragraphs, numbered lists) AND the fragments
 * are independently actionable with no shared root cause. Media mentions,
 * consequences, and multi-symptom cascades stay on one ticket.
 */
import { classifyMaintenanceRequest } from "../maintenance_classification/mod.ts"
import { matchDeterministicRules } from "../maintenance_classification/deterministicRules.ts"
import { hasProblemSignal } from "../../../../shared/maintenance/deterministicRules.ts"
import { generateIssueSummary } from "../../../../shared/maintenance/generateIssueSummary.ts"
import type { ClassificationResult, VendorTrade } from "../maintenance_classification/types.ts"
import { applyQuestionPlan } from "./determineNextMaintenanceQuestion.ts"
import { extractResidentAvailabilityText } from "./residentAvailabilityExtract.ts"
import {
  applyPhotoRequestPolicy,
  extractRoomFromText,
  pipelineTradeToIssueType,
  type PendingIntakeIssue,
  type SmsIntakeState,
} from "./residentIntakeTypes.ts"

export type { PendingIntakeIssue }

export const MULTI_ISSUE_MAX = 4

const SPLIT_MARKERS =
  /\n\s*\n+|\bAlso[,:]?\s+|\bAdditionally[,:]?\s+|\bIn\s+addition[,:]?\s+|\bPlus[,:]?\s+|\bAnd\s+(?:also|then|yesterday|today)\b|(?:^|\n)\s*(?:\d+[\).\]]|-)\s+/gi

/** Fixtures / appliances that can mark an independent ask. */
const FIXTURE_RE =
  /\b(sink|toilet|faucet|shower|tub|bathtub|drain|pipe|pipes|outlet|switch|smoke\s*alarms?|smoke\s*detectors?|carbon\s*monoxide\s*detectors?|stove|oven|fridge|refrigerator|dishwasher|washer|dryer|water\s*heater|heater|furnace|ac|air\s*condition(?:er|ing)?|door|window|lock|roof|ceiling|garbage\s*disposal)\b/gi

/** Language that elaborates damage / consequence of an earlier problem. */
const CONSEQUENCE_RE =
  /\b(soaked|warped|warping|rusted|corrod(?:ed|ing)|rotted|rotten|swollen|damaged|broke|broken|stained|mold|mould|water\s*damage|can'?t\s+use|cannot\s+use|turned\s+off\s+the\s+valves?|pooling|puddl(?:e|ing))\b/i

/** Fragment is mainly offering / mentioning photos or videos as evidence. */
const MEDIA_EVIDENCE_RE =
  /\b(?:photos?|pictures?|pics?|videos?|clips?|images?)\b/i

const MEDIA_OFFER_RE =
  /\b(?:i\s+)?(?:also\s+)?(?:have|took|taking|can\s+send|will\s+send|sending|attached?|sending\s+you)\b/i

export type IssueSplitMode = "markers" | "sentences" | "single"

function tradeLabel(trade: string): string {
  const map: Record<string, string> = {
    pest_control: "pest control",
    appliance_repair: "appliance repair",
    locksmith: "lock / door",
    carpentry: "carpentry",
    deck_builder: "deck builder",
    masonry: "masonry",
    concrete: "concrete",
    plumbing: "plumbing",
    electrical: "electrical",
    hvac: "HVAC",
    general: "general / handyman",
    other: "maintenance",
  }
  return map[trade] ?? trade.replace(/_/g, " ")
}

/** Clean noun-phrase summary for confirm SMS — never a mid-word char truncate. */
export function summarizeIssueCandidate(
  text: string,
  issueType?: string | null,
): string {
  return generateIssueSummary(text, {
    format: "title",
    category: issueType,
    maxChars: 50,
  })
}

/** True when the fragment is about photos/videos as evidence, not a new ask. */
export function isMediaEvidenceFragment(text: string): boolean {
  const raw = text.replace(/\s+/g, " ").trim()
  if (!raw || !MEDIA_EVIDENCE_RE.test(raw)) return false

  // Strip media-offer wording and "of the leaking/damage" so leftover problem
  // words from the evidence clause don't count as a second issue.
  const stripped = raw
    .replace(
      /\b(?:i\s+)?(?:also\s+)?(?:have|took|taking|can\s+send|will\s+send|am\s+sending|sending|attached?)\s+(?:a\s+|some\s+|the\s+)?(?:photos?|pictures?|pics?|videos?|clips?|images?)\b/gi,
      " ",
    )
    .replace(
      /\b(?:photos?|pictures?|pics?|videos?|clips?|images?)\b/gi,
      " ",
    )
    .replace(
      /\bof\s+(?:the\s+)?(?:leaking|leak|damage|issue|problem|it|that)\b/gi,
      " ",
    )
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()

  if (!stripped) return true
  // Short leftovers like "have e" / "of" after a bad split are not actionable.
  if (stripped.length < 16 && !hasIndependentFixtureAsk(stripped)) return true
  // Offer phrasing + media with no distinct fixture ask → evidence only.
  if (MEDIA_OFFER_RE.test(raw) && !hasIndependentFixtureAsk(stripped)) {
    return true
  }
  return false
}

function normalizeFixture(raw: string): string {
  const t = raw.toLowerCase().replace(/\s+/g, " ")
  if (/smoke|carbon\s*monoxide/.test(t)) return "smoke_alarm"
  if (/air\s*condition|\bac\b/.test(t)) return "ac"
  if (/fridge|refrigerator/.test(t)) return "fridge"
  if (/tub|bathtub/.test(t)) return "tub"
  if (/water\s*heater/.test(t)) return "water_heater"
  if (/garbage\s*disposal/.test(t)) return "disposal"
  return t
}

function extractFixtures(text: string): Set<string> {
  const found = new Set<string>()
  for (const m of text.matchAll(FIXTURE_RE)) {
    found.add(normalizeFixture(m[0]))
  }
  return found
}

function hasIndependentFixtureAsk(text: string): boolean {
  return extractFixtures(text).size > 0 && hasProblemSignal(text)
}

/**
 * Fixtures that commonly belong to the same plumbing assembly (one root cause).
 * sink ↔ faucet/drain/pipe is one leak cascade, not two work orders.
 */
const RELATED_FIXTURE_GROUPS: ReadonlyArray<ReadonlySet<string>> = [
  new Set(["sink", "faucet", "drain", "pipe", "pipes", "disposal"]),
  new Set(["toilet", "pipe", "pipes"]),
  new Set(["shower", "tub", "drain", "pipe", "pipes", "faucet"]),
  new Set(["water_heater", "pipe", "pipes"]),
]

function fixturesAreRelated(a: Set<string>, b: Set<string>): boolean {
  if (a.size === 0 || b.size === 0) return a.size === 0 || b.size === 0
  for (const x of a) {
    if (b.has(x)) return true
  }
  for (const group of RELATED_FIXTURE_GROUPS) {
    const aHit = [...a].some((f) => group.has(f))
    const bHit = [...b].some((f) => group.has(f))
    if (aHit && bHit) return true
  }
  return false
}

/** Distinct primary fixtures that should stay separate even in the same room. */
function hasDistinctIndependentFixtures(a: Set<string>, b: Set<string>): boolean {
  const primary = new Set([
    "sink",
    "toilet",
    "shower",
    "tub",
    "outlet",
    "smoke_alarm",
    "stove",
    "oven",
    "fridge",
    "dishwasher",
    "washer",
    "dryer",
    "door",
    "window",
    "lock",
    "ac",
    "heater",
    "furnace",
    "water_heater",
    "roof",
    "ceiling",
  ])
  const aPrimary = [...a].filter((f) => primary.has(f))
  const bPrimary = [...b].filter((f) => primary.has(f))
  if (aPrimary.length === 0 || bPrimary.length === 0) return false
  return aPrimary.every((f) => !bPrimary.includes(f)) &&
    !fixturesAreRelated(new Set(aPrimary), new Set(bPrimary))
}

/**
 * Non-actionable fragment: media evidence, emotional commentary, or trailing
 * description that is not itself a problem to open a work order for.
 */
export function isActionableIssueFragment(text: string): boolean {
  const raw = text.replace(/\s+/g, " ").trim()
  if (raw.length < 8) return false
  if (isMediaEvidenceFragment(raw)) return false

  // Operational consequence without a fresh problem report ("can't use", valves off).
  const withoutOps = raw
    .replace(/\b(can'?t\s+use|cannot\s+use)\s+(?:my\s+|the\s+)?\w+/gi, " ")
    .replace(/\bturned\s+off\s+the\s+valves?\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
  if (
    /\b(can'?t\s+use|cannot\s+use|turned\s+off\s+the\s+valves?)\b/i.test(raw) &&
    !hasProblemSignal(withoutOps) &&
    !hasIndependentFixtureAsk(withoutOps)
  ) {
    return false
  }

  if (hasProblemSignal(raw)) return true
  if (hasIndependentFixtureAsk(raw)) return true
  const hits = matchDeterministicRules(raw)
  const top = hits[0]
  if (top && top.weight >= 0.7) return true
  return false
}

/**
 * Adjacent same-trade fragments that share a plausible root cause (one leak
 * damaging drawer + faucet) should stay one issue.
 */
export function sharesPlausibleCommonCause(prior: string, next: string): boolean {
  if (isMediaEvidenceFragment(next)) return true
  if (!isActionableIssueFragment(next)) return true

  const priorFixtures = extractFixtures(prior)
  const nextFixtures = extractFixtures(next)

  if (hasDistinctIndependentFixtures(priorFixtures, nextFixtures)) {
    return false
  }

  // Consequence / damage language continuing the prior problem.
  if (CONSEQUENCE_RE.test(next)) {
    if (nextFixtures.size === 0) return true
    if (fixturesAreRelated(priorFixtures, nextFixtures)) return true
    // Drawer / vanity damage with no new primary fixture — cascade from leak.
    if (
      /\b(drawer|vanity|cabinet|wood|floor|ceiling|wall)\b/i.test(next) &&
      /\b(leak|drip|flood|soak|water)\b/i.test(prior)
    ) {
      return true
    }
  }

  // Same room, related fixtures, both plumbing-ish → one cause.
  const roomA = extractRoomFromText(prior)
  const roomB = extractRoomFromText(next)
  if (roomA && roomB && roomA === roomB && fixturesAreRelated(priorFixtures, nextFixtures)) {
    return true
  }

  // No new fixture — elaboration of the same problem ("water pooling…").
  if (nextFixtures.size === 0 && hasProblemSignal(next)) return true

  return false
}

/** SMS line when the resident mentioned photos/videos but has not sent them yet. */
export function buildMediaEvidenceAck(text: string): string | null {
  const raw = text.replace(/\s+/g, " ").trim()
  if (!raw || !MEDIA_EVIDENCE_RE.test(raw)) return null
  const hasVideo = /\bvideos?\b/i.test(raw)
  const hasPhoto = /\b(?:photos?|pictures?|pics?|images?)\b/i.test(raw)
  if (hasVideo && hasPhoto) {
    return "I'll attach your photo or video once you send it."
  }
  if (hasVideo) return "I'll attach your video once you send it."
  return "I'll attach your photo once you send it."
}

/** Split raw SMS into candidate issue segments. */
export function splitMaintenanceIssueSegments(raw: string): string[] {
  return splitMaintenanceIssueSegmentsWithMode(raw).segments
}

export function splitMaintenanceIssueSegmentsWithMode(
  raw: string,
): { segments: string[]; mode: IssueSplitMode } {
  const text = raw.trim()
  if (!text) return { segments: [], mode: "single" }

  const parts = text
    .split(SPLIT_MARKERS)
    .map((p) => p.trim())
    .filter((p) => p.length >= 12)

  if (parts.length >= 2) {
    return { segments: parts.slice(0, MULTI_ISSUE_MAX), mode: "markers" }
  }

  // Sentence-level fallback when "Also" style markers are missing
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 20)
  if (sentences.length >= 2) {
    return { segments: sentences.slice(0, MULTI_ISSUE_MAX), mode: "sentences" }
  }

  return { segments: [text], mode: "single" }
}

/**
 * Fold non-actionable / evidence fragments onto the preceding segment so they
 * never become their own work-order candidate.
 */
export function coalesceIssueSegments(segments: string[]): string[] {
  const out: string[] = []
  for (const seg of segments) {
    const trimmed = seg.trim()
    if (!trimmed) continue
    if (out.length > 0 && !isActionableIssueFragment(trimmed)) {
      out[out.length - 1] = `${out[out.length - 1]} ${trimmed}`.trim()
      continue
    }
    if (out.length === 0 && !isActionableIssueFragment(trimmed)) {
      // Leading pleasantry / media-only — keep so we don't drop the whole SMS.
      out.push(trimmed)
      continue
    }
    out.push(trimmed)
  }
  return out
}

type ScoredSegment = {
  text: string
  trade: VendorTrade
  weight: number
}

function scoreSegment(text: string): ScoredSegment | null {
  if (!isActionableIssueFragment(text)) return null
  const hits = matchDeterministicRules(text)
  if (hits.length === 0) return null
  const top = [...hits].sort((a, b) => b.weight - a.weight)[0]
  if (!top || top.weight < 0.7) return null
  return { text, trade: top.trade, weight: top.weight }
}

/**
 * Score segments into issue clusters.
 * When `keepSameTrade` is true (marker splits), adjacent same-trade segments
 * stay separate only when they look like independent asks. Shared root-cause
 * cascades and non-actionable evidence always merge.
 * When false (sentence fallback), merge adjacent same-trade to avoid
 * splitting one leak across two sentences.
 */
export function clusterIssueSegments(
  segments: string[],
  opts?: { keepSameTrade?: boolean },
): ScoredSegment[] {
  const keepSameTrade = opts?.keepSameTrade === true
  const coalesced = coalesceIssueSegments(segments)
  const scored: ScoredSegment[] = []
  for (const seg of coalesced) {
    const hit = scoreSegment(seg)
    if (!hit) {
      const prev = scored[scored.length - 1]
      if (prev) {
        prev.text = `${prev.text} ${seg}`.trim()
      }
      continue
    }
    const prev = scored[scored.length - 1]
    if (prev && prev.trade === hit.trade) {
      const shouldMerge = !keepSameTrade ||
        sharesPlausibleCommonCause(prev.text, hit.text)
      if (shouldMerge) {
        prev.text = `${prev.text} ${hit.text}`.trim()
        prev.weight = Math.max(prev.weight, hit.weight)
        continue
      }
    }
    scored.push({ ...hit })
  }
  return scored
}

async function pendingFromCluster(
  cluster: ScoredSegment,
  outdoorTempF: number | null = null,
  onClassified?: (result: ClassificationResult) => void,
): Promise<PendingIntakeIssue> {
  const classified = await classifyMaintenanceRequest({
    rawDescription: cluster.text,
    skipLlm: true,
    skipEmbeddings: !Deno.env.get("OPENAI_API_KEY")?.trim(),
    outdoorTempF,
  })
  onClassified?.(classified)
  const trade =
    classified.vendorTrade !== "other" ? classified.vendorTrade : cluster.trade
  const issueType =
    pipelineTradeToIssueType(classified.issueType, trade) || "general"
  return {
    summary: summarizeIssueCandidate(cluster.text, issueType),
    description: cluster.text,
    vendor_trade: trade,
    issue_type: issueType,
    room_or_area: classified.entities.location
      ? extractRoomFromText(classified.entities.location) ?? undefined
      : undefined,
    severity:
      classified.severity === "critical" || classified.severity === "urgent"
        ? "high"
        : "normal",
  }
}

/**
 * Detect multiple distinct maintenance issues in one message.
 * Returns [] when only one (or zero) issues — caller keeps single-issue path.
 *
 * Marker splits ("Also", paragraphs, lists) may yield multiple same-trade
 * tickets when fragments are independently actionable. Sentence-only splits
 * still require distinct trades.
 */
export async function detectMultipleMaintenanceIssues(
  raw: string,
  opts?: {
    outdoorTempF?: number | null
    onClassified?: (result: ClassificationResult) => void
  },
): Promise<PendingIntakeIssue[]> {
  const { segments, mode } = splitMaintenanceIssueSegmentsWithMode(raw)
  const clustered = clusterIssueSegments(segments, {
    keepSameTrade: mode === "markers",
  })
  const onClassified = opts?.onClassified

  // Marker path: 2+ scored segments → multi-issue (same trade OK).
  if (mode === "markers" && clustered.length >= 2) {
    const pending: PendingIntakeIssue[] = []
    for (const cluster of clustered.slice(0, MULTI_ISSUE_MAX)) {
      pending.push(
        await pendingFromCluster(
          cluster,
          opts?.outdoorTempF ?? null,
          onClassified,
        ),
      )
    }
    return pending.length >= 2 ? pending : []
  }

  // Whole-message multi-trade signal when splitter only returned one chunk
  // or sentence clustering collapsed to one trade.
  if (clustered.length < 2) {
    const wholeHits = matchDeterministicRules(raw)
    const byTrade = new Map<string, { weight: number; keywords: string[] }>()
    for (const h of wholeHits) {
      const cur = byTrade.get(h.trade)
      if (!cur || h.weight > cur.weight) {
        byTrade.set(h.trade, { weight: h.weight, keywords: h.keywords })
      }
    }
    if (byTrade.size < 2) return []

    // Build synthetic segments from keyword proximity in original text
    const pending: PendingIntakeIssue[] = []
    for (const [trade, meta] of byTrade) {
      if (pending.length >= MULTI_ISSUE_MAX) break
      if (meta.weight < 0.75) continue
      const keyword = meta.keywords[0] ?? trade
      const idx = raw.toLowerCase().indexOf(keyword.toLowerCase())
      const start = Math.max(0, idx - 40)
      const end = Math.min(raw.length, idx + 120)
      const slice = raw.slice(start, end).trim() || raw
      if (!isActionableIssueFragment(slice)) continue
      const classified = await classifyMaintenanceRequest({
        rawDescription: slice,
        skipLlm: true,
        skipEmbeddings: !Deno.env.get("OPENAI_API_KEY")?.trim(),
        outdoorTempF: opts?.outdoorTempF,
      })
      onClassified?.(classified)
      const issueType =
        pipelineTradeToIssueType(classified.issueType, classified.vendorTrade) ||
        "general"
      pending.push({
        summary: summarizeIssueCandidate(slice, issueType),
        description: slice,
        vendor_trade: classified.vendorTrade !== "other"
          ? classified.vendorTrade
          : trade,
        issue_type: issueType,
        room_or_area: classified.entities.location
          ? extractRoomFromText(classified.entities.location) ?? undefined
          : undefined,
        severity:
          classified.severity === "critical" || classified.severity === "urgent"
            ? "high"
            : "normal",
      })
    }
    // Dedupe by trade (whole-message path is multi-trade only)
    const seen = new Set<string>()
    const unique = pending.filter((p) => {
      if (seen.has(p.vendor_trade)) return false
      seen.add(p.vendor_trade)
      return true
    })
    return unique.length >= 2 ? unique : []
  }

  // Sentence path: require distinct trades so one leak isn't double-ticketed.
  const pending: PendingIntakeIssue[] = []
  for (const cluster of clustered.slice(0, MULTI_ISSUE_MAX)) {
    pending.push(
      await pendingFromCluster(
        cluster,
        opts?.outdoorTempF ?? null,
        onClassified,
      ),
    )
  }

  const trades = new Set(pending.map((p) => p.vendor_trade))
  if (trades.size < 2) return []
  return pending
}

export function buildMultiIssueConfirmSms(
  issues: PendingIntakeIssue[],
  rawMessage?: string,
): string {
  const lines = [
    "Thanks — I see more than one request in your message. Here's how I'd split them:",
    "",
  ]
  for (let i = 0; i < issues.length; i++) {
    const issue = issues[i]
    const summary = (issue.summary?.trim() ||
      summarizeIssueCandidate(issue.description, issue.issue_type)).replace(
        /\.$/,
        "",
      )
    lines.push(
      `${i + 1}. ${tradeLabel(issue.vendor_trade)} — ${summary}`,
    )
  }
  const ackSource = rawMessage ??
    issues.map((i) => i.description).join(" ")
  const mediaAck = buildMediaEvidenceAck(ackSource)
  if (mediaAck) {
    lines.push("")
    lines.push(mediaAck)
  }
  lines.push("")
  const trades = new Set(issues.map((i) => i.vendor_trade))
  const sameTrade = trades.size === 1
  lines.push(
    sameTrade
      ? "Reply YES to open a separate work order for each (I'll ask a few quick follow-ups, then assign your vendor to both), or NO to treat this as one request."
      : "Reply YES to open a separate work order for each (I'll ask a few quick follow-ups, then assign the right vendor to each), or NO to treat this as one request.",
  )
  return lines.join("\n")
}

/**
 * After the resident confirms the split, continue with targeted follow-ups
 * (not a generic questionnaire), then final confirm.
 */
export function beginMultiIssueSharedIntake(
  state: SmsIntakeState,
): SmsIntakeState {
  const issues = Array.isArray(state.pending_issues) ? state.pending_issues : []
  const roomFromIssues = issues
    .map((i) => i.room_or_area?.trim())
    .find((r): r is string => Boolean(r))

  const visitWindows = state.preferred_visit_windows?.trim() ||
    extractResidentAvailabilityText(state.initial_message || state.description || "") ||
    undefined

  return applyQuestionPlan({
    ...state,
    pending_issues: issues,
    issue_type: issues[0]?.issue_type,
    vendor_trade: issues[0]?.vendor_trade,
    room_or_area: state.room_or_area ?? roomFromIssues,
    preferred_visit_windows: visitWindows,
    preferred_contact_method: state.preferred_contact_method?.trim() || "text",
  })
}

export function buildRequestSubmittedSms(
  ticketId: string,
  _vendorAssigned = true,
  _companyName?: string | null,
  opts?: {
    categoryLabel?: string | null
    handlingTip?: string | null
  },
): string {
  const ref = ticketId.slice(0, 8).toUpperCase()
  const category = opts?.categoryLabel?.trim() || "maintenance"
  const tip = opts?.handlingTip?.trim()
  const tipBlock = tip ? `\n\n${tip}` : ""
  return (
    `Got it. We've logged a ${category} request for your unit. A vendor will be in touch to schedule.` +
    tipBlock +
    `\n\nRequest ${ref}`
  )
}

export function buildMultiIssueSubmittedSms(
  ticketIds: string[],
  _vendorAssigned = true,
  _companyName?: string | null,
  opts?: {
    handlingTip?: string | null
  },
): string {
  const refs = ticketIds
    .map((id) => id.slice(0, 8).toUpperCase())
    .join(", ")
  const n = ticketIds.length
  const tip = opts?.handlingTip?.trim()
  const tipBlock = tip ? `\n\n${tip}` : ""
  return (
    `Got it. We've logged ${n} maintenance request${n === 1 ? "" : "s"} for your unit. A vendor will be in touch to schedule.` +
    tipBlock +
    `\n\nRequest ${refs}`
  )
}

export const INTAKE_SUBMIT_FAILED_SMS =
  "Sorry about that. I couldn't submit your request just now. Please try again in a moment."

export const INTAKE_MULTI_SUBMIT_FAILED_SMS =
  "Sorry about that. I couldn't submit those requests just now. Please try again in a moment."

export function intakeStateForMultiIssueConfirm(
  raw: string,
  issues: PendingIntakeIssue[],
  outdoorTempF?: number | null,
): SmsIntakeState {
  const base: SmsIntakeState = {
    step: "awaiting_multi_issue_confirm",
    initial_message: raw.trim(),
    description: raw.trim(),
    photo_urls: [],
    pending_issues: issues,
    preferred_visit_windows: extractResidentAvailabilityText(raw) ?? undefined,
    severity: issues.some((i) => i.severity === "high") ? "high" : "normal",
    outdoor_temp_f: outdoorTempF ?? undefined,
  }
  return applyPhotoRequestPolicy(base)
}

/** Slice shared intake fields into a single-issue state for submit. */
export function intakeSliceForPendingIssue(
  base: SmsIntakeState,
  issue: PendingIntakeIssue,
  opts?: { forceNewTicket?: boolean },
): SmsIntakeState {
  return {
    step: "awaiting_confirm",
    initial_message: base.initial_message,
    description: issue.description,
    sanitized_description: issue.description,
    vendor_trade: issue.vendor_trade,
    issue_type: issue.issue_type,
    room_or_area: issue.room_or_area ?? base.room_or_area,
    first_noticed: base.first_noticed,
    preferred_visit_windows: base.preferred_visit_windows,
    safety_concerns: base.safety_concerns,
    urgency: base.urgency ?? (issue.severity === "high" ? "urgent" : "normal"),
    recommended_urgency: base.recommended_urgency,
    severity: base.severity ?? issue.severity ?? "normal",
    preferred_contact_method: base.preferred_contact_method ?? "text",
    photo_urls: base.photo_urls,
    photo_provider: base.photo_provider,
    draft_ticket_id: opts?.forceNewTicket
      ? undefined
      : issue.draft_ticket_id ?? base.draft_ticket_id,
    pending_issues: undefined,
  }
}

export function isNoReply(body: string): boolean {
  const n = body.trim().toUpperCase().replace(/[.!]+$/g, "")
  return n === "NO" || n === "N" || n === "JUST ONE" || n === "ONE" ||
    n === "SINGLE"
}
