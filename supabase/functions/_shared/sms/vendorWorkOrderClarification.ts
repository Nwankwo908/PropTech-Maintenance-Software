/**
 * Multi-job vendor SMS binding: high-confidence match or numbered clarification.
 * Never silently guess among multiple active work orders.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import {
  extractWorkOrderRefFromSms,
  formatWorkOrderRef,
  workOrderRefMatchesTicket,
} from "../vendor_outreach_copy.ts"
import { parseVendorSmsReply } from "../vendor_workflow.ts"

export const VENDOR_WO_CLARIFICATION_KEY = "vendor_work_order_clarification"
export const VENDOR_WO_CLARIFICATION_TTL_MS = 30 * 60 * 1000

export type VendorWorkOrderClarification = {
  vendorId: string
  conversationId: string
  landlordId: string
  originalMessage: string
  originalIntent: string | null
  candidateWorkOrderIds: string[]
  selectedWorkOrderId: string | null
  createdAt: string
  expiresAt: string
}

export type VendorActiveJob = {
  ticketId: string
  workOrderRef: string
  unit: string | null
  building: string | null
  issueCategory: string | null
  description: string | null
}

export type JobMatchResult =
  | { kind: "unique"; job: VendorActiveJob; boundBy: string }
  | { kind: "ambiguous"; jobs: VendorActiveJob[] }
  | { kind: "none" }

const OPEN_STATUSES = ["pending_accept", "accepted", "in_progress"] as const

function iso(ms = Date.now()): string {
  return new Date(ms).toISOString()
}

export function normalizeUnitKey(unit: string | null | undefined): string {
  return (unit ?? "")
    .trim()
    .toLowerCase()
    .replace(/^unit\s+/i, "")
    .replace(/^#/, "")
    .replace(/\s+/g, "")
}

export function jobIssueSummary(job: VendorActiveJob): string {
  const desc = (job.description ?? "").trim().replace(/\s+/g, " ")
  if (desc) return desc.length > 48 ? `${desc.slice(0, 45)}…` : desc
  const cat = (job.issueCategory ?? "").trim()
  if (cat) return cat.replace(/_/g, " ")
  return "Maintenance"
}

export function buildVendorWorkOrderClarifySms(
  jobs: VendorActiveJob[],
  reason: "need_work_order" | "unknown_work_order" | "no_open_jobs" = "need_work_order",
): string {
  if (reason === "no_open_jobs" || jobs.length === 0) {
    return (
      "I don't see an open work order assigned to you right now. " +
      "If you just got a new job offer, reply with that job ref " +
      "(for example YES WO-A1B2)."
    )
  }

  const intro =
    reason === "unknown_work_order"
      ? "Thanks. I couldn't match that to one of your open jobs. Which job are you responding to?"
      : "Thanks. You currently have multiple active work orders. Which job are you responding to?"

  const lines = [intro, ""]
  for (let i = 0; i < Math.min(jobs.length, 8); i++) {
    const job = jobs[i]
    const unit = job.unit?.trim()
    const unitBit = unit ? `Unit ${unit}` : "Unit —"
    lines.push(
      `${i + 1}. ${job.workOrderRef} — ${unitBit} — ${jobIssueSummary(job)}`,
    )
  }
  lines.push("")
  lines.push("Reply with the number or work-order ID.")
  return lines.join("\n")
}

export function readVendorWorkOrderClarification(
  intakeState: Record<string, unknown> | null | undefined,
): VendorWorkOrderClarification | null {
  if (!intakeState || typeof intakeState !== "object") return null
  const raw = intakeState[VENDOR_WO_CLARIFICATION_KEY]
  if (!raw || typeof raw !== "object") return null
  const row = raw as Record<string, unknown>
  const vendorId = typeof row.vendorId === "string" ? row.vendorId.trim() : ""
  const conversationId =
    typeof row.conversationId === "string" ? row.conversationId.trim() : ""
  const landlordId = typeof row.landlordId === "string" ? row.landlordId.trim() : ""
  const originalMessage =
    typeof row.originalMessage === "string" ? row.originalMessage : ""
  const createdAt = typeof row.createdAt === "string" ? row.createdAt : ""
  const expiresAt = typeof row.expiresAt === "string" ? row.expiresAt : ""
  const candidates = Array.isArray(row.candidateWorkOrderIds)
    ? row.candidateWorkOrderIds.filter((id): id is string =>
      typeof id === "string" && Boolean(id.trim())
    )
    : []
  if (!vendorId || !conversationId || !originalMessage || candidates.length === 0) {
    return null
  }
  return {
    vendorId,
    conversationId,
    landlordId,
    originalMessage,
    originalIntent: typeof row.originalIntent === "string"
      ? row.originalIntent
      : row.originalIntent === null
      ? null
      : null,
    candidateWorkOrderIds: candidates,
    selectedWorkOrderId:
      typeof row.selectedWorkOrderId === "string"
        ? row.selectedWorkOrderId
        : null,
    createdAt: createdAt || iso(),
    expiresAt: expiresAt || iso(Date.now() + VENDOR_WO_CLARIFICATION_TTL_MS),
  }
}

export function isVendorWorkOrderClarificationExpired(
  pending: VendorWorkOrderClarification,
  now = Date.now(),
): boolean {
  const exp = Date.parse(pending.expiresAt)
  return !Number.isFinite(exp) || exp <= now
}

export function withVendorWorkOrderClarification(
  intakeState: Record<string, unknown> | null | undefined,
  clarification: VendorWorkOrderClarification | null,
): Record<string, unknown> {
  const base =
    intakeState && typeof intakeState === "object" ? { ...intakeState } : {}
  if (!clarification) {
    delete base[VENDOR_WO_CLARIFICATION_KEY]
    return base
  }
  base[VENDOR_WO_CLARIFICATION_KEY] = clarification
  return base
}

export async function persistVendorWorkOrderClarification(
  supabase: SupabaseClient,
  params: {
    conversationId: string
    clarification: VendorWorkOrderClarification | null
  },
): Promise<boolean> {
  const { data: convo } = await supabase
    .from("sms_conversations")
    .select("intake_state")
    .eq("id", params.conversationId)
    .maybeSingle()

  const currentIntake =
    (convo?.intake_state as Record<string, unknown> | null) ?? {}
  const { error } = await supabase
    .from("sms_conversations")
    .update({
      intake_state: withVendorWorkOrderClarification(
        currentIntake,
        params.clarification,
      ),
      updated_at: iso(),
    })
    .eq("id", params.conversationId)

  if (error) {
    console.error("[vendor-wo-clarify] persist", error.message)
    return false
  }
  return true
}

export function createVendorWorkOrderClarification(params: {
  vendorId: string
  conversationId: string
  landlordId: string
  originalMessage: string
  originalIntent?: string | null
  candidateWorkOrderIds: string[]
  now?: number
}): VendorWorkOrderClarification {
  const now = params.now ?? Date.now()
  return {
    vendorId: params.vendorId,
    conversationId: params.conversationId,
    landlordId: params.landlordId,
    originalMessage: params.originalMessage,
    originalIntent: params.originalIntent ?? parseVendorSmsReply(params.originalMessage),
    candidateWorkOrderIds: params.candidateWorkOrderIds,
    selectedWorkOrderId: null,
    createdAt: iso(now),
    expiresAt: iso(now + VENDOR_WO_CLARIFICATION_TTL_MS),
  }
}

/** Extract unit-like tokens from vendor SMS. */
export function extractUnitHintsFromSms(body: string): string[] {
  const hints = new Set<string>()
  const unitPhrase = body.matchAll(
    /\b(?:unit|apt|apartment|#)\s*([a-z0-9-]{1,12})\b/gi,
  )
  for (const m of unitPhrase) {
    const key = normalizeUnitKey(m[1])
    if (key) hints.add(key)
  }
  return [...hints]
}

function tokenizeIssueText(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 4)
}

