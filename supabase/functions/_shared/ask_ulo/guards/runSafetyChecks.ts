/**
 * Hard safety gates (action boundary, Fair Housing block) + soft counsel annotations.
 * Called only from the Safety stage (`checkSafetyRules` → `runGuards`).
 * Downstream stages must consume `AskUloSafetyContinue` — do not re-detect.
 */

import type { AskUloContext } from "../core/context.ts"
import { jurisdictionFromPortfolio } from "../core/context.ts"
import type { AskUloResponse } from "../core/types.ts"
import { logEpistemicBucket } from "../audit/logToolCalls.ts"
import {
  deriveAskUloRefusalReason,
  writeAskUloAuditRecord,
} from "../audit/writeAskUloAuditRecord.ts"
import {
  detectAskUloActionBoundary,
  formatActionBoundaryMarkdown,
} from "./actionBoundary.ts"
import {
  detectFairHousingSafety,
  formatFairHousingBlockMarkdown,
  formatFairHousingRefuseDecisionNote,
  type FairHousingSafety,
} from "./fairHousingSafety.ts"
import {
  detectHumanDecisionSafety,
  formatHumanDecisionRefuseNote,
  type HumanDecisionSafety,
} from "./humanDecisionSafety.ts"
import {
  detectLegalSensitiveTopics,
  formatSensitiveCounselNote,
  isScreeningPrivacyTopic,
  type LegalSensitiveTopic,
} from "../quality/legalSensitiveTopics.ts"
import { classifyEpistemicAsk } from "../routing/epistemicBucket.ts"
import { classifyAskUloIntent } from "../routing/detectIntent.ts"
import { applyAskUloAgentModeBias } from "../routing/selectMode.ts"
import type { AskUloClassification } from "../routing/classifyQuestion.ts"

export type AskUloSafetyContinue = {
  blocked: false
  fairHousingSafety: FairHousingSafety
  humanDecisionSafety: HumanDecisionSafety
  sensitiveTopics: LegalSensitiveTopic[]
  screeningIsolation: boolean
  requireCounsel: boolean
  counselNote: string | null
}

export type AskUloSafetyResult =
  | { blocked: true; response: AskUloResponse }
  | AskUloSafetyContinue

