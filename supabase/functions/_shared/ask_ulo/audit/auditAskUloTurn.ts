/**
 * Pipeline stage: audit one Ask Ulo turn after validation.
 *
 * Maps the validated answer bag → one AskUloAuditRecord → persist
 * (turns / evals / operations graph). Persistence lives in writeAskUloAuditRecord.
 *
 * Prefer this name over writeAuditRecord (shim).
 */

import { summarizeEvidencePacket } from "../retrieval/buildEvidencePacket.ts"
import type { AskUloContext } from "../core/context.ts"
import type { AskUloTurnPlan } from "../routing/planAskUloTurn.ts"
import type { AskUloSafetyContinue } from "../guards/runSafetyChecks.ts"
import type { AskUloValidatedAnswer } from "../core/pipelineTypes.ts"
import type { QualityCheckResult } from "../quality/validateFinalAnswer.ts"
import {
  deriveAskUloRefusalReason,
  deriveAskUloResponseStatus,
  writeAskUloAuditRecord,
  type AskUloAuditEvidenceUsed,
} from "./writeAskUloAuditRecord.ts"

function toolsSelectedFromRoute(route: AskUloTurnPlan): string[] {
  const fromDecision = route.decision?.tools
  if (Array.isArray(fromDecision) && fromDecision.length) {
    return fromDecision.map(String)
  }
  const planned = route.plannedTools ?? []
  if (planned.length) return planned.map((t) => t.name)
  return (route.ruleToolPlan ?? []).map((t) => t.name)
}

function evidenceUsedFromBags(
  evidence: unknown,
  answer: AskUloValidatedAnswer,
): AskUloAuditEvidenceUsed {
  const e = evidence as Record<string, unknown> | null
  const packet = e?.evidencePacket
  const citationCount = answer.synthesis?.citations?.length ?? 0
  const packetSummary =
    packet && typeof packet === "object"
      ? summarizeEvidencePacket(packet as Parameters<typeof summarizeEvidencePacket>[0])
      : undefined
  return {
    hasEvidence: citationCount > 0 || Boolean(packet),
    citationCount,
    retrievalCacheHit: Boolean(answer.retrievalCacheHit),
    packetSummary,
  }
}

function routeAuditFields(route: AskUloTurnPlan): Record<string, unknown> {
  const capability = route.capability
  const playbook = route.playbook
  return {
    subject: route.subject ?? null,
    capability: capability?.capability ?? null,
    capability_confidence: capability?.confidence ?? null,
    playbook_id: playbook?.id ?? null,
    playbook_label: playbook?.label ?? null,
    tool_select_source: route.toolSelectSource ?? null,
    used_rule_backup: Boolean(route.usedRuleBackup),
    no_tool_matched: Boolean(route.noToolMatched),
    required_tools: route.requiredTools ?? [],
    planned_tools: (route.plannedTools ?? []).map((t) => t.name),
  }
}

/**
 * Final pipeline stage: record question, route, evidence, refuse/clarify/fallback,
 * quality checks, and graph event for this turn.
 */
