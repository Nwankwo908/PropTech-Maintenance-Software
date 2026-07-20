/**
 * Persist Ask Ulo continuous-eval rows (quality, faithfulness, latency, cost, feedback).
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { logGraphEvent } from "../graph/logGraphEvent.ts"
import type { QualityCheckResult } from "./answerQualityGate.ts"
import {
  assessFaithfulness,
  type FaithfulnessDetail,
} from "./faithfulnessCheck.ts"
import type { AskUloCitation } from "./opsGraphLookup.ts"
import {
  extractAskUloFailureTags,
  formatFailureTagsSummary,
  type AskUloFailureTag,
} from "./failureTags.ts"

export type { AskUloFailureTag }
export { extractAskUloFailureTags, formatFailureTagsSummary }

/** Approximate OpenAI list prices (USD per 1M tokens) for cost dashboards. */
const COST_PER_1M = {
  gpt4oInput: 2.5,
  gpt4oOutput: 10,
  embedSmall: 0.02,
} as const

export type AskUloHumanOverrideReason =
  | "wrong_location"
  | "bad_citation"
  | "unsupported_claim"
  | "should_have_escalated"
  | "outdated"
  | "unhelpful"
  | "other"

export const ASK_ULO_OVERRIDE_REASONS: AskUloHumanOverrideReason[] = [
  "wrong_location",
  "bad_citation",
  "unsupported_claim",
  "should_have_escalated",
  "outdated",
  "unhelpful",
  "other",
]

export function parseHumanOverrideReason(
  raw: string | null | undefined,
): AskUloHumanOverrideReason | null {
  const v = (raw ?? "").trim()
  return (ASK_ULO_OVERRIDE_REASONS as string[]).includes(v)
    ? (v as AskUloHumanOverrideReason)
    : null
}

export type AskUloEvalInsert = {
  landlordId: string
  conversationId?: string | null
  turnId?: string | null
  questionExcerpt: string
  intent: string
  mode: string | null
  model: string | null
  gateStatus: "ok" | "clarify" | "refuse" | null
  refused: boolean
  clarified: boolean
  requireCounsel: boolean
  knownUnknown: boolean
  qualityChecks: QualityCheckResult[]
  qualitySummary: string | null
  stateCode: string | null
  countySlug: string | null
  citySlug: string | null
  housingProgram: string | null
  sensitiveTopicIds: string[]
  fairHousingFlags: string[]
  humanDecisionFlags: string[]
  citationCount: number
  primaryOfficialCount: number
  agencyGuidanceCount: number
  discoveryMirrorCount: number
  retrievalCacheHit: boolean
  answerConfidence: string | null
  faithfulnessScore: number | null
  faithfulnessDetail: FaithfulnessDetail | Record<string, unknown>
  latencyMs: number | null
  embedMs?: number | null
  retrieveMs?: number | null
  synthesizeMs?: number | null
  promptTokens?: number | null
  completionTokens?: number | null
  embedTokens?: number | null
  estimatedCostUsd?: number | null
  /** Structured routing / gap failure tags for feedback loops. */
  failureTags?: AskUloFailureTag[]
}

function checkStatus(
  checks: QualityCheckResult[],
  id: string,
): string | null {
  return checks.find((c) => c.id === id)?.status ?? null
}

export function estimateAskUloCostUsd(input: {
  promptTokens?: number | null
  completionTokens?: number | null
  embedTokens?: number | null
}): number {
  const prompt = input.promptTokens ?? 0
  const completion = input.completionTokens ?? 0
  const embed = input.embedTokens ?? 0
  const usd =
    (prompt / 1_000_000) * COST_PER_1M.gpt4oInput +
    (completion / 1_000_000) * COST_PER_1M.gpt4oOutput +
    (embed / 1_000_000) * COST_PER_1M.embedSmall
  return Math.round(usd * 1_000_000) / 1_000_000
}

/** Rough token estimate when the provider omits usage. */
export function estimateTokensFromText(text: string): number {
  const t = text.trim()
  if (!t) return 0
  return Math.max(1, Math.ceil(t.length / 4))
}

export function buildFaithfulnessForEval(input: {
  intent: string
  answer: string
  citations: AskUloCitation[]
  gateStatus: "ok" | "clarify" | "refuse" | null
  knownUnknown: boolean
}): { score: number | null; detail: FaithfulnessDetail } {
  return assessFaithfulness(input)
}

