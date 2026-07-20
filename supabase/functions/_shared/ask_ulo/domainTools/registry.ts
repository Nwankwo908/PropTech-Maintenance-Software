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
    status: "wrap",
  },
  {
    id: "search_residents",
    label: "Search residents",
    subject: "resident",
    description: "Residents including late-rent / arrears filters.",
    status: "live",
  },
  {
    id: "rank_properties",
    label: "Rank properties",
    subject: "property",
    description: "Property priority ranking (only for property-subject questions).",
    status: "wrap",
  },
  {
    id: "search_legal_sources",
    label: "Legal sources",
    subject: "legal",
    description: "Legal RAG + structured compliance facts.",
    status: "wrap",
  },
  {
    id: "get_market_intelligence",
    label: "Market intelligence",
    subject: "market_intelligence",
    description: "Rent AVM, comps, ZORI / market packets.",
    status: "wrap",
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
]

export function getDomainTool(id: DomainToolId): DomainToolMeta | undefined {
  return DOMAIN_TOOL_REGISTRY.find((t) => t.id === id)
}