/** Distinctive phrases only — never broad trade labels like "plumbing". */
const ISSUE_PHRASES: Array<{ phrase: RegExp; keys: string[] }> = [
  { phrase: /\bwater\s*heater\b/i, keys: ["water heater", "waterheater"] },
  { phrase: /\bfaucet\b/i, keys: ["faucet"] },
  { phrase: /\bdrain\b|\bclog/i, keys: ["drain", "clog", "clogged"] },
  { phrase: /\bleak(?:ing|ed|s)?\b/i, keys: ["leak", "leaking", "leaked"] },
  {
    phrase: /\bhvac\b|\bair\s*condition|\bcompressor\b/i,
    keys: ["hvac", "air condition", "compressor", "a/c"],
  },
  {
    phrase: /\boutlet\b|\bbreaker\b|\bpanel\b/i,
    keys: ["outlet", "breaker", "panel", "electrical"],
  },
  {
    phrase: /\brefrigerator\b|\bdishwasher\b|\bstove\b|\bwashing\s*machine\b/i,
    keys: ["refrigerator", "dishwasher", "stove", "washing machine"],
  },
]

function jobMatchesIssueHints(job: VendorActiveJob, body: string): boolean {
  // Prefer description text for distinctive matching; category alone is too broad.
  const desc = (job.description ?? "").toLowerCase()
  const hay = `${desc} ${(job.issueCategory ?? "").toLowerCase()}`.trim()
  if (!hay) return false

  for (const { phrase, keys } of ISSUE_PHRASES) {
    if (!phrase.test(body)) continue
    if (keys.some((k) => hay.includes(k) || desc.includes(k))) return true
  }

  const bodyTokens = tokenizeIssueText(body).filter((t) =>
    !["repair", "repairs", "complete", "finished", "approval", "need", "needs", "extra", "parts"]
      .includes(t)
  )
  const jobTokens = new Set(tokenizeIssueText(desc || hay))
  let hits = 0
  for (const t of bodyTokens) {
    if (jobTokens.has(t)) hits += 1
  }
  // Distinctive multi-token overlap (e.g. "faucet repair" → faucet)
  return hits >= 1 && bodyTokens.some((t) => jobTokens.has(t) && t.length >= 5)
}

