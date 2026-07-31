/**
 * Classification stage — what the user is asking (not which tools to run).
 *
 * Owns: intent, mode, subject, capability/action, evidence requirements.
 * Does not call tools or OpenAI tool-select.
 */

import {
  applyAskUloAgentModeBias,
  type AskUloAgentMode,
} from "./selectMode.ts"
import { classifyAskUloIntent } from "./detectIntent.ts"
import {
  detectQuestionSubject,
  isVendorFocusedQuestion,
  type AskUloQuestionSubject,
} from "./detectSubject.ts"
import {
  detectAskUloCapability,
  type AskUloCapabilityResult,
} from "./capability.ts"
import {
  resolveCapabilityRoute,
  type AskUloCapabilityRoute,
} from "./capabilityRoute.ts"
import { classifyInvestigationPlaybook } from "./investigationPlaybooks.ts"
import { classifyAskUloReasoningMode } from "./briefingIntent.ts"
import { classifyAnalyticalQuery } from "./analyticalQuery.ts"
import { classifyResponseFormat } from "./dynamicResponse.ts"
import { detectCompoundVendorMarketIntent } from "./compoundIntent.ts"
import { classifyEpistemicAsk } from "./epistemicBucket.ts"
import {
  planEvidenceForQuestion,
  type SubjectEvidencePlan,
} from "../guards/evidenceGuard.ts"
import type { ToolSelectSubjectLocks } from "./toolSelectNeeds.ts"
import type { DomainToolId } from "../tools/_shared/registry.ts"
import {
  capabilityToRouteAction,
  slugifyPropertyLabel,
  type AskUloRouteDecision,
} from "./routeDecision.ts"

export type AskUloClassification = {
  /** Fine-grained intent (+ agent-mode bias). */
  intentResult: ReturnType<typeof applyAskUloAgentModeBias>
  /** Subject family: resident, vendor, legal, maintenance, … */
  subject: AskUloQuestionSubject
  /** Capability / action type (search, rank, draft, …). */
  capability: AskUloCapabilityResult
  capabilityRoute: AskUloCapabilityRoute
  playbook: ReturnType<typeof classifyInvestigationPlaybook>
  reasoningMode: ReturnType<typeof classifyAskUloReasoningMode>
  analytical: ReturnType<typeof classifyAnalyticalQuery>
  responseFormat: ReturnType<typeof classifyResponseFormat>
  compound: ReturnType<typeof detectCompoundVendorMarketIntent>
  epistemic: ReturnType<typeof classifyEpistemicAsk>
  /** What kind of evidence the answer may use. */
  evidencePlan: SubjectEvidencePlan
  toolSelectLocks: ToolSelectSubjectLocks
  propertyLabel: string | null
  propertyId: string | null
  /** Compact debug card (tools = capability-route seeds only). */
  decision: AskUloRouteDecision
}

/**
 * Classify the question for this turn.
 */
export function classifyQuestion(input: {
  question: string
  priorUserTurns: string[]
  agentMode: AskUloAgentMode | null
  buildingFilter?: string | null
  locks?: ToolSelectSubjectLocks
}): AskUloClassification {
  const classified = classifyAskUloIntent(input.question, input.priorUserTurns)
  const intentResult = applyAskUloAgentModeBias(classified, input.agentMode)
  const subject = detectQuestionSubject(input.question)
  const capability = detectAskUloCapability(input.question, subject)
  const capabilityRoute = resolveCapabilityRoute({
    subject,
    capability: capability.capability,
  })
  const playbook = classifyInvestigationPlaybook(input.question)
  const reasoningMode = classifyAskUloReasoningMode(input.question)
  const analytical = classifyAnalyticalQuery(input.question)
  const responseFormat = classifyResponseFormat(input.question)
  const compound = detectCompoundVendorMarketIntent(input.question)
  const epistemic = classifyEpistemicAsk({
    question: input.question,
    subject,
    capability: capability.capability,
  })
  const evidencePlan = planEvidenceForQuestion(input.question)
  const vendorLock =
    evidencePlan.subject === "vendor" || isVendorFocusedQuestion(input.question)
  const toolSelectLocks = input.locks ?? {
    blockPropertyDashboard: evidencePlan.blockPropertyDashboard || vendorLock,
    vendorLock,
  }

  const propertyLabel = input.buildingFilter?.trim() || null
  const propertyId = slugifyPropertyLabel(propertyLabel)

  const tools = [...new Set(capabilityRoute.requiredTools)] as DomainToolId[]

  const decision: AskUloRouteDecision = {
    action: capabilityToRouteAction(capability.capability),
    intent: intentResult.intent,
    intentLabel: intentResult.label,
    subject,
    capability: capability.capability,
    capabilityConfidence: capability.confidence,
    propertyId,
    propertyLabel,
    tools,
    toolCalls: [],
    hints: { ...capability.hints },
    playbookId: playbook.id,
    locks: toolSelectLocks,
  }

  return {
    intentResult,
    subject,
    capability,
    capabilityRoute,
    playbook,
    reasoningMode,
    analytical,
    responseFormat,
    compound,
    epistemic,
    evidencePlan,
    toolSelectLocks,
    propertyLabel,
    propertyId,
    decision,
  }
}
