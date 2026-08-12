/**
 * Unified executor for live domain tools (bounded allowlist only).
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { draftCommunication } from "../maintenance/draftCommunication.ts"
import { getAwaitingDecisions } from "../maintenance/getAwaitingDecisions.ts"
import { getLandlordIncentives } from "../finance/getLandlordIncentives.ts"
import { getPropertyInsights } from "../properties/getPropertyInsights.ts"
import { getWeatherAlerts } from "../localMarket/getWeatherAlerts.ts"
import { listActiveWorkflows } from "../maintenance/listActiveWorkflows.ts"
import { listResidents, type ListResidentsFilter } from "../residents/listResidents.ts"
import {
  rankVendors,
  type RankVendorsMetric,
  type RankVendorsResult,
} from "../vendors/rankVendors.ts"
import { searchWorkOrders, type SearchWorkOrdersResult } from "../maintenance/searchWorkOrders.ts"
import { searchOperationsGraph, type SearchOperationsGraphResult } from "../maintenance/searchOperationsGraph.ts"
import { rankProperties, type RankPropertiesResult } from "../properties/rankProperties.ts"
import { searchLegalSources, type SearchLegalSourcesResult } from "../legal/searchLegalSources.ts"
import { getMarketIntelligence, type GetMarketIntelligenceResult } from "../localMarket/getMarketIntelligence.ts"
import type { DomainToolId } from "./registry.ts"
import type { PlannedDomainToolCall } from "../../routing/selectTools.ts"
import type { GetAwaitingDecisionsResult } from "../maintenance/getAwaitingDecisions.ts"
import type { GetPropertyInsightsResult } from "../properties/getPropertyInsights.ts"
import type { ListActiveWorkflowsResult } from "../maintenance/listActiveWorkflows.ts"
import type { ListResidentsResult } from "../residents/listResidents.ts"
import type { DraftCommunicationResult } from "../maintenance/draftCommunication.ts"
import type { GetWeatherAlertsResult } from "../localMarket/getWeatherAlerts.ts"
import type { GetLandlordIncentivesResult } from "../finance/getLandlordIncentives.ts"
import type { AnalyticalQuery } from "../../routing/analyticalQuery.ts"
import {
  getMissingUpdates,
  getOldestWaitingWorkOrder,
  getPortfolioBriefing,
  getRecurringRepairs,
  getVendorVerification,
  investigateEntity,
  investigateOperations,
  rankUnitsByMaintenance,
  summarizePeriod,
  getPropertySnapshot,
  getPropertyPriceHistory,
  getRentHistory,
} from "./extendedDomainTools.ts"

export type ExecuteDomainToolContext = {
  organizationId: string
  question: string
  propertyId?: string | null
  buildingFilter?: string | null
  analytical?: AnalyticalQuery
}

export type ExecuteDomainToolResult =
  | { toolId: "search_work_orders"; result: SearchWorkOrdersResult }
  | { toolId: "rank_vendors"; result: RankVendorsResult }
  | { toolId: "get_property_insights"; result: GetPropertyInsightsResult }
  | { toolId: "get_awaiting_decisions"; result: GetAwaitingDecisionsResult }
  | { toolId: "list_active_workflows"; result: ListActiveWorkflowsResult }
  | { toolId: "search_residents"; result: ListResidentsResult }
  | { toolId: "draft_communication"; result: DraftCommunicationResult }
  | { toolId: "get_weather_alerts"; result: GetWeatherAlertsResult }
  | { toolId: "get_landlord_incentives"; result: GetLandlordIncentivesResult }
  | { toolId: "rank_properties"; result: RankPropertiesResult }
  | { toolId: "search_operations_graph"; result: SearchOperationsGraphResult }
  | { toolId: "search_legal_sources"; result: SearchLegalSourcesResult }
  | { toolId: "get_market_intelligence"; result: GetMarketIntelligenceResult }
  | { toolId: "get_recurring_repairs"; result: Awaited<ReturnType<typeof getRecurringRepairs>> }
  | { toolId: "get_missing_updates"; result: Awaited<ReturnType<typeof getMissingUpdates>> }
  | { toolId: "get_vendor_verification"; result: Awaited<ReturnType<typeof getVendorVerification>> }
  | { toolId: "get_portfolio_briefing"; result: Awaited<ReturnType<typeof getPortfolioBriefing>> }
  | { toolId: "summarize_period"; result: Awaited<ReturnType<typeof summarizePeriod>> }
  | {
    toolId: "get_oldest_waiting_work_order"
    result: Awaited<ReturnType<typeof getOldestWaitingWorkOrder>>
  }
  | { toolId: "investigate_entity"; result: Awaited<ReturnType<typeof investigateEntity>> }
  | {
    toolId: "investigate_operations"
    result: Awaited<ReturnType<typeof investigateOperations>>
  }
  | {
    toolId: "rank_units_by_maintenance"
    result: Awaited<ReturnType<typeof rankUnitsByMaintenance>>
  }
  | {
    toolId: "get_property_snapshot"
    result: Awaited<ReturnType<typeof getPropertySnapshot>>
  }
  | {
    toolId: "get_property_price_history"
    result: Awaited<ReturnType<typeof getPropertyPriceHistory>>
  }
  | { toolId: "get_rent_history"; result: Awaited<ReturnType<typeof getRentHistory>> }

function asString(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null
}

function asBool(v: unknown): boolean | undefined {
  return typeof v === "boolean" ? v : undefined
}

function asInt(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : undefined
}

function asRankMetric(v: unknown): RankVendorsMetric {
  const allowed: RankVendorsMetric[] = [
    "response_time",
    "response_rate",
    "acceptance_rate",
    "completion_rate",
    "completed_jobs",
    "active_jobs",
    "decline_rate",
    "overall_quality",
    "inactive",
    "workload",
  ]
  if (typeof v === "string" && allowed.includes(v as RankVendorsMetric)) {
    return v as RankVendorsMetric
  }
  return "overall_quality"
}

function asResidentFilter(v: unknown): ListResidentsFilter | null {
  const allowed: ListResidentsFilter[] = [
    "late_rent",
    "outstanding_balance",
    "lease_ending",
    "high_maintenance_activity",
    "move_in",
    "move_out",
    "message_nonresponse",
  ]
  if (typeof v === "string" && allowed.includes(v as ListResidentsFilter)) {
    return v as ListResidentsFilter
  }
  return null
}

export async function executeDomainTool(
  supabase: SupabaseClient,
  call: PlannedDomainToolCall,
  ctx: ExecuteDomainToolContext,
): Promise<ExecuteDomainToolResult | null> {
  const args = call.arguments ?? {}
  switch (call.name) {
    case "search_work_orders":
      return {
        toolId: "search_work_orders",
        result: await searchWorkOrders(supabase, {
          organizationId: ctx.organizationId,
          propertyId: ctx.propertyId,
          buildingFilter: ctx.buildingFilter,
          category: asString(args.category),
          status: asString(args.status),
          query: asString(args.query) ?? ctx.question,
          approvalRequired: asBool(args.approvalRequired),
          slaExpired: asBool(args.slaExpired),
          includeCompleted: asBool(args.includeCompleted),
          sortBy: (asString(args.sortBy) as "created_at" | "days_open" | "priority" | null) ??
            undefined,
          sortOrder: (asString(args.sortOrder) as "asc" | "desc" | null) ?? undefined,
          dateRangeDays: asInt(args.dateRangeDays),
          limit: asInt(args.limit),
        }),
      }
    case "rank_vendors":
      return {
        toolId: "rank_vendors",
        result: await rankVendors(supabase, {
          organizationId: ctx.organizationId,
          propertyId: ctx.propertyId,
          buildingFilter: ctx.buildingFilter,
          trade: asString(args.trade),
          metric: asRankMetric(args.metric),
          order: (asString(args.order) as "asc" | "desc" | null) ?? undefined,
          limit: asInt(args.limit),
          question: ctx.question,
        }),
      }
    case "get_property_insights":
      return {
        toolId: "get_property_insights",
        result: await getPropertyInsights(supabase, {
          organizationId: ctx.organizationId,
          propertyId: ctx.propertyId,
          insightTypes: Array.isArray(args.insightTypes)
            ? (args.insightTypes as Array<
              "recurring_issues" | "needs_attention" | "vendor_response" | "preventive_repairs"
            >)
            : undefined,
          dateRangeDays: asInt(args.dateRangeDays),
        }),
      }
    case "get_awaiting_decisions":
      return {
        toolId: "get_awaiting_decisions",
        result: await getAwaitingDecisions(supabase, {
          organizationId: ctx.organizationId,
          propertyId: ctx.propertyId,
          priorities: Array.isArray(args.priorities)
            ? args.priorities.filter((p): p is string => typeof p === "string")
            : undefined,
          maintenanceOnly: asBool(args.maintenanceOnly) ?? true,
          limit: asInt(args.limit),
        }),
      }
    case "list_active_workflows":
      return {
        toolId: "list_active_workflows",
        result: await listActiveWorkflows(supabase, {
          organizationId: ctx.organizationId,
          limit: asInt(args.limit),
        }),
      }
    case "search_residents":
      return {
        toolId: "search_residents",
        result: await listResidents(supabase, {
          organizationId: ctx.organizationId,
          propertyId: ctx.propertyId,
          buildingFilter: ctx.buildingFilter,
          filter: asResidentFilter(args.filter),
          sortBy: (asString(args.sortBy) as
            | "balance_due"
            | "days_overdue"
            | "name"
            | "move_in_date"
            | "awaiting_reply_hours"
            | null) ?? undefined,
          sortOrder: (asString(args.sortOrder) as "asc" | "desc" | null) ?? undefined,
          dateRangeDays: asInt(args.dateRangeDays),
          limit: asInt(args.limit),
        }),
      }
    case "draft_communication":
      return {
        toolId: "draft_communication",
        result: draftCommunication({ question: ctx.question }),
      }
    case "get_weather_alerts":
      return {
        toolId: "get_weather_alerts",
        result: await getWeatherAlerts(supabase, {
          organizationId: ctx.organizationId,
        }),
      }
    case "get_landlord_incentives":
      return {
        toolId: "get_landlord_incentives",
        result: await getLandlordIncentives(supabase, {
          organizationId: ctx.organizationId,
        }),
      }
    case "rank_properties":
      return {
        toolId: "rank_properties",
        result: await rankProperties(supabase, {
          organizationId: ctx.organizationId,
          propertyId: ctx.propertyId,
          limit: asInt(args.limit),
        }),
      }
    case "search_operations_graph":
      return {
        toolId: "search_operations_graph",
        result: await searchOperationsGraph(supabase, {
          organizationId: ctx.organizationId,
          propertyId: ctx.propertyId,
          buildingFilter: ctx.buildingFilter,
          eventLimit: asInt(args.eventLimit),
          query: asString(args.query) ?? ctx.question,
        }),
      }
    case "search_legal_sources":
      return {
        toolId: "search_legal_sources",
        result: await searchLegalSources(supabase, {
          question: asString(args.query) ?? ctx.question,
          stateCode: asString(args.stateCode),
          citySlug: asString(args.citySlug),
          countySlug: asString(args.countySlug),
          countryCode: asString(args.countryCode) ?? "US",
          housingProgram: asString(args.housingProgram),
          includeRag: asBool(args.includeRag) ?? true,
          includeStructured: asBool(args.includeStructured) ?? true,
          matchCount: asInt(args.matchCount),
        }),
      }
    case "get_market_intelligence":
      return {
        toolId: "get_market_intelligence",
        result: await getMarketIntelligence({
          buildingName: asString(args.buildingName) ?? ctx.buildingFilter ?? null,
          cityLabel: asString(args.cityLabel),
          stateCode: asString(args.stateCode),
          addressLine: asString(args.addressLine),
          portfolioMonthlyRent: asInt(args.portfolioMonthlyRent) ?? null,
        }),
      }
    case "get_recurring_repairs":
      return {
        toolId: "get_recurring_repairs",
        result: await getRecurringRepairs(supabase, {
          organizationId: ctx.organizationId,
        }),
      }
    case "get_missing_updates":
      return {
        toolId: "get_missing_updates",
        result: await getMissingUpdates(supabase, {
          organizationId: ctx.organizationId,
        }),
      }
    case "get_vendor_verification":
      return {
        toolId: "get_vendor_verification",
        result: await getVendorVerification(supabase, {
          organizationId: ctx.organizationId,
        }),
      }
    case "get_portfolio_briefing":
      return {
        toolId: "get_portfolio_briefing",
        result: await getPortfolioBriefing(supabase, {
          organizationId: ctx.organizationId,
        }),
      }
    case "summarize_period":
      return {
        toolId: "summarize_period",
        result: await summarizePeriod(supabase, {
          organizationId: ctx.organizationId,
          question: asString(args.question) ?? ctx.question,
          buildingFilter: ctx.buildingFilter,
        }),
      }
    case "get_oldest_waiting_work_order":
      return {
        toolId: "get_oldest_waiting_work_order",
        result: await getOldestWaitingWorkOrder(supabase, {
          organizationId: ctx.organizationId,
          buildingFilter: ctx.buildingFilter,
        }),
      }
    case "investigate_entity":
      return {
        toolId: "investigate_entity",
        result: await investigateEntity(supabase, {
          organizationId: ctx.organizationId,
          question: asString(args.question) ?? ctx.question,
          buildingFilter: ctx.buildingFilter,
        }),
      }
    case "investigate_operations":
      return {
        toolId: "investigate_operations",
        result: await investigateOperations(supabase, {
          organizationId: ctx.organizationId,
          question: asString(args.question) ?? ctx.question,
          buildingFilter: ctx.buildingFilter,
        }),
      }
    case "rank_units_by_maintenance":
      return {
        toolId: "rank_units_by_maintenance",
        result: await rankUnitsByMaintenance(supabase, {
          organizationId: ctx.organizationId,
          buildingFilter: ctx.buildingFilter,
          analytical: ctx.analytical,
        }),
      }
    case "get_property_snapshot":
      return {
        toolId: "get_property_snapshot",
        result: await getPropertySnapshot(supabase, {
          organizationId: ctx.organizationId,
          question: asString(args.question) ?? ctx.question,
          jurisdiction: {
            stateCode: asString(args.stateCode),
            cityLabel: asString(args.cityLabel),
            citySlug: asString(args.citySlug),
          },
        }),
      }
    case "get_property_price_history":
      return {
        toolId: "get_property_price_history",
        result: await getPropertyPriceHistory({
          buildingName: asString(args.buildingName) ?? ctx.buildingFilter ?? null,
          addressLine: asString(args.addressLine),
          clarifyOnly: asBool(args.clarifyOnly),
        }),
      }
    case "get_rent_history":
      return {
        toolId: "get_rent_history",
        result: await getRentHistory({
          buildingName: asString(args.buildingName) ?? ctx.buildingFilter ?? null,
          cityLabel: asString(args.cityLabel),
          stateCode: asString(args.stateCode),
          addressLine: asString(args.addressLine),
        }),
      }
    default:
      return null
  }
}

export async function executePlannedDomainTools(
  supabase: SupabaseClient,
  planned: PlannedDomainToolCall[],
  ctx: ExecuteDomainToolContext,
  only?: ReadonlySet<DomainToolId>,
): Promise<ExecuteDomainToolResult[]> {
  const results: ExecuteDomainToolResult[] = []
  for (const call of planned) {
    if (only && !only.has(call.name)) continue
    const executed = await executeDomainTool(supabase, call, ctx)
    if (executed) results.push(executed)
  }
  return results
}