function jobMatchesBuilding(job: VendorActiveJob, body: string): boolean {
  const building = (job.building ?? "").trim().toLowerCase()
  if (building.length < 3) return false
  const normalizedBody = body.toLowerCase()
  if (normalizedBody.includes(building)) return true
  // First significant word of building name (e.g. "Oakwood")
  const first = building.split(/\s+/)[0] ?? ""
  return first.length >= 4 && normalizedBody.includes(first)
}

/**
 * High-confidence match only. Never returns a unique hit from weak/"latest" signals.
 */
export function matchActiveJobsFromReply(
  body: string,
  jobs: VendorActiveJob[],
): JobMatchResult {
  if (jobs.length === 0) return { kind: "none" }
  if (jobs.length === 1) {
    return { kind: "unique", job: jobs[0], boundBy: "single_open_job" }
  }

  const matchedIds = new Set<string>()
  let boundBy = "context"

  const woRef = extractWorkOrderRefFromSms(body)
  if (woRef) {
    const woHits = jobs.filter((j) => workOrderRefMatchesTicket(woRef, j.ticketId))
    if (woHits.length === 1) {
      return { kind: "unique", job: woHits[0], boundBy: "wo_ref" }
    }
    if (woHits.length > 1) return { kind: "ambiguous", jobs: woHits }
    // Unknown WO among open jobs — fall through to other signals / clarify
  }

  const unitHints = extractUnitHintsFromSms(body)
  if (unitHints.length > 0) {
    const unitHits = jobs.filter((j) => {
      const key = normalizeUnitKey(j.unit)
      return key.length > 0 && unitHints.includes(key)
    })
    if (unitHits.length === 1) {
      return { kind: "unique", job: unitHits[0], boundBy: "unit" }
    }
    for (const j of unitHits) matchedIds.add(j.ticketId)
    if (unitHits.length > 0) boundBy = "unit"
  }

  const buildingHits = jobs.filter((j) => jobMatchesBuilding(j, body))
  if (buildingHits.length === 1 && matchedIds.size === 0) {
    return { kind: "unique", job: buildingHits[0], boundBy: "building" }
  }
  for (const j of buildingHits) matchedIds.add(j.ticketId)

  const issueHits = jobs.filter((j) => jobMatchesIssueHints(j, body))
  if (issueHits.length === 1 && matchedIds.size === 0) {
    return { kind: "unique", job: issueHits[0], boundBy: "issue" }
  }
  for (const j of issueHits) matchedIds.add(j.ticketId)
  if (issueHits.length > 0) boundBy = "issue"

  if (matchedIds.size === 1) {
    const job = jobs.find((j) => matchedIds.has(j.ticketId))
    if (job) return { kind: "unique", job, boundBy }
  }
  if (matchedIds.size > 1) {
    return {
      kind: "ambiguous",
      jobs: jobs.filter((j) => matchedIds.has(j.ticketId)),
    }
  }

  return { kind: "none" }
}

/**
 * Resolve a clarification reply (1, WO-XXXX, Unit 101, leaking faucet, …)
 * against the pending candidate list.
 */
export function resolveClarificationSelection(
  body: string,
  pending: VendorWorkOrderClarification,
  jobs: VendorActiveJob[],
): string | null {
  const candidates = jobs.filter((j) =>
    pending.candidateWorkOrderIds.includes(j.ticketId)
  )
  const pool = candidates.length > 0 ? candidates : jobs

  const numbered = body.trim().match(/^(\d{1,2})\s*[.)]?\s*$/)
  if (numbered) {
    const n = Number(numbered[1])
    if (n >= 1 && n <= pool.length) return pool[n - 1].ticketId
  }

  const match = matchActiveJobsFromReply(body, pool)
  if (match.kind === "unique") return match.job.ticketId
  return null
}

export async function listVendorActiveJobs(
  supabase: SupabaseClient,
  vendorId: string,
): Promise<VendorActiveJob[]> {
  const { data, error } = await supabase
    .from("maintenance_requests")
    .select("id, unit, building, issue_category, description, created_at")
    .eq("assigned_vendor_id", vendorId)
    .in("vendor_work_status", [...OPEN_STATUSES])
    .order("created_at", { ascending: false })
    .limit(20)

  if (error) {
    console.error("[vendor-wo-clarify] listVendorActiveJobs", error.message)
    return []
  }

  return ((data ?? []) as Array<Record<string, unknown>>).map((row) => {
    const id = String(row.id)
    return {
      ticketId: id,
      workOrderRef: formatWorkOrderRef(id),
      unit: typeof row.unit === "string" && row.unit.trim() ? row.unit.trim() : null,
      building:
        typeof row.building === "string" && row.building.trim()
          ? row.building.trim()
          : null,
      issueCategory:
        typeof row.issue_category === "string" && row.issue_category.trim()
          ? row.issue_category.trim()
          : null,
      description:
        typeof row.description === "string" && row.description.trim()
          ? row.description.trim()
          : null,
    }
  })
}
