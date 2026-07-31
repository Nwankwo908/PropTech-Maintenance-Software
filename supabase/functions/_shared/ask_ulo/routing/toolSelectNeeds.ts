/**
 * Allowlist + needs-patch helpers for bounded domain tool planning.
 * Rule route and optional OpenAI select both feed the same PlannedDomainToolCall shape.
 */

import type { AskUloCapabilityResult } from "./capability.ts"
import type { AskUloCapabilityRoute } from "./capabilityRoute.ts"
import { getDomainTool, type DomainToolId } from "../tools/_shared/registry.ts"
import type { RankVendorsMetric } from "../tools/vendors/rankVendors.ts"
import type { PlannedDomainToolCall } from "./selectTools.ts"
import { isEntityInvestigationQuestion } from "../tools/maintenance/entityInvestigation.ts"
import { isPeriodSummaryQuestion } from "./dynamicResponse.ts"

export type ToolSelectSubjectLocks = {
  /** Vendor / resident / work-order subjects — no property dashboard tools. */
  blockPropertyDashboard: boolean
  /** Vendor-focused questions — do not pull property insights. */
  vendorLock: boolean
}

/** Live tools from the capability route, minus subject-gated IDs. */
export function buildToolSelectAllowlist(
  route: AskUloCapabilityRoute,
  locks: ToolSelectSubjectLocks,
): DomainToolId[] {
  const ids = [...new Set([...route.requiredTools, ...route.optionalTools])]
  return ids.filter((id) => {
    const meta = getDomainTool(id)
    if (!meta || meta.status !== "live") return false
    if (locks.blockPropertyDashboard && id === "rank_properties") return false
    if (locks.vendorLock && id === "get_property_insights") return false
    return true
  })
}

function metricFromHints(hints: AskUloCapabilityResult["hints"]): RankVendorsMetric {
  if (hints.vendorMetric) return hints.vendorMetric
  const m = (hints.metric ?? "").toLowerCase()
  if (m.includes("inactive") || m.includes("not_accept")) return "inactive"
  if (m.includes("workload") || m.includes("overload") || m.includes("busy")) {
    return "workload"
  }
  if (m.includes("completion") || m.includes("completed")) return "completion_rate"
  if (m.includes("speed") || m.includes("response") || m.includes("fast")) {
    return "response_time"
  }
  return "overall_quality"
}

function parseRankMetric(raw: unknown): RankVendorsMetric | null {
  if (typeof raw !== "string") return null
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
  return allowed.includes(raw as RankVendorsMetric)
    ? (raw as RankVendorsMetric)
    : null
}

/** Deterministic plan from required live tools + capability hints (rule fallback). */
export function planToolsFromCapabilityRoute(input: {
  route: AskUloCapabilityRoute
  hints: AskUloCapabilityResult["hints"]
  locks: ToolSelectSubjectLocks
  question?: string
}): PlannedDomainToolCall[] {
  const allowlist = buildToolSelectAllowlist(input.route, input.locks)
  const allowSet = new Set(allowlist)
  const required = new Set(input.route.requiredTools)
  const byName = new Map<string, PlannedDomainToolCall>()

  const push = (id: DomainToolId, args: Record<string, unknown> = {}) => {
    if (!allowSet.has(id)) return
    if (!byName.has(id)) {
      byName.set(id, { name: id, arguments: args })
    }
  }

  for (const id of allowlist) {
    if (!required.has(id)) continue
    const args: Record<string, unknown> = {}
    if (id === "rank_vendors") {
      args.metric = metricFromHints(input.hints)
      if (input.hints.order) args.order = input.hints.order
    }
    if (id === "search_residents" && input.hints.residentFilter) {
      args.filter = input.hints.residentFilter
    }
    if (id === "search_work_orders") {
      if (input.hints.approvalRequired) args.approvalRequired = true
      if (input.hints.includeCompleted) args.includeCompleted = true
    }
    if (id === "get_awaiting_decisions" && input.hints.priorities?.length) {
      args.priorities = input.hints.priorities
    }
    if (id === "summarize_period" && input.question) {
      args.question = input.question
    }
    if (
      (id === "investigate_operations" || id === "investigate_entity") &&
      input.question
    ) {
      args.question = input.question
    }
    push(id, args)
  }

  const { hints, route, question } = input
  if (hints.metric === "missing_updates") push("get_missing_updates")
  if (hints.metric === "wait_age") push("get_oldest_waiting_work_order")
  if (hints.metric === "vendor_verification") push("get_vendor_verification")
  if (hints.metric === "request_count" && hints.groupBy?.includes("unit")) {
    push("rank_units_by_maintenance")
  }
  if (route.capability === "summarize" && question && isPeriodSummaryQuestion(question)) {
    push("summarize_period", { question })
  }
  if (route.capability === "investigate_root_cause") {
    push("investigate_operations", question ? { question } : {})
    if (question && isEntityInvestigationQuestion(question)) {
      push("investigate_entity", { question })
    }
  }

  return [...byName.values()]
}

