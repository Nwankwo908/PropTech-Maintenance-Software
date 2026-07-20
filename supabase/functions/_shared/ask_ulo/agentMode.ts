/**
 * Agent-mode bias for Ask Ulo (UI chip → retrieval intent).
 * Modes nudge routing; they do not invent legal answers without sources.
 */

import type { AskUloIntent, AskUloIntentResult } from "./intent.ts"

export type AskUloAgentMode =
  | "ulo_agent"
  | "legal_insights"
  | "financial_insights"
  | "maintenance_pro"
  | "market_intelligence"

const HIGH_CONFIDENCE_KEEP = new Set<AskUloIntent>([
  "property_price_history",
  "rent_history",
  "market_rent_estimate",
  "comparable_rentals",
  "market_analysis",
  "price_history_ambiguous",
  "executive_briefing",
  "period_summary",
  "property_priority",
  "unit_maintenance_ranking",
  "oldest_waiting_work_order",
  "entity_investigation",
])

export function parseAskUloAgentMode(raw: unknown): AskUloAgentMode | null {
  if (typeof raw !== "string") return null
  const v = raw.trim()
  if (
    v === "ulo_agent" ||
    v === "legal_insights" ||
    v === "financial_insights" ||
    v === "maintenance_pro" ||
    v === "market_intelligence"
  ) {
    return v
  }
  return null
}

/**
 * Apply UI agent mode as a soft bias on classified intent.
 * Strong high-confidence domain intents (e.g. market analysis) are preserved.
 */
export function applyAskUloAgentModeBias(
  result: AskUloIntentResult,
  agentMode: AskUloAgentMode | null | undefined,
): AskUloIntentResult {
  if (!agentMode || agentMode === "ulo_agent") return result

  if (result.confidence === "high" && HIGH_CONFIDENCE_KEEP.has(result.intent)) {
    return result
  }

  switch (agentMode) {
    case "legal_insights":
      if (result.intent === "legal") return result
      return { intent: "legal", confidence: "medium", label: "Legal Insights" }
    case "financial_insights":
      if (result.intent === "finance") return result
      if (result.confidence === "high" && (result.intent === "maintenance" || result.intent === "legal")) {
        return result
      }
      return { intent: "finance", confidence: "medium", label: "Financial Insights" }
    case "maintenance_pro":
      if (
        result.intent === "maintenance" ||
        result.intent === "unit_maintenance_ranking" ||
        result.intent === "oldest_waiting_work_order" ||
        result.intent === "entity_investigation"
      ) {
        return result
      }
      if (result.confidence === "high" && (result.intent === "legal" || result.intent === "vendor")) {
        return result
      }
      return { intent: "maintenance", confidence: "medium", label: "Maintenance Pro" }
    case "market_intelligence":
      if (
        result.intent === "market_analysis" ||
        result.intent === "market_rent_estimate" ||
        result.intent === "comparable_rentals"
      ) {
        return result
      }
      return { intent: "market_analysis", confidence: "medium", label: "Market Intelligence" }
    default:
      return result
  }
}
