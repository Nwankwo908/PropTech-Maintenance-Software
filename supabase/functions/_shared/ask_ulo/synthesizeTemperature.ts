/**
 * OpenAI generation temperature by Ask Ulo intent.
 * Legal/finance stay cold; conversational drafts get slightly warmer phrasing.
 */

import type { AskUloIntent } from "./intent.ts"

export function synthesizeTemperatureForIntent(intent: AskUloIntent): number {
  switch (intent) {
    case "legal":
      return 0.15
    case "finance":
    case "property_price_history":
    case "rent_history":
    case "price_history_ambiguous":
      return 0.2
    case "market_rent_estimate":
    case "comparable_rentals":
    case "market_analysis":
    case "property_priority":
    case "unit_maintenance_ranking":
    case "period_summary":
    case "oldest_waiting_work_order":
      return 0.25
    case "executive_briefing":
    case "property_health":
    case "entity_investigation":
    case "vendor":
    case "maintenance":
    case "ops":
      return 0.4
    case "general":
      return 0.55
    default:
      return 0.45
  }
}