export async function auditAskUloTurn(input: {
  context: AskUloContext
  route: AskUloTurnPlan
  evidence: unknown
  answer: AskUloValidatedAnswer
  safety: AskUloSafetyContinue
}): Promise<void> {
  const { context, answer, route, evidence, safety } = input
  const a = answer as Record<string, any>
  const synthesis = a.synthesis
  const toolsUsed = [...(a.toolsUsed as string[])]
  const intentResult = route.intentResult
  const qualityReport = a.qualityReport as {
    checks?: unknown[]
    summaryLine?: string | null
    block?: unknown
  }
  const postAnswer = a.postAnswerReport as
    | {
        faithfulness?: { pass?: boolean; score?: number | null }
        completeness?: { pass?: boolean }
        privacy?: {
          pass?: boolean
          failClosed?: boolean
          redactedAnswer?: string
        }
        confidence?: { pass?: boolean; summary?: string }
        jurisdiction?: { pass?: boolean }
        failClosed?: boolean
        block?: string | null
      }
    | undefined
  const preferredEvidence = a.preferredEvidence ?? synthesis?.preferredEvidence
  const preferPacketUsed = Boolean(
    preferredEvidence?.prefer ||
      preferredEvidence?.shortCircuit ||
      (toolsUsed as string[]).some((t) => t.startsWith("prefer_packet:")),
  )
  const refused = Boolean(a.refused)
  const clarified = Boolean(a.clarified)
  const responseStatus = deriveAskUloResponseStatus({ refused, clarified })
  const refusalReason = deriveAskUloRefusalReason({
    responseStatus,
    qualitySummary: qualityReport?.summaryLine ?? null,
    gateStatus: a.gateStatus != null ? String(a.gateStatus) : null,
  })

  const sensitiveTopics = (a.sensitiveTopics ??
    safety.sensitiveTopics) as Array<{ id: string }>
  const fairHousingSafety = a.fairHousingSafety ?? safety.fairHousingSafety
  const humanDecisionSafety =
    a.humanDecisionSafety ?? safety.humanDecisionSafety
  const jurisdiction = a.jurisdiction
  const sourceTierCounts = a.sourceTierCounts ?? {
    primaryOfficial: 0,
    agencyGuidance: 0,
    discoveryMirror: 0,
  }
  const faithfulness = a.faithfulness ?? { score: null, detail: { notes: [] } }

  const result = await writeAskUloAuditRecord(context.supabase, {
    landlordId: context.landlordId,
    conversationId: context.conversationId,
    question: context.question,
    answer: a.answerWithSources as string,
    intent: intentResult.intent,
    intentConfidence: intentResult.confidence,
    agentMode: context.agentMode,
    toolsSelected: toolsSelectedFromRoute(route),
    toolsUsed,
    evidenceUsed: evidenceUsedFromBags(evidence, answer),
    refusalReason,
    responseStatus,
    citations: synthesis?.citations ?? [],
    model: synthesis?.model ?? null,
    mode: synthesis?.mode ?? null,
    eval: {
      gateStatus: a.gateStatus ?? null,
      refused,
      clarified,
      requireCounsel: Boolean(a.requireCounsel),
      knownUnknown: Boolean(a.knownUnknown),
      qualityChecks: (qualityReport?.checks ?? []) as QualityCheckResult[],
      qualitySummary: qualityReport?.summaryLine ?? null,
      stateCode: jurisdiction?.stateCode ?? null,
      countySlug: jurisdiction?.countySlug ?? null,
      citySlug: jurisdiction?.citySlug ?? null,
      housingProgram: jurisdiction?.housingProgram ?? null,
      sensitiveTopicIds: sensitiveTopics.map((t) => t.id),
      fairHousingFlags: (fairHousingSafety?.flags ?? []).map(
        (f: { id: string }) => f.id,
      ),
      humanDecisionFlags: (humanDecisionSafety?.flags ?? []).map(
        (f: { id: string }) => f.id,
      ),
      primaryOfficialCount: sourceTierCounts.primaryOfficial ?? 0,
      agencyGuidanceCount: sourceTierCounts.agencyGuidance ?? 0,
      discoveryMirrorCount: sourceTierCounts.discoveryMirror ?? 0,
      retrievalCacheHit: Boolean(a.retrievalCacheHit),
      answerConfidence: a.answerConfidence ?? null,
      faithfulnessScore: faithfulness.score ?? null,
      faithfulnessDetail: faithfulness.detail ?? { notes: [] },
      latencyMs: a.latencyMs ?? null,
      synthesizeMs: synthesis?.synthesizeMs ?? null,
      promptTokens: a.promptTokens ?? null,
      completionTokens: a.completionTokens ?? null,
      embedTokens: a.embedTokens || null,
    },
    graphMetadata: {
      ...routeAuditFields(route),
      synthesis_mode: synthesis?.mode ?? null,
      prefer_packet: preferPacketUsed,
      history_turns: context.history.length,
      country_code: jurisdiction?.countryCode ?? null,
      state_code: jurisdiction?.stateCode ?? null,
      county_slug: jurisdiction?.countySlug ?? null,
      city_slug: jurisdiction?.citySlug ?? null,
      court_system: jurisdiction?.courtSystem ?? null,
      housing_program: jurisdiction?.housingProgram ?? null,
      code_set: jurisdiction?.codeSet ?? null,
      legal_gate: a.legalGate?.status ?? null,
      legal_jurisdiction_source: a.legalResolution?.source ?? null,
      legal_jurisdiction_confidence: a.legalResolution?.confidence ?? null,
      legal_sensitive_topics: sensitiveTopics.map((t) => t.id),
      legal_require_counsel: Boolean(a.requireCounsel),
      fair_housing_refuse_decision: fairHousingSafety?.refuseDecision ?? false,
      fair_housing_flags: (fairHousingSafety?.flags ?? []).map(
        (f: { id: string }) => f.id,
      ),
      human_decision_refuse: humanDecisionSafety?.refuseDecision ?? false,
      human_decision_flags: (humanDecisionSafety?.flags ?? []).map(
        (f: { id: string }) => f.id,
      ),
      privacy_screening_isolation: Boolean(a.screeningIsolation),
      legal_primary_official: sourceTierCounts.primaryOfficial ?? 0,
      legal_agency_guidance: sourceTierCounts.agencyGuidance ?? 0,
      legal_discovery_mirror: sourceTierCounts.discoveryMirror ?? 0,
      legal_pending_ordinances: a.legal?.pendingOrdinanceCount ?? 0,
      legal_recommended_expert: a.recommendedExpertId ?? null,
      legal_answer_confidence: a.answerConfidence ?? null,
      legal_sources_used_count: Array.isArray(a.sourcesUsed)
        ? a.sourcesUsed.length
        : 0,
      quality_gate: qualityReport?.summaryLine ?? null,
      quality_gate_block: qualityReport?.block ?? null,
      post_answer_faithfulness_ok: postAnswer?.faithfulness?.pass ?? null,
      post_answer_completeness_ok: postAnswer?.completeness?.pass ?? null,
      post_answer_privacy_ok: postAnswer?.privacy?.pass ?? null,
      post_answer_privacy_fail_closed: postAnswer?.privacy?.failClosed ?? null,
      post_answer_privacy_soft_redacted: Boolean(postAnswer?.privacy?.redactedAnswer),
      post_answer_confidence_ok: postAnswer?.confidence?.pass ?? null,
      post_answer_jurisdiction_ok: postAnswer?.jurisdiction?.pass ?? null,
      post_answer_fail_closed: postAnswer?.failClosed ?? null,
      post_answer_block: postAnswer?.block ?? null,
      retrieval_cache_hit: Boolean(a.retrievalCacheHit),
      latency_ms: a.latencyMs ?? null,
      synthesize_ms: synthesis?.synthesizeMs ?? null,
      prompt_tokens: a.promptTokens ?? null,
      completion_tokens: a.completionTokens ?? null,
      embed_tokens: a.embedTokens || null,
      faithfulness_score: faithfulness.score ?? null,
      known_unknown: Boolean(a.knownUnknown),
      refused,
      clarified,
    },
  })

  a.response.toolsUsed = result.toolsUsed
  if (result.evalId) a.response.evalId = result.evalId
}

/** @deprecated Prefer auditAskUloTurn */
export const writeAuditRecord = auditAskUloTurn
