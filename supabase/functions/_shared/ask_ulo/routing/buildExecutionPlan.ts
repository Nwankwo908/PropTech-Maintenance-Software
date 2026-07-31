/**
 * Compatibility: full execution plan (classification + rule tool seeds).
 * Prefer classifyQuestion → planAskUloTurn in the orchestrator.
 */

import type { AskUloAgentMode } from "./selectMode.ts"
import { planToolsForIntent } from "./detectIntent.ts"
import {
  buildToolSelectAllowlist,
  planToolsFromCapabilityRoute,
  type ToolSelectSubjectLocks,
} from "./toolSelectNeeds.ts"
import type { DomainToolId } from "../tools/_shared/registry.ts"
import type { PlannedDomainToolCall } from "./selectTools.ts"
import type { AskUloRouteDecision } from "./routeDecision.ts"
import { logRouteDecision } from "./routeDecision.ts"
import type { AskUloToolSelection } from "./resolveToolSelection.ts"
import {
  classifyQuestion,
  type AskUloClassification,
} from "./classifyQuestion.ts"

export type AskUloExecutionPlan = {
  subject: AskUloClassification["subject"]
  capability: AskUloClassification["capability"]
  capabilityRoute: AskUloClassification["capabilityRoute"]
  intentResult: AskUloClassification["intentResult"]
  playbook: AskUloClassification["playbook"]
  reasoningMode: AskUloClassification["reasoningMode"]
  analytical: AskUloClassification["analytical"]
  responseFormat: AskUloClassification["responseFormat"]
  compound: AskUloClassification["compound"]
  epistemic: AskUloClassification["epistemic"]
  evidencePlan: AskUloClassification["evidencePlan"]
  legacyToolPlan: ReturnType<typeof planToolsForIntent>
  ruleToolPlan: PlannedDomainToolCall[]
  toolAllowlist: DomainToolId[]
  toolSelectLocks: ToolSelectSubjectLocks
  propertyLabel: string | null
  propertyId: string | null
  decision: AskUloRouteDecision
  toolSelection?: AskUloToolSelection
}

export type { AskUloRouteDecision } from "./routeDecision.ts"
export type { AskUloClassification } from "./classifyQuestion.ts"

/**
 * Build a sync execution plan (rules only — no OpenAI tool select).
 * Used by tests and fallbacks; production uses classify + decide.
 */
export function buildExecutionPlan(input: {
  question: string
  priorUserTurns: string[]
  agentMode: AskUloAgentMode | null
  buildingFilter?: string | null
  locks?: ToolSelectSubjectLocks
}): AskUloExecutionPlan {
  const classification = classifyQuestion(input)
  const legacyToolPlan = planToolsForIntent(classification.intentResult.intent)
  const ruleToolPlan = planToolsFromCapabilityRoute({
    route: classification.capabilityRoute,
    hints: classification.capability.hints,
    locks: classification.toolSelectLocks,
  })
  const toolAllowlist = buildToolSelectAllowlist(
    classification.capabilityRoute,
    classification.toolSelectLocks,
  )
  const tools = [
    ...new Set([
      ...classification.capabilityRoute.requiredTools,
      ...ruleToolPlan.map((t) => t.name as DomainToolId),
    ]),
  ]

  const plan: AskUloExecutionPlan = {
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
    decision: {
      ...classification.decision,
      tools,
      toolCalls: ruleToolPlan,
    },
  }
  logRouteDecision(plan.decision)
  return plan
}
