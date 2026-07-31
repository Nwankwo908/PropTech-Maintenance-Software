/**
 * Debuggable route decision — the compact card logged as ASK_ULO_ROUTE.
 *
 * Fine-grained classifiers (intent, playbook, epistemic) stay on AskUloExecutionPlan;
 * this summary is what humans read when tracing “why these tools?”.
 */

import type { AskUloCapability } from "./capability.ts"
import type { AskUloQuestionSubject } from "./detectSubject.ts"
import type { DomainToolId } from "../tools/_shared/registry.ts"
import type { PlannedDomainToolCall } from "./selectTools.ts"
import type { ToolSelectSubjectLocks } from "./toolSelectNeeds.ts"
import { logRouteDecision as emitRouteDecision } from "../audit/logToolCalls.ts"

/** Coarse action for debug (maps capability → verb). */
export type AskUloRouteAction =
  | "lookup"
  | "rank"
  | "compare"
  | "summarize"
  | "investigate"
  | "recommend"
  | "estimate"
  | "draft"
  | "explain"
  | "forecast"
  | "other"

export type AskUloRouteDecision = {
  /** Coarse verb for logs (e.g. lookup). */
  action: AskUloRouteAction
  /** Fine-grained intent classifier (e.g. ops, legal, market_analysis). */
  intent: string
  intentLabel: string
  /** Primary subject family (resident, vendor, …). */
  subject: AskUloQuestionSubject
  /** Capability (search, rank, …). */
  capability: AskUloCapability
  capabilityConfidence: "high" | "medium" | "low"
  /** Slug from building filter when detected (e.g. maple-heights). */
  propertyId: string | null
  /** Display building name when detected (e.g. Maple Heights). */
  propertyLabel: string | null
  /** Planned domain tools (rule route). */
  tools: DomainToolId[]
  /** Tool calls with arguments (filter: late_rent, …). */
  toolCalls: PlannedDomainToolCall[]
  /** Structured hints (residentFilter, vendorMetric, …). */
  hints: Record<string, unknown>
  playbookId: string
  locks: ToolSelectSubjectLocks
}

export function capabilityToRouteAction(
  capability: AskUloCapability,
): AskUloRouteAction {
  switch (capability) {
    case "search":
    case "count":
    case "legal_lookup":
      return "lookup"
    case "rank":
      return "rank"
    case "compare":
      return "compare"
    case "summarize":
      return "summarize"
    case "investigate_root_cause":
    case "identify_risk":
    case "identify_recurring_pattern":
    case "identify_pending_decision":
      return "investigate"
    case "recommend":
      return "recommend"
    case "estimate_cost":
      return "estimate"
    case "draft":
      return "draft"
    case "explain_status":
      return "explain"
    case "forecast":
      return "forecast"
    default:
      return "other"
  }
}

/** Stable slug for debug / logs (not a DB uuid). */
export function slugifyPropertyLabel(label: string | null | undefined): string | null {
  if (!label?.trim()) return null
  const slug = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return slug || null
}

export function logRouteDecision(decision: AskUloRouteDecision): void {
  emitRouteDecision(decision as unknown as Record<string, unknown>)
}
