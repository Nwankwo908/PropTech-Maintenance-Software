/**
 * Detect multiple distinct maintenance asks in one SMS and prepare
 * per-issue tickets (each can get its own vendor assignment).
 *
 * Same-trade splits (e.g. two plumbing problems) are kept when the message
 * uses clear markers ("Also", paragraphs, numbered lists). Same unit + same
 * trade reuses one vendor at submit time.
 */
import { classifyMaintenanceRequest } from "../maintenance_classification/mod.ts"
import { matchDeterministicRules } from "../maintenance_classification/deterministicRules.ts"
import type { VendorTrade } from "../maintenance_classification/types.ts"
import { extractResidentAvailabilityText } from "./residentAvailabilityExtract.ts"
import {
  pipelineTradeToIssueType,
  type PendingIntakeIssue,
  type SmsIntakeState,
} from "./residentIntakeTypes.ts"

export type { PendingIntakeIssue }

export const MULTI_ISSUE_MAX = 4

const SPLIT_MARKERS =
  /\n\s*\n+|\bAlso[,:]?\s+|\bAdditionally[,:]?\s+|\bIn\s+addition[,:]?\s+|\bPlus[,:]?\s+|\bAnd\s+(?:also|then|yesterday|today)\b|(?:^|\n)\s*(?:\d+[\).\]]|-)\s+/gi

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

function shortSummary(text: string, max = 90): string {
  const cleaned = text.replace(/\s+/g, " ").trim()
  if (cleaned.length <= max) return cleaned
  return `${cleaned.slice(0, max - 1)}…`
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

type ScoredSegment = {
  text: string
  trade: VendorTrade
  weight: number
}

function scoreSegment(text: string): ScoredSegment | null {
  const hits = matchDeterministicRules(text)
  if (hits.length === 0) return null
  const top = [...hits].sort((a, b) => b.weight - a.weight)[0]
  if (!top || top.weight < 0.7) return null
  return { text, trade: top.trade, weight: top.weight }
}

/**
 * Score segments into issue clusters.
 * When `keepSameTrade` is true (marker splits), adjacent same-trade segments
 * stay separate so two plumbing asks become two tickets.
 * When false (sentence fallback), merge adjacent same-trade to avoid
 * splitting one leak across two sentences.
 */
export function clusterIssueSegments(
  segments: string[],
  opts?: { keepSameTrade?: boolean },
): ScoredSegment[] {
  const keepSameTrade = opts?.keepSameTrade === true
  const scored: ScoredSegment[] = []
  for (const seg of segments) {
    const hit = scoreSegment(seg)
    if (!hit) continue
    const prev = scored[scored.length - 1]
    if (!keepSameTrade && prev && prev.trade === hit.trade) {
      prev.text = `${prev.text} ${hit.text}`.trim()
      prev.weight = Math.max(prev.weight, hit.weight)
    } else {
      scored.push({ ...hit })
    }
  }
  return scored
}

async function pendingFromCluster(
  cluster: ScoredSegment,
): Promise<PendingIntakeIssue> {
  const classified = await classifyMaintenanceRequest({
    rawDescription: cluster.text,
    skipLlm: true,
    skipEmbeddings: true,
  })
  const trade =
    classified.vendorTrade !== "other" ? classified.vendorTrade : cluster.trade
  const issueType =
    pipelineTradeToIssueType(classified.issueType, trade) || "general"
  return {
    summary: shortSummary(cluster.text),
    description: cluster.text,
    vendor_trade: trade,
    issue_type: issueType,
    room_or_area: classified.entities.location ?? undefined,
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
 * tickets. Sentence-only splits still require distinct trades.
 */
export async function detectMultipleMaintenanceIssues(
  raw: string,
): Promise<PendingIntakeIssue[]> {
  const { segments, mode } = splitMaintenanceIssueSegmentsWithMode(raw)
  const clustered = clusterIssueSegments(segments, {
    keepSameTrade: mode === "markers",
  })

  // Marker path: 2+ scored segments → multi-issue (same trade OK).
  if (mode === "markers" && clustered.length >= 2) {
    const pending: PendingIntakeIssue[] = []
    for (const cluster of clustered.slice(0, MULTI_ISSUE_MAX)) {
      pending.push(await pendingFromCluster(cluster))
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
      const classified = await classifyMaintenanceRequest({
        rawDescription: slice,
        skipLlm: true,
        skipEmbeddings: true,
      })
      const issueType =
        pipelineTradeToIssueType(classified.issueType, classified.vendorTrade) ||
        "general"
      pending.push({
        summary: shortSummary(slice),
        description: slice,
        vendor_trade: classified.vendorTrade !== "other"
          ? classified.vendorTrade
          : trade,
        issue_type: issueType,
        room_or_area: classified.entities.location ?? undefined,
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
    pending.push(await pendingFromCluster(cluster))
  }

  const trades = new Set(pending.map((p) => p.vendor_trade))
  if (trades.size < 2) return []
  return pending
}

export function buildMultiIssueConfirmSms(issues: PendingIntakeIssue[]): string {
  const lines = [
    "Thanks — I see more than one request in your message. Here's how I'd split them:",
    "",
  ]
  for (let i = 0; i < issues.length; i++) {
    const issue = issues[i]
    lines.push(
      `${i + 1}. ${tradeLabel(issue.vendor_trade)} — ${issue.summary}`,
    )
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
 * After the resident confirms the split, continue the shared intake wizard
 * (room → timing → safety → urgency → contact → photo → final confirm).
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

  return {
    ...state,
    pending_issues: issues,
    // Skip issue_type — each pending issue already has a trade.
    issue_type: undefined,
    vendor_trade: issues[0]?.vendor_trade,
    room_or_area: state.room_or_area ?? roomFromIssues,
    preferred_visit_windows: visitWindows,
    // Clear premature defaults so the wizard collects real answers.
    preferred_contact_method: undefined,
    urgency: undefined,
    recommended_urgency: undefined,
    step: roomFromIssues || state.room_or_area?.trim()
      ? "first_noticed"
      : "room_or_area",
  }
}

export function buildMultiIssueSubmittedSms(
  ticketIds: string[],
): string {
  const refs = ticketIds
    .map((id) => id.slice(0, 8).toUpperCase())
    .join(", ")
  const n = ticketIds.length
  return (
    `You're all set! I've opened ${n} work order${n === 1 ? "" : "s"} (${refs}). ` +
    `We'll line up the right vendor for each and keep you posted right here.`
  )
}

export function intakeStateForMultiIssueConfirm(
  raw: string,
  issues: PendingIntakeIssue[],
): SmsIntakeState {
  return {
    step: "awaiting_multi_issue_confirm",
    initial_message: raw.trim(),
    description: raw.trim(),
    pending_issues: issues,
    preferred_visit_windows: extractResidentAvailabilityText(raw) ?? undefined,
    severity: issues.some((i) => i.severity === "high") ? "high" : "normal",
  }
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