export async function insertAskUloEval(
  supabase: SupabaseClient,
  row: AskUloEvalInsert,
): Promise<string | null> {
  const cost =
    row.estimatedCostUsd ??
    estimateAskUloCostUsd({
      promptTokens: row.promptTokens,
      completionTokens: row.completionTokens,
      embedTokens: row.embedTokens,
    })

  const failureTags = row.failureTags ?? []
  const failureSummary = formatFailureTagsSummary(failureTags)
  const qualitySummary = failureSummary
    ? `${failureSummary} ${row.qualitySummary ?? ""}`.trim()
    : row.qualitySummary

  const faithfulnessDetail: Record<string, unknown> = {
    ...(row.faithfulnessDetail && typeof row.faithfulnessDetail === "object"
      ? (row.faithfulnessDetail as Record<string, unknown>)
      : {}),
    ...(failureTags.length ? { failure_tags: failureTags } : {}),
  }

  const { data, error } = await supabase
    .from("ask_ulo_evals")
    .insert({
      landlord_id: row.landlordId,
      conversation_id: row.conversationId ?? null,
      turn_id: row.turnId ?? null,
      question_excerpt: row.questionExcerpt.slice(0, 500),
      intent: row.intent,
      mode: row.mode,
      model: row.model,
      gate_status: row.gateStatus,
      refused: row.refused,
      clarified: row.clarified,
      require_counsel: row.requireCounsel,
      known_unknown: row.knownUnknown,
      location_status: checkStatus(row.qualityChecks, "location"),
      topic_status: checkStatus(row.qualityChecks, "topic"),
      scope_status: checkStatus(row.qualityChecks, "scope"),
      sources_status: checkStatus(row.qualityChecks, "sources"),
      grounding_status: checkStatus(row.qualityChecks, "grounding"),
      safety_qc_status: checkStatus(row.qualityChecks, "safety_qc"),
      quality_summary: qualitySummary,
      quality_checks: row.qualityChecks,
      state_code: row.stateCode,
      county_slug: row.countySlug,
      city_slug: row.citySlug,
      housing_program: row.housingProgram,
      sensitive_topic_ids: row.sensitiveTopicIds,
      fair_housing_flags: row.fairHousingFlags,
      human_decision_flags: row.humanDecisionFlags,
      citation_count: row.citationCount,
      primary_official_count: row.primaryOfficialCount,
      agency_guidance_count: row.agencyGuidanceCount,
      discovery_mirror_count: row.discoveryMirrorCount,
      retrieval_cache_hit: row.retrievalCacheHit,
      answer_confidence: row.answerConfidence,
      faithfulness_score: row.faithfulnessScore,
      faithfulness_detail: faithfulnessDetail,
      latency_ms: row.latencyMs,
      embed_ms: row.embedMs ?? null,
      retrieve_ms: row.retrieveMs ?? null,
      synthesize_ms: row.synthesizeMs ?? null,
      prompt_tokens: row.promptTokens ?? null,
      completion_tokens: row.completionTokens ?? null,
      embed_tokens: row.embedTokens ?? null,
      estimated_cost_usd: cost > 0 ? cost : null,
    })
    .select("id")
    .maybeSingle()

  if (error) {
    console.error("[ask_ulo/eval] insert failed", error.message)
    return null
  }
  return typeof data?.id === "string" ? data.id : null
}

export async function recordAskUloFeedback(
  supabase: SupabaseClient,
  input: {
    evalId: string
    landlordId: string
    rating: "up" | "down"
    overrideReason?: string | null
    note?: string | null
    conversationId?: string | null
    messageId?: string | null
  },
): Promise<{ ok: true; evalId: string } | { ok: false; error: string }> {
  const evalId = input.evalId.trim()
  const landlordId = input.landlordId.trim()
  if (!evalId) return { ok: false, error: "evalId is required" }
  if (!landlordId) return { ok: false, error: "landlordId is required" }
  if (input.rating !== "up" && input.rating !== "down") {
    return { ok: false, error: "rating must be up or down" }
  }

  const reason =
    input.rating === "down"
      ? parseHumanOverrideReason(input.overrideReason)
      : null

  const { data: existing, error: findErr } = await supabase
    .from("ask_ulo_evals")
    .select("id, landlord_id, faithfulness_detail, quality_summary")
    .eq("id", evalId)
    .maybeSingle()

  if (findErr) {
    console.error("[ask_ulo/eval] feedback lookup failed", findErr.message)
    return { ok: false, error: "Eval lookup failed" }
  }
  if (!existing || existing.landlord_id !== landlordId) {
    return { ok: false, error: "Eval not found" }
  }

  const detail =
    existing.faithfulness_detail &&
    typeof existing.faithfulness_detail === "object" &&
    !Array.isArray(existing.faithfulness_detail)
      ? (existing.faithfulness_detail as Record<string, unknown>)
      : {}
  const failureTags = Array.isArray(detail.failure_tags)
    ? detail.failure_tags.filter((t): t is string => typeof t === "string")
    : []

  const { error: updErr } = await supabase
    .from("ask_ulo_evals")
    .update({
      human_rating: input.rating,
      human_override_reason: reason,
      human_override_note: input.note?.trim()?.slice(0, 500) || null,
      human_rated_at: new Date().toISOString(),
    })
    .eq("id", evalId)
    .eq("landlord_id", landlordId)

  if (updErr) {
    console.error("[ask_ulo/eval] feedback update failed", updErr.message)
    return { ok: false, error: "Failed to save feedback" }
  }

  console.log(
    "ASK_ULO_FEEDBACK_LOOP",
    JSON.stringify({
      eval_id: evalId,
      rating: input.rating,
      override_reason: reason,
      failure_tags: failureTags,
    }),
  )

  await logGraphEvent(supabase, {
    landlord_id: landlordId,
    event_type: "ask_ulo.feedback",
    source: "dashboard",
    actor_type: "landlord",
    metadata: {
      eval_id: evalId,
      rating: input.rating,
      override_reason: reason,
      note: input.note?.trim()?.slice(0, 500) || null,
      ask_ulo_conversation_id: input.conversationId?.trim() || null,
      ask_ulo_message_id: input.messageId?.trim() || null,
      failure_tags: failureTags,
    },
  })

  return { ok: true, evalId }
}

export async function markEvalCounselHandoff(
  supabase: SupabaseClient,
  input: { evalId: string | null | undefined; landlordId: string },
): Promise<void> {
  const evalId = input.evalId?.trim()
  if (!evalId) return
  const { error } = await supabase
    .from("ask_ulo_evals")
    .update({ counsel_handoff_at: new Date().toISOString() })
    .eq("id", evalId)
    .eq("landlord_id", input.landlordId.trim())
  if (error) {
    console.error("[ask_ulo/eval] counsel handoff mark failed", error.message)
  }
}
