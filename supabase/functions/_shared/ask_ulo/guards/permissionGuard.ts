/**
 * Permission / role-boundary guard for Ask Ulo.
 *
 * Answers: "Is the user allowed to see residents / vendors / finance / legal?"
 * Does not run vendor search, rent lookups, or other domain tools.
 */

import type { AskUloContext } from "../core/context.ts"
import type { AskUloPermissions } from "../core/types.ts"
import type { AskUloRetrievalNeeds } from "../routing/deriveRetrievalNeeds.ts"
import type { AskUloQuestionSubject } from "../routing/detectSubject.ts"
import { detectQuestionSubject } from "../routing/detectSubject.ts"
import type { GuardCapability } from "./types.ts"

export type PermissionDenial = {
  allowed: false
  capability: GuardCapability
  subject: AskUloQuestionSubject
  /** Landlord-facing refuse copy (no internal jargon). */
  answer: string
}

export type PermissionAllow = {
  allowed: true
  subject: AskUloQuestionSubject
  /** Capabilities that were checked and passed (for audit). */
  checked: GuardCapability[]
}

export type PermissionCheckResult = PermissionAllow | PermissionDenial

const SUBJECT_CAPABILITY: Partial<
  Record<AskUloQuestionSubject, GuardCapability>
> = {
  resident: "canSeeResidents",
  vendor: "canSeeVendors",
  finance: "canSeeFinance",
  incentives: "canSeeFinance",
  legal: "canAskLegal",
  local_regulation: "canAskLegal",
}

function refuseCopy(capability: GuardCapability): string {
  switch (capability) {
    case "canSeeResidents":
      return [
        "I can't share resident or tenant details for this account.",
        "",
        "If you need access, ask a team admin to update your permissions,",
        "or rephrase the question without asking for resident-level information.",
      ].join("\n")
    case "canSeeVendors":
      return [
        "I can't share vendor network details for this account.",
        "",
        "If you need access, ask a team admin to update your permissions,",
        "or ask a question that doesn't require the vendor roster.",
      ].join("\n")
    case "canSeeFinance":
      return [
        "I can't share rent, balances, or other financial details for this account.",
        "",
        "If you need access, ask a team admin to update your permissions.",
      ].join("\n")
    case "canAskLegal":
      return [
        "I can't answer legal or regulation questions for this account.",
        "",
        "If you need access, ask a team admin to update your permissions,",
        "or consult your counsel for legal advice.",
      ].join("\n")
  }
}

/**
 * Map question subject → required permission flag on context.
 * Subjects without a mapping (property, work_order, …) are allowed for staff.
 */
export function requiredCapabilityForSubject(
  subject: AskUloQuestionSubject,
): GuardCapability | null {
  return SUBJECT_CAPABILITY[subject] ?? null
}

export function checkAskUloPermissions(
  context: AskUloContext,
  subject?: AskUloQuestionSubject,
): PermissionCheckResult {
  const resolved = subject ?? detectQuestionSubject(context.question)
  const capability = requiredCapabilityForSubject(resolved)
  if (!capability) {
    return { allowed: true, subject: resolved, checked: [] }
  }
  const perms: AskUloPermissions = context.permissions
  if (perms[capability] === true) {
    return { allowed: true, subject: resolved, checked: [capability] }
  }
  return {
    allowed: false,
    capability,
    subject: resolved,
    answer: refuseCopy(capability),
  }
}

/**
 * Defense-in-depth: after tool needs are planned, drop lookups the user
 * is not allowed to run — keeps vendor/rent tools from mixing into a refuse path.
 */
export function applyPermissionToolGates(
  permissions: AskUloPermissions,
  needs: {
    needsListResidents?: boolean
    needsVendorBest?: boolean
    needsVendorResponseSpeed?: boolean
    needsVendorCompletion?: boolean
    needsVendorInactive?: boolean
    needsVendorOverload?: boolean
    needsVendorVerification?: boolean
    needsLandlordIncentives?: boolean
    runLegalTools?: boolean
    runMarketData?: boolean
    runPriceHistory?: boolean
    runRentHistory?: boolean
  },
): typeof needs {
  const next = { ...needs }
  if (!permissions.canSeeResidents) {
    next.needsListResidents = false
  }
  if (!permissions.canSeeVendors) {
    next.needsVendorBest = false
    next.needsVendorResponseSpeed = false
    next.needsVendorCompletion = false
    next.needsVendorInactive = false
    next.needsVendorOverload = false
    next.needsVendorVerification = false
  }
  if (!permissions.canSeeFinance) {
    next.needsLandlordIncentives = false
    next.runPriceHistory = false
    next.runRentHistory = false
  }
  if (!permissions.canAskLegal) {
    next.runLegalTools = false
  }
  return next
}

/** Apply permission gates to retrieval playbook flags + legal toggle (audit / defense-in-depth). */
export function applyPermissionGatesToRetrievalNeeds(
  permissions: AskUloPermissions,
  retrievalNeeds: AskUloRetrievalNeeds,
  opts?: { runLegalTools?: boolean; forcePropertyRanking?: boolean },
): { retrievalNeeds: AskUloRetrievalNeeds; runLegalTools: boolean } {
  let next: AskUloRetrievalNeeds = opts?.forcePropertyRanking
    ? { ...retrievalNeeds, needsRanking: true }
    : retrievalNeeds

  const gated = applyPermissionToolGates(permissions, {
    needsListResidents: next.needsListResidents,
    needsVendorBest: next.needsVendorBest,
    needsVendorResponseSpeed: next.needsVendorResponseSpeed,
    needsVendorCompletion: next.needsVendorCompletion,
    needsVendorInactive: next.needsVendorInactive,
    needsVendorOverload: next.needsVendorOverload,
    needsVendorVerification: next.needsVendorVerification,
    needsLandlordIncentives: next.needsLandlordIncentives,
    runLegalTools: opts?.runLegalTools,
  })

  next = {
    ...next,
    needsListResidents: Boolean(gated.needsListResidents),
    needsVendorBest: Boolean(gated.needsVendorBest),
    needsVendorResponseSpeed: Boolean(gated.needsVendorResponseSpeed),
    needsVendorCompletion: Boolean(gated.needsVendorCompletion),
    needsVendorInactive: Boolean(gated.needsVendorInactive),
    needsVendorOverload: Boolean(gated.needsVendorOverload),
    needsVendorVerification: Boolean(gated.needsVendorVerification),
    needsLandlordIncentives: Boolean(gated.needsLandlordIncentives),
  }

  return {
    retrievalNeeds: next,
    runLegalTools: Boolean(gated.runLegalTools),
  }
}

/** @deprecated Prefer checkAskUloPermissions — kept for older imports. */
export {
  detectAskUloActionBoundary as detectPermissionBoundary,
  formatActionBoundaryMarkdown as formatPermissionRefuseMarkdown,
} from "./actionBoundary.ts"
