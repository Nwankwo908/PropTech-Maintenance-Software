/**
 * Controlled routing: subject + capability → allowed / required tools.
 * The LLM may later choose among allowed tools — never unrestricted registry access.
 */

import type { AskUloCapability } from "./capability.ts"
import type { DomainToolId } from "./domainTools/registry.ts"
import type { AskUloQuestionSubject } from "./questionSubjectMatch.ts"

export type AskUloCapabilityRoute = {
  subject: AskUloQuestionSubject
  capability: AskUloCapability
  requiredTools: DomainToolId[]
  optionalTools: DomainToolId[]
}

type RouteKey = `${AskUloQuestionSubject}:${AskUloCapability}`

const ROUTES: Partial<Record<RouteKey, Omit<AskUloCapabilityRoute, "subject" | "capability">>> = {
  "maintenance:identify_pending_decision": {
    requiredTools: ["get_awaiting_decisions", "search_work_orders"],
    optionalTools: ["search_operations_graph"],
  },
  "work_order:identify_pending_decision": {
    requiredTools: ["get_awaiting_decisions", "search_work_orders"],
    optionalTools: ["search_operations_graph"],
  },
  "maintenance:identify_recurring_pattern": {
    requiredTools: ["get_property_insights", "search_work_orders"],
    optionalTools: ["search_operations_graph"],
  },
  "work_order:identify_recurring_pattern": {
    requiredTools: ["get_property_insights", "search_work_orders"],
    optionalTools: ["search_operations_graph"],
  },
  "maintenance:identify_risk": {
    requiredTools: ["get_property_insights", "search_work_orders"],
    optionalTools: ["get_awaiting_decisions", "search_operations_graph"],
  },
  "work_order:identify_risk": {
    requiredTools: ["get_property_insights", "search_work_orders"],
    optionalTools: ["get_awaiting_decisions"],
  },
  "maintenance:estimate_cost": {
    requiredTools: ["search_work_orders"],
    optionalTools: ["search_operations_graph"],
  },
  "work_order:estimate_cost": {
    requiredTools: ["search_work_orders"],
    optionalTools: ["search_operations_graph"],
  },
  "work_order:rank": {
    requiredTools: ["search_work_orders"],
    optionalTools: ["get_property_insights"],
  },
  "work_order:search": {
    requiredTools: ["search_work_orders"],
    optionalTools: ["get_awaiting_decisions", "search_operations_graph"],
  },
  "maintenance:search": {
    requiredTools: ["search_work_orders"],
    optionalTools: ["get_awaiting_decisions", "get_property_insights"],
  },
  "vendor:rank": {
    requiredTools: ["rank_vendors"],
    optionalTools: ["search_work_orders"],
  },
  "vendor:search": {
    requiredTools: ["rank_vendors"],
    optionalTools: ["search_work_orders"],
  },
  "vendor:recommend": {
    requiredTools: ["rank_vendors"],
    optionalTools: ["search_work_orders"],
  },
  "resident:search": {
    requiredTools: ["search_residents"],
    optionalTools: [],
  },
  "property:rank": {
    requiredTools: ["rank_properties"],
    optionalTools: ["get_property_insights"],
  },
  "property:identify_risk": {
    requiredTools: ["get_property_insights", "rank_properties"],
    optionalTools: ["search_work_orders"],
  },
  "portfolio:summarize": {
    requiredTools: ["get_property_insights"],
    optionalTools: ["rank_properties", "search_work_orders"],
  },
  "portfolio:recommend": {
    requiredTools: ["rank_properties", "get_awaiting_decisions"],
    optionalTools: ["get_property_insights", "search_work_orders"],
  },
  "property:recommend": {
    requiredTools: ["rank_properties", "get_awaiting_decisions"],
    optionalTools: ["get_property_insights"],
  },
  "workflow:search": {
    requiredTools: ["list_active_workflows", "get_awaiting_decisions"],
    optionalTools: ["search_operations_graph", "search_work_orders"],
  },
  "workflow:explain_status": {
    requiredTools: ["list_active_workflows"],
    optionalTools: ["get_awaiting_decisions", "search_operations_graph"],
  },
  "workflow:identify_pending_decision": {
    requiredTools: ["get_awaiting_decisions"],
    optionalTools: ["list_active_workflows", "search_work_orders"],
  },
  "finance:search": {
    requiredTools: ["search_work_orders"],
    optionalTools: ["get_property_insights"],
  },
  "finance:estimate_cost": {
    requiredTools: ["search_work_orders"],
    optionalTools: [],
  },
  "lease:search": {
    requiredTools: ["search_residents"],
    optionalTools: [],
  },
  "document:search": {
    requiredTools: ["search_legal_sources"],
    optionalTools: [],
  },
  "legal:legal_lookup": {
    requiredTools: ["search_legal_sources"],
    optionalTools: [],
  },
  "local_regulation:legal_lookup": {
    requiredTools: ["search_legal_sources"],
    optionalTools: [],
  },
  "market_intelligence:search": {
    requiredTools: ["get_market_intelligence"],
    optionalTools: [],
  },
  "weather:search": {
    requiredTools: ["get_weather_alerts"],
    optionalTools: [],
  },
  "incentives:search": {
    requiredTools: ["get_landlord_incentives"],
    optionalTools: [],
  },
  "unit:rank": {
    requiredTools: ["search_work_orders"],
    optionalTools: ["get_property_insights"],
  },
  "other:draft": {
    requiredTools: ["draft_communication"],
    optionalTools: [],
  },
  "resident:draft": {
    requiredTools: ["draft_communication"],
    optionalTools: [],
  },
  "vendor:draft": {
    requiredTools: ["draft_communication"],
    optionalTools: [],
  },
  "document:draft": {
    requiredTools: ["draft_communication"],
    optionalTools: [],
  },
  "workflow:draft": {
    requiredTools: ["draft_communication"],
    optionalTools: [],
  },
}

