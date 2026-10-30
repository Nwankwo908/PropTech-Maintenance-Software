/**
 * Ask Ulo traffic controller — one clear sequence per question:
 *
 *   understand → job classify → (product_support | safety → plan → retrieve → …)
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { buildAskUloContext, jurisdictionFromPortfolio } from "./core/context.ts"
import type { AskUloResponse, AskUloRunInput } from "./core/types.ts"
import { classifyQuestion } from "./routing/classifyQuestion.ts"
import { classifyAskUloJob } from "./routing/classifyAskUloJob.ts"
import { checkSafetyRules } from "./guards/checkSafetyRules.ts"
import { planAskUloTurn } from "./routing/planAskUloTurn.ts"
import { executeSelectedTools } from "./retrieval/executeSelectedTools.ts"
import { resolvePreferPacket, preferPacketBagFromEvidence } from "./retrieval/resolvePreferPacket.ts"
import { synthesizeAnswer } from "./synthesis/synthesizeAnswerStage.ts"
import { validateFinalAnswer } from "./quality/validateFinalAnswerStage.ts"
import { auditAskUloTurn } from "./audit/auditAskUloTurn.ts"
import { runProductSupportTurn } from "./support/runProductSupportTurn.ts"
import { createAskUloTiming } from './core/timing.ts'
import { countOpenWorkOrders, parseOpenWorkOrderCount } from './tools/maintenance/countWorkOrders.ts'
import { writeAskUloAuditRecord } from './audit/writeAskUloAuditRecord.ts'
import { isPriorityFollowUp, answerPriorityFollowUp } from './tools/ops/priorityFollowUp.ts'
import { isUploadedDocumentQuestion } from './tools/maintenance/reportedFactAnswer.ts'
import { lookupUploadedDocumentAnswer, UPLOADED_DOCUMENT_PASTE } from './retrieval/uploadedDocuments.ts'
import {
  canAttemptDailyPrioritiesReply,
  tryHandleDailyPrioritiesReply,
} from "../sms/dailyPrioritiesSms.ts"

export type {
  AskUloResponse,
  AskUloSafetyBoundary,
  AskUloLegalAudit,
  AskUloMarketCompVisual,
  AskUloHistoryChartPoint,
  AskUloVisualContext,
  AskUloHistoryMessage,
} from "./core/types.ts"

function prioritySelectionResponse(message: string): AskUloResponse {
  return {
    answer: message,
    citations: [],
    toolsUsed: ["daily_priorities_reply"],
    mode: "fallback",
    model: null,
    intent: "daily_priorities_reply",
    agentMode: null,
    evalId: null,
    jurisdiction: {
      countryCode: "US",
      stateCode: null,
      countySlug: null,
      countyLabel: null,
      citySlug: null,
      cityLabel: null,
      courtSystem: null,
      housingProgram: null,
      codeSet: null,
    },
    visualContext: null,
    legalAudit: null,
    safetyBoundary: null,
  }
}

export async function runAskUlo(
  supabase: SupabaseClient,
  input: AskUloRunInput,
): Promise<AskUloResponse> {
  const timing = input.timing ?? createAskUloTiming()
  // A numbered reply selects the open chat list item. It does not assign or approve.
  if (canAttemptDailyPrioritiesReply(input.question)) {
    const reply = await tryHandleDailyPrioritiesReply(supabase, {
      landlordId: input.landlordId,
      conversationId: input.conversationId ?? null,
      body: input.question,
      role: "landlord",
      channel: "chat",
    })
    if (reply.handled) return prioritySelectionResponse(reply.message)
  }

  // 1. Understand the question (who / where / history / scope)
  const context = await timing.measure('context', () => buildAskUloContext(supabase, input))

  // 1b. Job split: product-support vs portfolio-analyst vs legal
  const job = classifyAskUloJob(context.question, context.priorUserTurns)
  if (job.job === "product_support") {
    return await timing.measure('support', () => runProductSupportTurn(supabase, input, job))
  }

  // 2. Classification (intent, mode, subject, action, evidence requirements)
  const classification = await timing.measure('classification', () => classifyQuestion({
    question: context.question,
    priorUserTurns: context.priorUserTurns,
    agentMode: context.agentMode,
    buildingFilter: context.propertyScope.buildingFilter,
  }))

  // 3. Safety — allowed to answer/act? (policy, Fair Housing, human-decision, permissions)
  const safetyGate = await timing.measure('safety', () => checkSafetyRules(context, classification))
  if (!safetyGate.allowed) return safetyGate.response
  const safety = safetyGate.safety

  if (isPriorityFollowUp(context.originalQuestion ?? input.question, context.history)) {
    let answer: string
    try { answer = await timing.measure('priority_followup', () => answerPriorityFollowUp(supabase, input.landlordId, context.propertyScope.buildingFilter)) }
    catch { answer = 'I could not refresh those priorities right now. Please retry; I will not guess which item comes first.' }
    const audit = await timing.measure('audit', () => writeAskUloAuditRecord(supabase, {
      landlordId: input.landlordId, conversationId: input.conversationId,
      question: context.originalQuestion ?? input.question, answer,
      intent: 'maintenance', toolsSelected: ['get_daily_priorities'], toolsUsed: ['get_daily_priorities', 'context:priority_followup'],
      evidenceUsed: { hasEvidence: !answer.startsWith('I could not'), citationCount: 0 },
      responseStatus: answer.startsWith('I could not') ? 'clarified' : 'answered', mode: 'fallback',
      eval: { latencyMs: Math.round(timing.snapshot().totalMs) },
    }))
    return { ...prioritySelectionResponse(answer), intent: 'maintenance', agentMode: context.agentMode, jurisdiction: jurisdictionFromPortfolio(context.portfolioJurisdiction), evalId: audit.evalId, toolsUsed: audit.toolsUsed }
  }

  const countAsk = parseOpenWorkOrderCount(context.question)
  if (countAsk) {
    let counted: Awaited<ReturnType<typeof countOpenWorkOrders>>
    try {
      counted = await timing.measure('count', () => countOpenWorkOrders(supabase, input.landlordId, countAsk.property))
    } catch {
      counted = { count: null, status: 'clarified', answer: 'I could not verify the work-order count right now. Please try again; I will not guess a total.' }
    }
    const audit = await timing.measure('audit', () => writeAskUloAuditRecord(supabase, {
      landlordId: input.landlordId, conversationId: input.conversationId,
      question: context.originalQuestion ?? context.question, answer: counted.answer,
      intent: 'maintenance', toolsSelected: ['count_work_orders'], toolsUsed: ['count_work_orders'],
      evidenceUsed: { hasEvidence: counted.count != null, citationCount: 0 },
      responseStatus: counted.status, mode: 'fallback',
      eval: { latencyMs: Math.round(timing.snapshot().totalMs) },
    }))
    return { ...prioritySelectionResponse(counted.answer), intent: 'maintenance', agentMode: context.agentMode, evalId: audit.evalId, toolsUsed: audit.toolsUsed, jurisdiction: jurisdictionFromPortfolio(context.portfolioJurisdiction) }
  }

  // Private-document interpretation needs actual document text, not unrelated repair packets.
  if (classification.subject === "document") {
    const answer = "I can help review a document, but I do not have its contents in this conversation. Please name the property and document, and paste the relevant clause or text. I cannot verify what an uploaded lease, policy, or report says from its title alone."
    const audit = await timing.measure('audit', () => writeAskUloAuditRecord(supabase, {
      landlordId: input.landlordId, conversationId: input.conversationId,
      question: context.originalQuestion ?? input.question, answer,
      intent: 'document', toolsSelected: [], toolsUsed: ['context:document_required'],
      evidenceUsed: { hasEvidence: false, citationCount: 0 }, responseStatus: 'clarified', mode: 'fallback',
      eval: { latencyMs: Math.round(timing.snapshot().totalMs) },
    }))
    return { ...prioritySelectionResponse(answer), intent: 'document', agentMode: context.agentMode,
      jurisdiction: jurisdictionFromPortfolio(context.portfolioJurisdiction), evalId: audit.evalId, toolsUsed: audit.toolsUsed }
  }

  // 4. Plan — how to answer (required/optional tools, OpenAI vs rules, retrieval needs)
  const plan = await timing.measure('planning', () => planAskUloTurn(classification, context.question))

  // 5. Retrieve that information
  const evidence = await timing.measure('retrieval', () => executeSelectedTools(context, plan, safety))

  // 6. Prefer packet / fail-closed (may short-circuit LLM)
  const preferred = resolvePreferPacket(
    preferPacketBagFromEvidence({
      question: context.question,
      route: plan,
      evidence,
    }),
  )

  // 7. Write the answer
  const draft = await timing.measure('synthesis', () => synthesizeAnswer({
    context,
    route: plan,
    evidence,
    safety,
    preferred,
  }))

  // 8. Check the answer
  const validated = await timing.measure('validation', () => validateFinalAnswer({
    answer: draft,
    evidence,
    context,
    route: plan,
    safety,
  }))

  // 9. Audit the turn (turns / evals / graph)
  await timing.measure('audit', () => auditAskUloTurn({
    context,
    route: plan,
    evidence,
    answer: validated,
    safety,
  }))

  const response = validated.response
  // Portfolio / legal paths never create support tickets.
  if (response.supportTicket == null) {
    response.supportTicket = null
  }
  return response
}
