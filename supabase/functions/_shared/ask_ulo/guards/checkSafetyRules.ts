/**
 * Safety stage — decide whether Ask Ulo is allowed to answer or act.
 *
 * Hard blocks (no tools / no synthesis):
 *   - policy / action boundary (unauthorized actions)
 *   - Fair Housing block
 *   - permission / role deny
 *
 * Soft annotations (tools may still run; write/check must respect):
 *   - Fair Housing / human-decision refuse-decision notes
 *   - sensitive legal topics → requireCounsel
 *   - screeningIsolation
 *
 * “Refuse instead of guessing” for missing evidence lives in prefer/quality —
 * not here. This stage is policy + permission only.
 *
 * Implementation: `runGuards` → `runSafetyChecks` + `permissionGuard`.
 */

import type { AskUloContext } from "../core/context.ts"
import type { AskUloResponse } from "../core/types.ts"
import type { AskUloClassification } from "../routing/classifyQuestion.ts"
import {
  runGuards,
  type AskUloGuardsContinue,
  type AskUloGuardsResult,
} from "./runGuards.ts"
import type { AskUloSafetyContinue } from "./runSafetyChecks.ts"
import type { PermissionAllow } from "./permissionGuard.ts"

export type AskUloSafetyBlocked = {
  allowed: false
  response: AskUloResponse
}

export type AskUloSafetyAllowed = {
  allowed: true
  /** Soft counsel / Fair Housing / human-decision annotations for later stages. */
  safety: AskUloSafetyContinue
  permission: PermissionAllow
}

export type AskUloSafetyStageResult = AskUloSafetyBlocked | AskUloSafetyAllowed

export type {
  AskUloSafetyContinue,
  AskUloGuardsContinue,
  AskUloGuardsResult,
}

/**
 * Run the Safety stage for this turn.
 */
export async function checkSafetyRules(
  context: AskUloContext,
  classification: AskUloClassification,
): Promise<AskUloSafetyStageResult> {
  const guards = await runGuards(context, classification)
  if (guards.blocked) {
    return { allowed: false, response: guards.response }
  }
  return {
    allowed: true,
    safety: guards.safety,
    permission: guards.permission,
  }
}