const DEFAULT_BY_SUBJECT: Partial<
  Record<AskUloQuestionSubject, Omit<AskUloCapabilityRoute, "subject" | "capability">>
> = {
  vendor: { requiredTools: ["rank_vendors"], optionalTools: ["search_work_orders"] },
  resident: { requiredTools: ["search_residents"], optionalTools: [] },
  work_order: { requiredTools: ["search_work_orders"], optionalTools: ["get_awaiting_decisions"] },
  maintenance: {
    requiredTools: ["search_work_orders", "get_property_insights"],
    optionalTools: ["get_awaiting_decisions"],
  },
  workflow: {
    requiredTools: ["list_active_workflows"],
    optionalTools: ["get_awaiting_decisions", "search_operations_graph"],
  },
  property: { requiredTools: ["rank_properties"], optionalTools: ["get_property_insights"] },
  legal: { requiredTools: ["search_legal_sources"], optionalTools: [] },
  market_intelligence: { requiredTools: ["get_market_intelligence"], optionalTools: [] },
  weather: { requiredTools: ["get_weather_alerts"], optionalTools: [] },
  incentives: { requiredTools: ["get_landlord_incentives"], optionalTools: [] },
}

export function resolveCapabilityRoute(input: {
  subject: AskUloQuestionSubject
  capability: AskUloCapability
}): AskUloCapabilityRoute {
  const key = `${input.subject}:${input.capability}` as RouteKey
  const exact = ROUTES[key]
  if (exact) {
    return {
      subject: input.subject,
      capability: input.capability,
      ...exact,
    }
  }
  if (input.capability === "draft") {
    return {
      subject: input.subject,
      capability: input.capability,
      requiredTools: ["draft_communication"],
      optionalTools: [],
    }
  }
  const bySubject = DEFAULT_BY_SUBJECT[input.subject]
  if (bySubject) {
    return {
      subject: input.subject,
      capability: input.capability,
      ...bySubject,
    }
  }
  return {
    subject: input.subject,
    capability: input.capability,
    requiredTools: ["search_work_orders"],
    optionalTools: [],
  }
}

export function routeRequiresTool(
  route: AskUloCapabilityRoute,
  tool: DomainToolId,
): boolean {
  return route.requiredTools.includes(tool) || route.optionalTools.includes(tool)
}
