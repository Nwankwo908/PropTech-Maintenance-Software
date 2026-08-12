/**
 * Domain tool registry — reusable, parameterized operational tools.
 * Ask Ulo and (later) UI features call the same server-side tools.
 */

export type DomainToolId =
  | "search_work_orders"
  | "get_property_insights"
  | "get_awaiting_decisions"
  | "list_active_workflows"
  | "rank_vendors"
  | "search_operations_graph"
  | "search_residents"
  | "rank_properties"
  | "search_legal_sources"
  | "get_market_intelligence"
  | "draft_communication"
  | "get_weather_alerts"
  | "get_landlord_incentives"
  | "get_recurring_repairs"
  | "get_missing_updates"
  | "get_vendor_verification"
  | "get_portfolio_briefing"
  | "summarize_period"
  | "get_oldest_waiting_work_order"
  | "investigate_entity"
  | "investigate_operations"
  | "rank_units_by_maintenance"
  | "get_property_snapshot"
  | "get_property_price_history"
  | "get_rent_history"

export type DomainToolSubject =
  | "work_order"
  | "maintenance"
  | "workflow"
  | "vendor"
  | "resident"
  | "property"
  | "finance"
  | "document"
  | "legal"
  | "market_intelligence"
  | "incentives"
  | "unit"

export type DomainToolMeta = {
  id: DomainToolId
  label: string
  subject: DomainToolSubject
  description: string
  /** Migration status toward the hybrid tool engine. */
  status: "live" | "wrap" | "planned"
}

export const DOMAIN_TOOL_REGISTRY: DomainToolMeta[] = [
  {
    id: "search_work_orders",
    label: "Search work orders",
    subject: "work_order",
    description:
      "Parameterized work-order search (category, status, SLA, completed, property scope).",
    status: "live",
  },
  {
    id: "get_property_insights",
    label: "Property Insights",
    subject: "property",
    description: "Tier-1 Property Insights intelligence.",
    status: "live",
  },
  {
    id: "get_awaiting_decisions",
    label: "Awaiting decisions",
    subject: "workflow",
    description: "Needs Your Attention / repairs to approve.",
    status: "live",
  },
  {
    id: "list_active_workflows",
    label: "Active Ulo workflows",
    subject: "workflow",
    description:
      "What Ulo is handling right now — active/escalated workflow_runs by domain (not portfolio health).",
    status: "live",
  },
  {
    id: "rank_vendors",
    label: "Rank vendors",
    subject: "vendor",
    description: "Vendor metrics: best, speed, completion, inactive, overload.",
    status: "live",
  },
  {
    id: "search_operations_graph",
    label: "Operations graph",
    subject: "workflow",
    description: "Search operations_graph_events.",
    status: "live",
  },
  {
    id: "search_residents",
    label: "Search residents",
    subject: "resident",
    description:
      "Residents including late-rent / arrears (late_rent → tools/rent/searchLateRent), move-in, message non-response.",
    status: "live",
  },
  {
    id: "rank_properties",
    label: "Rank properties",
    subject: "property",
    description: "Property priority ranking (only for property-subject questions).",
    status: "live",
  },
  {
    id: "search_legal_sources",
    label: "Legal sources",
    subject: "legal",
    description: "Legal RAG + structured compliance facts.",
    status: "live",
  },
  {
    id: "get_market_intelligence",
    label: "Market intelligence",
    subject: "market_intelligence",
    description: "Rent AVM, comps, ZORI / market packets.",
    status: "live",
  },
  {
    id: "draft_communication",
    label: "Draft communication",
    subject: "document",
    description: "Draft notices, emails, checklists, and resident messages.",
    status: "live",
  },
  {
    id: "get_weather_alerts",
    label: "Weather alerts",
    subject: "property",
    description: "NWS active weather alerts for portfolio property locations.",
    status: "live",
  },
  {
    id: "get_landlord_incentives",
    label: "Landlord grants & tax incentives",
    subject: "incentives",
    description:
      "Jurisdiction-scoped curated official catalog of landlord grants, tax credits, and energy incentives.",
    status: "live",
  },
  {
    id: "get_recurring_repairs",
    label: "Recurring repairs",
    subject: "maintenance",
    description: "Repair-level recurring pattern analysis (not Property Insights cards alone).",
    status: "live",
  },
  {
    id: "get_missing_updates",
    label: "Missing work order updates",
    subject: "maintenance",
    description: "Open tickets stuck without progress or vendor updates.",
    status: "live",
  },
  {
    id: "get_vendor_verification",
    label: "Vendor verification status",
    subject: "vendor",
    description: "Verification / compliance status from vendor_verifications roster.",
    status: "live",
  },
  {
    id: "get_portfolio_briefing",
    label: "Portfolio executive briefing",
    subject: "property",
    description: "Tier-1 portfolio health briefing (explicit executive briefing only).",
    status: "live",
  },
  {
    id: "summarize_period",
    label: "Period activity summary",
    subject: "workflow",
    description: "What happened this week/month — maintenance, vendor, rent activity.",
    status: "live",
  },
  {
    id: "get_oldest_waiting_work_order",
    label: "Oldest waiting work order",
    subject: "work_order",
    description: "Single ranked ticket waiting the longest.",
    status: "live",
  },
  {
    id: "investigate_entity",
    label: "Entity investigation",
    subject: "work_order",
    description: "Deep dive on a specific work order, unit, or vendor referenced in the question.",
    status: "live",
  },
  {
    id: "investigate_operations",
    label: "Deep operations investigation",
    subject: "maintenance",
    description: "Why-not-resolved / repair cost / multi-signal operational investigation.",
    status: "live",
  },
  {
    id: "rank_units_by_maintenance",
    label: "Rank units by maintenance volume",
    subject: "unit",
    description: "Unit-level maintenance request volume ranking.",
    status: "live",
  },
  {
    id: "get_property_snapshot",
    label: "Property snapshot",
    subject: "property",
    description:
      "Lightweight building inventory and location context for market, finance, and legal personalization.",
    status: "live",
  },
  {
    id: "get_property_price_history",
    label: "Property price history",
    subject: "finance",
    description: "Sale and valuation history for a scoped property.",
    status: "live",
  },
  {
    id: "get_rent_history",
    label: "Rent history",
    subject: "finance",
    description: "Historical rent trends for a scoped property or market.",
    status: "live",
  },
]

export function getDomainTool(id: DomainToolId): DomainToolMeta | undefined {
  return DOMAIN_TOOL_REGISTRY.find((t) => t.id === id)
}
