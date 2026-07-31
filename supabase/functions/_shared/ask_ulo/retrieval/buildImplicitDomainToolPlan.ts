/**
 * When playbooks set needs* flags without a capability-route tool plan,
 * synthesize implicit domain tool calls so retrieval still goes through executeDomainTool.
 */
import type { DomainToolId } from "../tools/_shared/registry.ts"
import type { RankVendorsMetric } from "../tools/vendors/rankVendors.ts"
import type { PlannedDomainToolCall } from "../routing/selectTools.ts"
import type { SpecialtyFetchContext, SpecialtyFetchNeeds } from "./fetchSpecialtyEvidence.ts"

export function buildImplicitDomainToolPlan(
  needs: SpecialtyFetchNeeds,
  ctx: SpecialtyFetchContext,
  plannedSet: ReadonlySet<string>,
): PlannedDomainToolCall[] {
  const out: PlannedDomainToolCall[] = []
  const { question, buildingFilter, capabilityHints, effectiveJurisdiction } = ctx

  const add = (name: DomainToolId, args: Record<string, unknown> = {}) => {
    if (plannedSet.has(name)) return
    out.push({ name, arguments: args })
  }

  if (needs.needsRecurringRepairs) add("get_recurring_repairs")
  if (needs.needsMissingUpdates) add("get_missing_updates")
  if (needs.needsVendorVerification) add("get_vendor_verification")
  if (needs.needsBriefing) add("get_portfolio_briefing")
  if (needs.needsPropertyInsights) add("get_property_insights")
  if (needs.needsApproveRepairs) {
    add("get_awaiting_decisions", {
      maintenanceOnly: true,
      priorities: capabilityHints.priorities,
    })
  }
  if (needs.needsRanking) add("rank_properties")
  if (needs.needsPeriodSummary) {
    add("summarize_period", { question, buildingFilter })
  }
  if (needs.needsOldestWaiting) {
    add("get_oldest_waiting_work_order", { buildingFilter })
  }
  if (needs.needsEntityInvestigation) {
    add("investigate_entity", { question, buildingFilter })
  }
  if (needs.needsDeepOps) {
    add("investigate_operations", { question, buildingFilter })
  }
  if (needs.needsUnitRanking) {
    add("rank_units_by_maintenance", { buildingFilter })
  }
  if (needs.needsListResidents) {
    add("search_residents", {
      filter: capabilityHints.residentFilter ?? "late_rent",
    })
  }
  if (needs.needsDraftCommunication) add("draft_communication")
  if (needs.needsActiveWorkflows) add("list_active_workflows", { limit: 40 })
  if (needs.needsWeatherAlerts) add("get_weather_alerts")
  if (needs.needsLandlordIncentives) add("get_landlord_incentives")

  const propertySnapshotEligible =
    needs.runPropertySnapshot &&
    !needs.needsListResidents &&
    !needs.needsDraftCommunication &&
    !needs.needsActiveWorkflows &&
    !needs.needsWeatherAlerts &&
    !needs.needsLandlordIncentives
  if (propertySnapshotEligible) {
    add("get_property_snapshot", {
      question,
      stateCode: effectiveJurisdiction.stateCode,
      cityLabel: effectiveJurisdiction.cityLabel,
      citySlug: effectiveJurisdiction.citySlug,
    })
  }

  const rankVendor = (metric: RankVendorsMetric) => {
    add("rank_vendors", { metric, question, buildingFilter })
  }
  if (needs.needsVendorResponseSpeed) {
    rankVendor("response_time")
  } else if (needs.needsVendorCompletion) {
    rankVendor("completion_rate")
  } else if (needs.needsVendorInactive) {
    rankVendor("inactive")
  } else if (needs.needsVendorOverload) {
    rankVendor("workload")
  } else if (needs.needsVendorBest) {
    rankVendor(capabilityHints.vendorMetric ?? "overall_quality")
  }

  return out
}
