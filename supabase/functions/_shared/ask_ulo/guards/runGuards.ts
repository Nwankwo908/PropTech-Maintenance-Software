/**
 * Unified pre-tool guards: safety (action / Fair Housing) + permissions.
 *
 * Order: hard safety refuse → permission refuse → soft counsel annotations.
 * Evidence subject gating stays on the execution plan (tool locks).
 */

import type { AskUloContext } from "../core/context.ts"
import { jurisdictionFromPortfolio } from "../core/context.ts"
import type { AskUloResponse } from "../core/types.ts"
import {
  deriveAskUloRefusalReason,
  writeAskUloAuditRecord,
} from "../audit/writeAskUloAuditRecord.ts"
import type { AskUloClassification } from "../routing/classifyQuestion.ts"
import {
  runSafetyChecks,
  type AskUloSafetyContinue,
  type AskUloSafetyResult,
} from "./runSafetyChecks.ts"
import {
  checkAskUloPermissions,
  type PermissionCheckResult,
} from "./permissionGuard.ts"

export type AskUloGuardsContinue = {
  blocked: false
  safety: AskUloSafetyContinue
  permission: Extract<PermissionCheckResult, { allowed: true }>
}

export type AskUloGuardsResult =
  | { blocked: true; response: AskUloResponse }
  | AskUloGuardsContinue

async function recordPermissionRefuse(
  context: AskUloContext,
  input: {
    answer: string
    toolsUsed: string[]
    intent: string
    intentConfidence: string | number
    permissionCapability: string
    permissionSubject: string
  },
) {
  const responseStatus = "blocked" as const
  return writeAskUloAuditRecord(context.supabase, {
    landlordId: context.landlordId,
    conversationId: context.conversationId,
    question: context.question,
    answer: input.answer,
    intent: input.intent,
    intentConfidence: input.intentConfidence,
    agentMode: context.agentMode,
    toolsSelected: [],
    toolsUsed: input.toolsUsed,
    evidenceUsed: { hasEvidence: false, citationCount: 0 },
    refusalReason: deriveAskUloRefusalReason({
      responseStatus,
      safetyKind: "permission",
    }),
    responseStatus,
    mode: "fallback",
    model: null,
    eval: {
      refused: true,
      knownUnknown: true,
      qualitySummary: input.toolsUsed.join(","),
      stateCode: context.portfolioJurisdiction.stateCode,
      citySlug: context.portfolioJurisdiction.citySlug,
      faithfulnessDetail: { notes: ["permission_boundary"] },
      latencyMs: Date.now() - context.startedAt,
    },
    graphMetadata: {
      history_turns: context.history.length,
      user_id: context.userId,
      safety_boundary: true,
      safety_kind: "permission",
      permission_capability: input.permissionCapability,
      permission_subject: input.permissionSubject,
      latency_ms: Date.now() - context.startedAt,
      known_unknown: true,
    },
  })
}

/**
 * Run all pre-tool “should Ask Ulo answer this?” checks.
 * Classification is required so guards do not re-detect intent/subject.
 */
export async function runGuards(
  context: AskUloContext,
  classification: AskUloClassification,
): Promise<AskUloGuardsResult> {
  const safety: AskUloSafetyResult = await runSafetyChecks(
    context,
    classification,
  )
  if (safety.blocked) {
    return { blocked: true, response: safety.response }
  }

  const permission = checkAskUloPermissions(context, classification.subject)
  if (!permission.allowed) {
    const intentResult = classification.intentResult
    const toolsUsed = [
      `intent:${intentResult.intent}`,
      "safety:permission",
      `permission:denied:${permission.capability}`,
      `subject:${permission.subject}`,
    ]
    if (context.agentMode) toolsUsed.push(`agent_mode:${context.agentMode}`)
    if (context.userId) toolsUsed.push(`user:${context.userId}`)

    const audit = await recordPermissionRefuse(context, {
      answer: permission.answer,
      toolsUsed,
      intent: intentResult.intent,
      intentConfidence: intentResult.confidence,
      permissionCapability: permission.capability,
      permissionSubject: permission.subject,
    })

    return {
      blocked: true,
      response: {
        answer: permission.answer,
        citations: [],
        toolsUsed: audit.toolsUsed,
        mode: "fallback",
        model: null,
        intent: intentResult.intent,
        agentMode: context.agentMode,
        evalId: audit.evalId,
        jurisdiction: jurisdictionFromPortfolio(context.portfolioJurisdiction),
        visualContext: null,
        legalAudit: null,
        safetyBoundary: {
          blocked: true,
          kind: "action_boundary",
          actions: [
            {
              id: `permission_${permission.capability}`,
              label: `access denied: ${permission.capability}`,
            },
          ],
        },
      },
    }
  }

  return {
    blocked: false,
    safety,
    permission,
  }
}