export async function runSafetyChecks(
  context: AskUloContext,
  classification?: AskUloClassification,
): Promise<AskUloSafetyResult> {
  const {
    supabase,
    question,
    landlordId,
    agentMode,
    history,
    conversationId,
    startedAt,
    priorUserTurns,
    portfolioJurisdiction,
  } = context

  const intentResult =
    classification?.intentResult ??
    applyAskUloAgentModeBias(
      classifyAskUloIntent(question, priorUserTurns),
      agentMode,
    )
  const earlyJurisdiction = jurisdictionFromPortfolio(portfolioJurisdiction)

  const actionBoundary = detectAskUloActionBoundary(question)
  const fairHousingSafety = detectFairHousingSafety(question)

  async function recordSafetyBlock(inputEval: {
    answer: string
    toolsUsed: string[]
    safetyKind: string
    fairHousingFlags?: string[]
    graphMetadata?: Record<string, unknown>
  }) {
    const responseStatus = "blocked" as const
    return writeAskUloAuditRecord(supabase, {
      landlordId,
      conversationId,
      question,
      answer: inputEval.answer,
      intent: intentResult.intent,
      intentConfidence: intentResult.confidence,
      agentMode,
      toolsSelected: [],
      toolsUsed: inputEval.toolsUsed,
      evidenceUsed: { hasEvidence: false, citationCount: 0 },
      refusalReason: deriveAskUloRefusalReason({
        responseStatus,
        safetyKind: inputEval.safetyKind,
      }),
      responseStatus,
      mode: "fallback",
      model: null,
      eval: {
        refused: true,
        requireCounsel: true,
        knownUnknown: true,
        qualitySummary: inputEval.toolsUsed.join(","),
        fairHousingFlags: inputEval.fairHousingFlags ?? [],
        faithfulnessDetail: { notes: ["safety_boundary"] },
        latencyMs: Date.now() - startedAt,
      },
      graphMetadata: {
        history_turns: history.length,
        safety_boundary: true,
        safety_kind: inputEval.safetyKind,
        latency_ms: Date.now() - startedAt,
        known_unknown: true,
        ...(inputEval.graphMetadata ?? {}),
      },
    })
  }

  if (actionBoundary.blocked) {
    const answer = formatActionBoundaryMarkdown(actionBoundary)
    const epistemicEarly = classifyEpistemicAsk({
      question,
      subject: "other",
      capability: "search",
      policyBlocked: true,
    })
    logEpistemicBucket({
      ...epistemicEarly,
      phase: "policy_early",
    })
    const toolsUsed = [
      `intent:${intentResult.intent}`,
      "safety:action_boundary",
      `epistemic:${epistemicEarly.classified_bucket}`,
      ...actionBoundary.actions.map((a) => `blocked:${a.id}`),
    ]
    if (agentMode) toolsUsed.push(`agent_mode:${agentMode}`)

    const audit = await recordSafetyBlock({
      answer,
      toolsUsed,
      safetyKind: "action_boundary",
      graphMetadata: {
        blocked_actions: actionBoundary.actions.map((a) => a.id),
      },
    })

    return {
      blocked: true,
      response: {
        answer,
        citations: [],
        toolsUsed: audit.toolsUsed,
        mode: "fallback",
        model: null,
        intent: intentResult.intent,
        agentMode,
        evalId: audit.evalId,
        jurisdiction: earlyJurisdiction,
        visualContext: null,
        legalAudit: null,
        safetyBoundary: {
          blocked: true,
          kind: "action_boundary",
          actions: actionBoundary.actions.map((a) => ({ id: a.id, label: a.label })),
        },
      },
    }
  }

  if (fairHousingSafety.blocked) {
    const answer = formatFairHousingBlockMarkdown(fairHousingSafety)
    const toolsUsed = [
      `intent:${intentResult.intent}`,
      "safety:fair_housing",
      ...fairHousingSafety.flags.map((f) => `fair_housing:${f.id}`),
    ]
    if (agentMode) toolsUsed.push(`agent_mode:${agentMode}`)

    const audit = await recordSafetyBlock({
      answer,
      toolsUsed,
      safetyKind: "fair_housing",
      fairHousingFlags: fairHousingSafety.flags.map((f) => f.id),
      graphMetadata: {
        fair_housing_flags: fairHousingSafety.flags.map((f) => f.id),
        protected_traits: fairHousingSafety.protectedTraitsMentioned,
        proxies: fairHousingSafety.proxiesMentioned,
      },
    })

    return {
      blocked: true,
      response: {
        answer,
        citations: [],
        toolsUsed: audit.toolsUsed,
        mode: "fallback",
        model: null,
        intent: intentResult.intent,
        agentMode,
        evalId: audit.evalId,
        jurisdiction: earlyJurisdiction,
        visualContext: null,
        legalAudit: null,
        safetyBoundary: {
          blocked: true,
          kind: "fair_housing",
          actions: [
            {
              id: "fair_housing_screening",
              label: "recommend approve/deny based on protected traits or proxies",
            },
          ],
          fairHousingFlags: fairHousingSafety.flags.map((f) => ({
            id: f.id,
            label: f.label,
          })),
        },
      },
    }
  }

  const humanDecisionSafety = detectHumanDecisionSafety(question)
  const sensitiveTopics: LegalSensitiveTopic[] = detectLegalSensitiveTopics(question)
  if (
    fairHousingSafety.refuseDecision &&
    !sensitiveTopics.some((t) => t.id === "tenant_screening" || t.id === "fair_housing")
  ) {
    sensitiveTopics.push({ id: "tenant_screening", label: "Tenant screening" })
    sensitiveTopics.push({ id: "fair_housing", label: "Fair housing / discrimination" })
  }
  if (
    humanDecisionSafety.refuseDecision &&
    humanDecisionSafety.flags.some((f) => f.id === "disability_accommodation_decision") &&
    !sensitiveTopics.some((t) => t.id === "disability_accommodation")
  ) {
    sensitiveTopics.push({
      id: "disability_accommodation",
      label: "Disability accommodations",
    })
  }
  const screeningIsolation = sensitiveTopics.some((t) => isScreeningPrivacyTopic(t.id))
  const requireCounsel =
    sensitiveTopics.length > 0 ||
    fairHousingSafety.refuseDecision ||
    humanDecisionSafety.refuseDecision
  const counselParts = [
    requireCounsel && sensitiveTopics.length > 0
      ? formatSensitiveCounselNote(sensitiveTopics)
      : null,
    fairHousingSafety.refuseDecision
      ? formatFairHousingRefuseDecisionNote(fairHousingSafety)
      : null,
    humanDecisionSafety.refuseDecision
      ? formatHumanDecisionRefuseNote(humanDecisionSafety)
      : null,
  ].filter(Boolean)
  const counselNote = counselParts.length > 0 ? counselParts.join(" ") : null

  return {
    blocked: false,
    fairHousingSafety,
    humanDecisionSafety,
    sensitiveTopics,
    screeningIsolation,
    requireCounsel,
    counselNote,
  }
}
