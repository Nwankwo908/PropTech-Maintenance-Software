/**
 * Stage-to-stage bags for the Ask Ulo pipeline (intentionally wide during extraction).
 */

import type { AskUloResponse } from "./types.ts"
import type { AskUloExecutionPlan } from "../routing/buildExecutionPlan.ts"
import type { AskUloTurnPlan } from "../routing/planAskUloTurn.ts"
import type { AskUloSafetyContinue } from "../guards/runSafetyChecks.ts"
import type { AskUloContext } from "./context.ts"
import type { PreferPacketResult } from "../retrieval/resolvePreferPacket.ts"

/** Evidence gathered by executeSelectedTools — wide bag preserved across stages. */
export type AskUloEvidence = Record<string, unknown> & {
  toolsUsed: string[]
  plan: AskUloExecutionPlan["legacyToolPlan"]
  executionPlan: AskUloExecutionPlan
}

export type AskUloDraftAnswer = Record<string, unknown> & {
  synthesis: {
    answer: string
    citations: AskUloResponse["citations"]
    mode: AskUloResponse["mode"]
    model: string | null
    synthesizeMs?: number
    usage?: { promptTokens?: number; completionTokens?: number } | null
  }
  answerWithSources: string
  toolsUsed: string[]
  evidence: AskUloEvidence
  preferredEvidence?: PreferPacketResult | null
}

export type AskUloValidatedAnswer = Record<string, unknown> & {
  response: AskUloResponse
  toolsUsed: string[]
  evidence: AskUloEvidence
  synthesis: AskUloDraftAnswer["synthesis"]
  answerWithSources: string
  qualityReport: unknown
  /** Post-answer check report for audit graph metadata. */
  postAnswerReport?: unknown
  preferredEvidence?: PreferPacketResult | null
  // audit inputs
  gateStatus: unknown
  refused: boolean
  clarified: boolean
  knownUnknown: boolean
  requireCounsel: boolean
  sensitiveTopics: unknown[]
  fairHousingSafety: unknown
  humanDecisionSafety: unknown
  jurisdiction: AskUloResponse["jurisdiction"]
  legalResolution: unknown
  legalGate: unknown
  legal: unknown
  sourceTierCounts: unknown
  recommendedExpertId: unknown
  answerConfidence: unknown
  sourcesUsed: unknown
  qualityChecks: unknown
  retrievalCacheHit: boolean
  faithfulness: { score: number | null; detail: unknown }
  latencyMs: number
  promptTokens: number | null
  completionTokens: number | null
  embedTokens: number
  propertyClarifyOptions: string[]
  screeningIsolation: boolean
}

export type StageArgs = {
  context: AskUloContext
  route: AskUloExecutionPlan | AskUloTurnPlan
  safety: AskUloSafetyContinue
}
