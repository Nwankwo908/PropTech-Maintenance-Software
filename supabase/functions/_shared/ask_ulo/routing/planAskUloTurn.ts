/**
 * Plan stage — how Ask Ulo will answer this turn.
 *
 * From classification, returns one clear plan:
 *   - required vs optional tools
 *   - OpenAI tool select vs rule backup
 *   - retrieval needs (property / vendor / maintenance / portfolio)
 *
 * Does not fetch data. Retrieve only executes this plan.
 */

import { planToolsForIntent, type AskUloToolPlan } from "./detectIntent.ts"
import {
  buildToolSelectAllowlist,
  planToolsFromCapabilityRoute,
} from "./toolSelectNeeds.ts"
import {
  resolveToolSelection,
  type AskUloToolSelectSource,
  type AskUloToolSelection,
} from "./resolveToolSelection.ts"
import {
  deriveRetrievalNeeds,
  type AskUloRetrievalNeeds,
} from "./deriveRetrievalNeeds.ts"
import type { AskUloClassification } from "./classifyQuestion.ts"
import type { AskUloExecutionPlan } from "./buildExecutionPlan.ts"
import type { DomainToolId } from "../tools/_shared/registry.ts"
import type { PlannedDomainToolCall } from "./selectTools.ts"
import { logRouteDecision } from "./routeDecision.ts"

/**
 * Everything Ask Ulo needs to do for this turn (after classify + safety).
 */
export type AskUloTurnPlan = AskUloExecutionPlan & {
  /** Capability-route required tools. */
  requiredTools: DomainToolId[]
  /** Allowlisted optional tools (may be chosen by OpenAI select). */
  optionalTools: DomainToolId[]
  /** Final planned calls + args. */
  plannedTools: PlannedDomainToolCall[]
  /** openai | rules | skipped | error */
  toolSelectSource: AskUloToolSelectSource
  /** True when OpenAI returned nothing allowlisted — rules used. */
  usedRuleBackup: boolean
  noToolMatched: boolean
  /** Full tool-selection bag (needs patch, etc.). */
  toolSelection: AskUloToolSelection
  /** Extra property / vendor / maintenance / portfolio fetch flags. */
  retrievalNeeds: AskUloRetrievalNeeds
  /** Legacy intent → ops/legal/market switches. */
  legacyToolPlan: AskUloToolPlan
  classification: AskUloClassification
}

/** @deprecated Prefer AskUloTurnPlan */
export type AskUloInformationPlan = AskUloTurnPlan

/**
 * Build the turn plan: tools + retrieval needs.
 */
export async function planAskUloTurn(
  classification: AskUloClassification,
  question: string,
): Promise<AskUloTurnPlan> {
  const requiredTools = [
    ...classification.capabilityRoute.requiredTools,
  ] as DomainToolId[]
  const optionalTools = [
    ...classification.capabilityRoute.optionalTools,
  ] as DomainToolId[]

  const legacyToolPlan = planToolsForIntent(classification.intentResult.intent)
  const ruleToolPlan = planToolsFromCapabilityRoute({
    route: classification.capabilityRoute,
    hints: classification.capability.hints,
    locks: classification.toolSelectLocks,
    question,
  })
  const toolAllowlist = buildToolSelectAllowlist(
    classification.capabilityRoute,
    classification.toolSelectLocks,
  )

  const toolSelection = await resolveToolSelection({
    question,
    ruleToolPlan,
    toolAllowlist,
    toolSelectLocks: classification.toolSelectLocks,
    subject: classification.subject,
    capability: classification.capability.capability,
  })

  const retrievalNeeds = deriveRetrievalNeeds({
    question,
    classification,
    toolNeeds: toolSelection.toolNeeds,
    legacyToolPlan,
  })

  const plannedTools = toolSelection.plannedTools
  const toolSelectSource = toolSelection.toolSelectSource
  const usedRuleBackup =
    toolSelectSource === "rules" ||
    toolSelectSource === "error" ||
    toolSelection.noToolMatched

  const tools = [
    ...new Set([
      ...requiredTools,
      ...plannedTools.map((t) => t.name as DomainToolId),
    ]),
  ]

  const decision = {
    ...classification.decision,
    tools,
    toolCalls: plannedTools,
  }
  logRouteDecision(decision)

  return {
    subject: classification.subject,
    capability: classification.capability,
    capabilityRoute: classification.capabilityRoute,
    intentResult: classification.intentResult,
    playbook: classification.playbook,
    reasoningMode: classification.reasoningMode,
    analytical: classification.analytical,
    responseFormat: classification.responseFormat,
    compound: classification.compound,
    epistemic: classification.epistemic,
    evidencePlan: classification.evidencePlan,
    legacyToolPlan,
    ruleToolPlan,
    toolAllowlist,
    toolSelectLocks: classification.toolSelectLocks,
    propertyLabel: classification.propertyLabel,
    propertyId: classification.propertyId,
    decision,
    requiredTools,
    optionalTools,
    plannedTools,
    toolSelectSource,
    usedRuleBackup,
    noToolMatched: toolSelection.noToolMatched,
    toolSelection,
    retrievalNeeds,
    classification,
  }
}

/** @deprecated Prefer planAskUloTurn */
export async function decideInformationNeeded(
  classification: AskUloClassification,
  question: string,
): Promise<AskUloTurnPlan> {
  return planAskUloTurn(classification, question)
}
