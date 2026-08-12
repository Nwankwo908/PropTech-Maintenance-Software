/**
 * Turn retrieval playbook flags into domain tool calls at plan time.
 * Retrieve executes plannedTools only — needs* no longer dispatch lookups.
 */
import type { AskUloClassification } from "./classifyQuestion.ts"
import type { AskUloRetrievalNeeds } from "./deriveRetrievalNeeds.ts"
import type { AskUloToolPlan } from "./detectIntent.ts"
import type { DomainToolId } from "../tools/_shared/registry.ts"
import type { RankVendorsMetric } from "../tools/vendors/rankVendors.ts"
import type { PlannedDomainToolCall } from "./selectTools.ts"
import type { DomainToolNeedsPatch } from "./toolSelectNeeds.ts"

export function shouldPlanOpsGraph(input: {
  retrievalNeeds: AskUloRetrievalNeeds
  legacyToolPlan: AskUloToolPlan
  toolNeeds: DomainToolNeedsPatch
  playbookDeepOpsPrimary: boolean
}): boolean {
  const { retrievalNeeds, legacyToolPlan, toolNeeds, playbookDeepOpsPrimary } = input
  return (
    Boolean(toolNeeds.needsOpsGraph) ||
    (Boolean(legacyToolPlan.runOpsGraph) &&
      !retrievalNeeds.needsUnitRanking &&
      !retrievalNeeds.needsPeriodSummary &&
      !retrievalNeeds.needsOldestWaiting &&
      !retrievalNeeds.needsEntityInvestigation &&
      !retrievalNeeds.needsListResidents &&
      !retrievalNeeds.needsDraftCommunication &&
      !retrievalNeeds.needsActiveWorkflows &&
      !retrievalNeeds.needsWeatherAlerts &&
      !retrievalNeeds.needsLandlordIncentives &&
      !(retrievalNeeds.needsDeepOps && playbookDeepOpsPrimary))
  )
}

export function buildRetrievalToolPlan(input: {
  retrievalNeeds: AskUloRetrievalNeeds
  classification: AskUloClassification
  legacyToolPlan: AskUloToolPlan
  toolNeeds: DomainToolNeedsPatch
}): PlannedDomainToolCall[] {
  const { retrievalNeeds, classification, legacyToolPlan, toolNeeds } = input
  const { question, capability } = classification
  const buildingFilter = classification.propertyLabel
  const capabilityHints = capability.hints

  const out: PlannedDomainToolCall[] = []
  const plannedSet = new Set<string>()

  const add = (name: DomainToolId, args: Record<string, unknown> = {}) => {
    if (plannedSet.has(name)) return
    plannedSet.add(name)
    out.push({ name, arguments: args })
  }

  if (shouldPlanOpsGraph({
    retrievalNeeds,
    legacyToolPlan,
    toolNeeds,
    playbookDeepOpsPrimary: classification.playbook.deepOpsPrimary,
  })) {
    add("search_operations_graph")
  }

  if (retrievalNeeds.needsRecurringRepairs) add("get_recurring_repairs")
  if (retrievalNeeds.needsMissingUpdates) add("get_missing_updates")
  if (retrievalNeeds.needsVendorVerification) add("get_vendor_verification")
  if (retrievalNeeds.needsBriefing) add("get_portfolio_briefing")
  if (retrievalNeeds.needsPropertyInsights) add("get_property_insights")
  if (retrievalNeeds.needsApproveRepairs) {
    add("get_awaiting_decisions", {
      maintenanceOnly: true,
      priorities: capabilityHints.priorities,
    })
  }
  if (retrievalNeeds.needsRanking) add("rank_properties")
  if (retrievalNeeds.needsPeriodSummary) {
    add("summarize_period", { question, buildingFilter })
  }
  if (retrievalNeeds.needsOldestWaiting) {
    add("get_oldest_waiting_work_order", { buildingFilter })
  }
  if (retrievalNeeds.needsEntityInvestigation) {
    add("investigate_entity", { question, buildingFilter })
  }
  if (retrievalNeeds.needsDeepOps) {
    add("investigate_operations", { question, buildingFilter })
  }
  if (retrievalNeeds.needsUnitRanking) {
    add("rank_units_by_maintenance", { buildingFilter })
  }
  if (retrievalNeeds.needsListResidents) {
    add("search_residents", {
      filter: capabilityHints.residentFilter ?? "late_rent",
    })
  }
  if (retrievalNeeds.needsDraftCommunication) add("draft_communication")
  if (retrievalNeeds.needsActiveWorkflows) add("list_active_workflows", { limit: 40 })
  if (retrievalNeeds.needsWeatherAlerts) add("get_weather_alerts")
  if (retrievalNeeds.needsLandlordIncentives) add("get_landlord_incentives")

  const propertySnapshotEligible =
    legacyToolPlan.runPropertySnapshot &&
    !retrievalNeeds.needsListResidents &&
    !retrievalNeeds.needsDraftCommunication &&
    !retrievalNeeds.needsActiveWorkflows &&
    !retrievalNeeds.needsWeatherAlerts &&
    !retrievalNeeds.needsLandlordIncentives
  if (propertySnapshotEligible) {
    add("get_property_snapshot", { question })
  }

  const rankVendor = (metric: RankVendorsMetric) => {
    add("rank_vendors", { metric, question, buildingFilter })
  }
  if (retrievalNeeds.needsVendorResponseSpeed) {
    rankVendor("response_time")
  } else if (retrievalNeeds.needsVendorCompletion) {
    rankVendor("completion_rate")
  } else if (retrievalNeeds.needsVendorInactive) {
    rankVendor("inactive")
  } else if (retrievalNeeds.needsVendorOverload) {
    rankVendor("workload")
  } else if (retrievalNeeds.needsVendorBest) {
    rankVendor(capabilityHints.vendorMetric ?? "overall_quality")
  }

  return out
}
