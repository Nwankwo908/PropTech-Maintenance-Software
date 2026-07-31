/**
 * One audit contract for Ask Ulo turns.
 *
 * Core flow should call this once at the end — not scatter console.log /
 * insertGraphEvent / saveEvaluation across stages.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { logAskUloGraphEvent } from "./logGraphEvent.ts"
import { logFailureTags } from "./logDecision.ts"
import {
  extractAskUloFailureTags,
  insertAskUloEval,
  type AskUloEvalInsert,
} from "./buildAuditRecord.ts"
import type { QualityCheckResult } from "../quality/validateFinalAnswer.ts"
import type { FaithfulnessDetail } from "../quality/checkFaithfulness.ts"

export type AskUloResponseStatus =
  | "answered"
  | "refused"
  | "clarified"
  | "blocked"

export type AskUloAuditEvidenceUsed = {
  hasEvidence: boolean
  citationCount: number
  findingCounts?: Record<string, number>
  packetSummary?: Record<string, unknown>
  retrievalCacheHit?: boolean
}

/**
 * Canonical audit payload — keep analytics keyed off these fields.
 */
export type AskUloAuditRecord = {
  landlordId: string
  conversationId?: string | null
  question: string
  answer: string
  intent: string
  /** Classifier confidence — often a label (`high`/`medium`/`low`) or a score. */
  intentConfidence?: string | number | null
  agentMode?: string | null
  /** Tools chosen by the router / tool select. */
  toolsSelected: string[]
  /** Tools actually invoked + quality tags (mutated with eval:/latency). */
  toolsUsed: string[]
  evidenceUsed: AskUloAuditEvidenceUsed
  refusalReason?: string | null
  responseStatus: AskUloResponseStatus
  /** Citations persisted on the turn row. */
  citations?: unknown[]
  model?: string | null
  mode?: string | null
  /** Extra eval / graph fields (optional). */
  eval?: Partial<AskUloEvalInsert> & {
    qualityChecks?: QualityCheckResult[]
    qualitySummary?: string | null
    faithfulnessScore?: number | null
    faithfulnessDetail?: FaithfulnessDetail | Record<string, unknown>
    latencyMs?: number | null
    synthesizeMs?: number | null
    promptTokens?: number | null
    completionTokens?: number | null
    embedTokens?: number | null
  }
  graphMetadata?: Record<string, unknown>
}

export type AskUloAuditWriteResult = {
  turnId: string | null
  evalId: string | null
  toolsUsed: string[]
}

export function deriveAskUloResponseStatus(input: {
  refused?: boolean
  clarified?: boolean
  blocked?: boolean
}): AskUloResponseStatus {
  if (input.blocked) return "blocked"
  if (input.refused) return "refused"
  if (input.clarified) return "clarified"
  return "answered"
}

export function deriveAskUloRefusalReason(input: {
  responseStatus: AskUloResponseStatus
  qualitySummary?: string | null
  gateStatus?: string | null
  safetyKind?: string | null
}): string | null {
  if (input.responseStatus === "answered") return null
  if (input.safetyKind) return input.safetyKind
  if (input.qualitySummary) return input.qualitySummary
  if (input.gateStatus) return input.gateStatus
  return input.responseStatus
}

function responseStatusToFlags(status: AskUloResponseStatus): {
  refused: boolean
  clarified: boolean
  knownUnknown: boolean
  eventType: "ask_ulo.answered" | "ask_ulo.refused" | "ask_ulo.clarified"
} {
  if (status === "refused" || status === "blocked") {
    return {
      refused: true,
      clarified: false,
      knownUnknown: true,
      eventType: "ask_ulo.refused",
    }
  }
  if (status === "clarified") {
    return {
      refused: false,
      clarified: true,
      knownUnknown: true,
      eventType: "ask_ulo.clarified",
    }
  }
  return {
    refused: false,
    clarified: false,
    knownUnknown: false,
    eventType: "ask_ulo.answered",
  }
}

/**
 * Persist turn + eval + graph event from one structured audit record.
 */
