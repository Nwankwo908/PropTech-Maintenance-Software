/**
 * Unified executor for live domain tools (bounded allowlist only).
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { draftCommunication } from "./draftCommunication.ts"
import { getAwaitingDecisions } from "./getAwaitingDecisions.ts"
import { getLandlordIncentives } from "./getLandlordIncentives.ts"
import { getPropertyInsights } from "./getPropertyInsights.ts"
import { getWeatherAlerts } from "./getWeatherAlerts.ts"
import { listActiveWorkflows } from "./listActiveWorkflows.ts"
import { listResidents, type ListResidentsFilter } from "./listResidents.ts"
import {
  rankVendors,
  type RankVendorsMetric,
  type RankVendorsResult,
} from "./rankVendors.ts"
import { searchWorkOrders, type SearchWorkOrdersResult } from "./searchWorkOrders.ts"
import type { DomainToolId } from "./registry.ts"
import type { PlannedDomainToolCall } from "./openaiToolSelect.ts"
import type { GetAwaitingDecisionsResult } from "./getAwaitingDecisions.ts"
import type { GetPropertyInsightsResult } from "./getPropertyInsights.ts"
import type { ListActiveWorkflowsResult } from "./listActiveWorkflows.ts"
import type { ListResidentsResult } from "./listResidents.ts"
import type { DraftCommunicationResult } from "./draftCommunication.ts"
import type { GetWeatherAlertsResult } from "./getWeatherAlerts.ts"
import type { GetLandlordIncentivesResult } from "./getLandlordIncentives.ts"

export type ExecuteDomainToolContext = {
  organizationId: string
  question: string
  propertyId?: string | null
  buildingFilter?: string | null
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
          filter: asResidentFilter(args.filter),
          sortOrder: (asString(args.sortOrder) as "asc" | "desc" | null) ?? undefined,
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
