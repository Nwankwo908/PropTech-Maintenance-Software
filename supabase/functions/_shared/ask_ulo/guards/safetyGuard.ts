/**
 * Composed safety + permission guards — “should Ask Ulo answer this?”
 *
 * Implementations:
 *   actionBoundary / fairHousing / humanDecision → runSafetyChecks
 *   permissionGuard → role / capability gates
 *   evidenceGuard → subject → packet family (applied on the execution plan)
 *   jurisdictionGuard → legal location (quality path)
 */

export {
  detectAskUloActionBoundary,
  formatActionBoundaryMarkdown,
  type AskUloActionBoundary,
} from "./actionBoundary.ts"

export {
  detectFairHousingSafety,
  formatFairHousingBlockMarkdown,
  formatFairHousingRefuseDecisionNote,
  type FairHousingSafety,
} from "./fairHousingSafety.ts"

export {
  detectHumanDecisionSafety,
  formatHumanDecisionRefuseNote,
  type HumanDecisionSafety,
} from "./humanDecisionSafety.ts"

export {
  checkAskUloPermissions,
  applyPermissionToolGates,
  requiredCapabilityForSubject,
  type PermissionCheckResult,
  type PermissionDenial,
  type PermissionAllow,
} from "./permissionGuard.ts"

export {
  runSafetyChecks,
  type AskUloSafetyResult,
  type AskUloSafetyContinue,
} from "./runSafetyChecks.ts"

export {
  runGuards,
  type AskUloGuardsResult,
  type AskUloGuardsContinue,
} from "./runGuards.ts"

export {
  checkSafetyRules,
  type AskUloSafetyStageResult,
  type AskUloSafetyAllowed,
  type AskUloSafetyBlocked,
} from "./checkSafetyRules.ts"

export type SafetyGateResult =
  | { blocked: false }
  | {
    blocked: true
    kind: "action_boundary" | "fair_housing" | "human_decision" | "permission"
    answer: string
    toolsUsed: string[]
  }