export type DomainToolNeedsPatch = {
  needsDraftCommunication: boolean
  needsActiveWorkflows: boolean
  needsWeatherAlerts: boolean
  needsLandlordIncentives: boolean
  needsListResidents: boolean
  needsPropertyInsights: boolean
  needsApproveRepairs: boolean
  needsVendorResponseSpeed: boolean
  needsVendorBest: boolean
  needsVendorCompletion: boolean
  needsVendorInactive: boolean
  needsVendorOverload: boolean
  /** Planned but not yet a dedicated Promise.all path — execute via executeDomainTool. */
  needsSearchWorkOrders: boolean
  needsRankProperties: boolean
  needsOpsGraph: boolean
  needsLegalSources: boolean
  needsMarketIntelligence: boolean
  needsRecurringRepairs: boolean
  needsMissingUpdates: boolean
  needsVendorVerification: boolean
  needsBriefing: boolean
  needsPeriodSummary: boolean
  needsOldestWaiting: boolean
  needsEntityInvestigation: boolean
  needsDeepOps: boolean
  needsUnitRanking: boolean
  rankVendorsMetric: RankVendorsMetric | null
  plannedToolIds: DomainToolId[]
}

export function emptyNeedsPatch(): DomainToolNeedsPatch {
  return {
    needsDraftCommunication: false,
    needsActiveWorkflows: false,
    needsWeatherAlerts: false,
    needsLandlordIncentives: false,
    needsListResidents: false,
    needsPropertyInsights: false,
    needsApproveRepairs: false,
    needsVendorResponseSpeed: false,
    needsVendorBest: false,
    needsVendorCompletion: false,
    needsVendorInactive: false,
    needsVendorOverload: false,
    needsSearchWorkOrders: false,
    needsRankProperties: false,
    needsOpsGraph: false,
    needsLegalSources: false,
    needsMarketIntelligence: false,
    needsRecurringRepairs: false,
    needsMissingUpdates: false,
    needsVendorVerification: false,
    needsBriefing: false,
    needsPeriodSummary: false,
    needsOldestWaiting: false,
    needsEntityInvestigation: false,
    needsDeepOps: false,
    needsUnitRanking: false,
    rankVendorsMetric: null,
    plannedToolIds: [],
  }
}

function applyRankMetric(
  patch: DomainToolNeedsPatch,
  metric: RankVendorsMetric,
): void {
  patch.rankVendorsMetric = metric
  if (metric === "response_time" || metric === "response_rate" || metric === "acceptance_rate") {
    patch.needsVendorResponseSpeed = true
    return
  }
  if (metric === "completion_rate" || metric === "completed_jobs") {
    patch.needsVendorCompletion = true
    return
  }
  if (metric === "inactive") {
    patch.needsVendorInactive = true
    return
  }
  if (metric === "workload" || metric === "active_jobs" || metric === "decline_rate") {
    patch.needsVendorOverload = true
    return
  }
  patch.needsVendorBest = true
}

/** Map planned tool calls onto the runAskUlo needs* flags. */
export function applyPlannedToolsToNeeds(
  planned: PlannedDomainToolCall[],
  locks: ToolSelectSubjectLocks,
): DomainToolNeedsPatch {
  const patch = emptyNeedsPatch()
  for (const call of planned) {
    patch.plannedToolIds.push(call.name)
    switch (call.name) {
      case "draft_communication":
        patch.needsDraftCommunication = true
        break
      case "list_active_workflows":
        patch.needsActiveWorkflows = true
        break
      case "get_weather_alerts":
        patch.needsWeatherAlerts = true
        break
      case "get_landlord_incentives":
        patch.needsLandlordIncentives = true
        break
      case "search_residents":
        patch.needsListResidents = true
        break
      case "get_property_insights":
        if (!locks.vendorLock) {
          patch.needsPropertyInsights = true
        }
        break
      case "get_awaiting_decisions":
        patch.needsApproveRepairs = true
        break
      case "rank_vendors": {
        const metric =
          parseRankMetric(call.arguments.metric) ?? "overall_quality"
        applyRankMetric(patch, metric)
        break
      }
      case "search_work_orders":
        patch.needsSearchWorkOrders = true
        break
      case "rank_properties":
        if (!locks.blockPropertyDashboard) {
          patch.needsRankProperties = true
        }
        break
      case "search_operations_graph":
        patch.needsOpsGraph = true
        break
      case "search_legal_sources":
        patch.needsLegalSources = true
        break
      case "get_market_intelligence":
        patch.needsMarketIntelligence = true
        break
      case "get_recurring_repairs":
        patch.needsRecurringRepairs = true
        break
      case "get_missing_updates":
        patch.needsMissingUpdates = true
        break
      case "get_vendor_verification":
        patch.needsVendorVerification = true
        break
      case "get_portfolio_briefing":
        patch.needsBriefing = true
        break
      case "summarize_period":
        patch.needsPeriodSummary = true
        break
      case "get_oldest_waiting_work_order":
        patch.needsOldestWaiting = true
        break
      case "investigate_entity":
        patch.needsEntityInvestigation = true
        break
      case "investigate_operations":
        patch.needsDeepOps = true
        break
      case "rank_units_by_maintenance":
        patch.needsUnitRanking = true
        break
      default:
        break
    }
  }
  return patch
}