export async function writeAskUloAuditRecord(
  supabase: SupabaseClient,
  record: AskUloAuditRecord,
): Promise<AskUloAuditWriteResult> {
  const toolsUsed = [...record.toolsUsed]
  const flags = responseStatusToFlags(record.responseStatus)
  const failureTags = extractAskUloFailureTags(toolsUsed)

  if (failureTags.length) {
    logFailureTags({
      tags: failureTags,
      intent: record.intent,
      refusalReason: record.refusalReason ?? null,
      responseStatus: record.responseStatus,
    })
  }

  let turnId: string | null = null
  {
    const { data: turnRow, error: turnErr } = await supabase
      .from("ask_ulo_turns")
      .insert({
        landlord_id: record.landlordId,
        question: record.question,
        answer: record.answer,
        citations: record.citations ?? [],
        tools_used: toolsUsed,
        model: record.model ?? null,
      })
      .select("id")
      .maybeSingle()
    if (turnErr) {
      console.error("[ask_ulo] ask_ulo_turns insert failed", turnErr.message)
    } else if (typeof turnRow?.id === "string") {
      turnId = turnRow.id
    }
  }

  const evalExtra = record.eval ?? {}
  const evalId = await insertAskUloEval(supabase, {
    landlordId: record.landlordId,
    conversationId: record.conversationId ?? null,
    turnId,
    questionExcerpt: record.question,
    intent: record.intent,
    mode: record.mode ?? null,
    model: record.model ?? null,
    gateStatus: (evalExtra.gateStatus as AskUloEvalInsert["gateStatus"]) ?? null,
    refused: flags.refused || Boolean(evalExtra.refused),
    clarified: flags.clarified || Boolean(evalExtra.clarified),
    requireCounsel: Boolean(evalExtra.requireCounsel),
    knownUnknown: flags.knownUnknown || Boolean(evalExtra.knownUnknown),
    qualityChecks: evalExtra.qualityChecks ?? [],
    qualitySummary: evalExtra.qualitySummary ?? null,
    stateCode: evalExtra.stateCode ?? null,
    countySlug: evalExtra.countySlug ?? null,
    citySlug: evalExtra.citySlug ?? null,
    housingProgram: evalExtra.housingProgram ?? null,
    sensitiveTopicIds: evalExtra.sensitiveTopicIds ?? [],
    fairHousingFlags: evalExtra.fairHousingFlags ?? [],
    humanDecisionFlags: evalExtra.humanDecisionFlags ?? [],
    citationCount: record.evidenceUsed.citationCount,
    primaryOfficialCount: evalExtra.primaryOfficialCount ?? 0,
    agencyGuidanceCount: evalExtra.agencyGuidanceCount ?? 0,
    discoveryMirrorCount: evalExtra.discoveryMirrorCount ?? 0,
    retrievalCacheHit: Boolean(
      record.evidenceUsed.retrievalCacheHit ?? evalExtra.retrievalCacheHit,
    ),
    answerConfidence: evalExtra.answerConfidence ?? null,
    faithfulnessScore: evalExtra.faithfulnessScore ?? null,
    faithfulnessDetail: evalExtra.faithfulnessDetail ?? { notes: [] },
    latencyMs: evalExtra.latencyMs ?? null,
    synthesizeMs: evalExtra.synthesizeMs ?? null,
    promptTokens: evalExtra.promptTokens ?? null,
    completionTokens: evalExtra.completionTokens ?? null,
    embedTokens: evalExtra.embedTokens ?? null,
    failureTags,
  })

  if (evalId) toolsUsed.push(`eval:${evalId}`)
  if (evalExtra.latencyMs != null) toolsUsed.push(`latency_ms:${evalExtra.latencyMs}`)
  if (evalExtra.faithfulnessScore != null) {
    toolsUsed.push(`faithfulness:${evalExtra.faithfulnessScore}`)
  }

  await logAskUloGraphEvent(supabase, {
    landlordId: record.landlordId,
    eventType: flags.eventType,
    metadata: {
      question: record.question.slice(0, 500),
      intent: record.intent,
      intent_confidence: record.intentConfidence ?? null,
      agent_mode: record.agentMode ?? null,
      tools_selected: record.toolsSelected,
      tools_used: toolsUsed,
      evidence_used: record.evidenceUsed,
      refusal_reason: record.refusalReason ?? null,
      response_status: record.responseStatus,
      mode: record.mode ?? null,
      model: record.model ?? null,
      citation_count: record.evidenceUsed.citationCount,
      conversation_id: record.conversationId ?? null,
      eval_id: evalId,
      turn_id: turnId,
      ...(record.graphMetadata ?? {}),
    },
  })

  return { turnId, evalId, toolsUsed }
}
