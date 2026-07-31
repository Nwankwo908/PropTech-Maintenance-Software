/**
 * Ask Ulo traffic controller — one clear sequence per question:
 *
 *   understand → classify → safety → plan → retrieve → prefer → write → check → audit
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { buildAskUloContext } from "./core/context.ts"
import type { AskUloResponse, AskUloRunInput } from "./core/types.ts"
import { classifyQuestion } from "./routing/classifyQuestion.ts"
import { checkSafetyRules } from "./guards/checkSafetyRules.ts"
import { planAskUloTurn } from "./routing/planAskUloTurn.ts"
import { executeSelectedTools } from "./retrieval/executeSelectedTools.ts"
import { resolvePreferPacket, preferPacketBagFromEvidence } from "./retrieval/resolvePreferPacket.ts"
import { synthesizeAnswer } from "./synthesis/synthesizeAnswerStage.ts"
import { validateFinalAnswer } from "./quality/validateFinalAnswerStage.ts"
import { auditAskUloTurn } from "./audit/auditAskUloTurn.ts"

export type {
  AskUloResponse,
  AskUloSafetyBoundary,
  AskUloLegalAudit,
  AskUloMarketCompVisual,
  AskUloHistoryChartPoint,
  AskUloVisualContext,
  AskUloHistoryMessage,
} from "./core/types.ts"

export async function runAskUlo(
  supabase: SupabaseClient,
  input: AskUloRunInput,
): Promise<AskUloResponse> {
  // 1. Understand the question (who / where / history / scope)
  const context = await buildAskUloContext(supabase, input)

  // 2. Classification (intent, mode, subject, action, evidence requirements)
  const classification = classifyQuestion({
    question: context.question,
    priorUserTurns: context.priorUserTurns,
    agentMode: context.agentMode,
    buildingFilter: context.propertyScope.buildingFilter,
  })

  // 3. Safety — allowed to answer/act? (policy, Fair Housing, human-decision, permissions)
  const safetyGate = await checkSafetyRules(context, classification)
  if (!safetyGate.allowed) return safetyGate.response
  const safety = safetyGate.safety

  // 4. Plan — how to answer (required/optional tools, OpenAI vs rules, retrieval needs)
  const plan = await planAskUloTurn(classification, context.question)

  // 5. Retrieve that information
  const evidence = await executeSelectedTools(context, plan, safety)

  // 6. Prefer packet / fail-closed (may short-circuit LLM)
  const preferred = resolvePreferPacket(
    preferPacketBagFromEvidence({
      question: context.question,
      route: plan,
      evidence,
    }),
  )

  // 7. Write the answer
  const draft = await synthesizeAnswer({
    context,
    route: plan,
    evidence,
    safety,
    preferred,
  })

  // 8. Check the answer
  const validated = await validateFinalAnswer({
    answer: draft,
    evidence,
    context,
    route: plan,
    safety,
  })

  // 9. Audit the turn (turns / evals / graph)
  await auditAskUloTurn({
    context,
    route: plan,
    evidence,
    answer: validated,
    safety,
  })

  return validated.response
}
