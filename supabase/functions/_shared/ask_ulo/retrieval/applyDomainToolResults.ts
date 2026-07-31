/**
 * Map executePlannedDomainTools results onto specialty evidence bag fields.
 */
import type { ExecuteDomainToolResult } from "../tools/_shared/executeDomainTool.ts"
import type { RankVendorsMetric } from "../tools/vendors/rankVendors.ts"
import type { SpecialtyEvidenceBag } from "./fetchSpecialtyEvidence.ts"

export type DomainToolEvidenceSeed = Partial<
  Pick<
    SpecialtyEvidenceBag,
    | "opsRaw"
    | "propertyInsights"
    | "repairsToApprove"
    | "propertyRanking"
    | "residentsList"
    | "draftCommunicationResult"
    | "activeWorkflowsResult"
    | "weatherAlertsResult"
    | "landlordIncentivesResult"
    | "vendorResponseSpeed"
    | "vendorBest"
    | "vendorCompletion"
    | "vendorInactive"
    | "vendorOverload"
    | "recurringRepairs"
    | "missingUpdates"
    | "vendorVerification"
    | "portfolioBriefing"
    | "periodSummary"
    | "oldestWaitingWorkOrder"
    | "entityInvestigation"
    | "deepOpsInvestigation"
    | "unitMaintenanceRanking"
    | "property"
  >
> & {
  toolsCalled: string[]
}

function applyRankVendorsLookup(
  seed: DomainToolEvidenceSeed,
  metric: RankVendorsMetric,
  lookup: unknown,
): void {
  if (!lookup || typeof lookup !== "object") return
  switch (metric) {
    case "response_time":
    case "response_rate":
    case "acceptance_rate":
      seed.vendorResponseSpeed = lookup as SpecialtyEvidenceBag["vendorResponseSpeed"]
      break
    case "completion_rate":
    case "completed_jobs":
      seed.vendorCompletion = lookup as SpecialtyEvidenceBag["vendorCompletion"]
      break
    case "inactive":
      seed.vendorInactive = lookup as SpecialtyEvidenceBag["vendorInactive"]
      break
    case "workload":
    case "active_jobs":
    case "decline_rate":
      seed.vendorOverload = lookup as SpecialtyEvidenceBag["vendorOverload"]
      break
    default:
      seed.vendorBest = lookup as SpecialtyEvidenceBag["vendorBest"]
      break
  }
}

export function applyDomainToolResults(
  executed: ExecuteDomainToolResult[],
): DomainToolEvidenceSeed {
  const seed: DomainToolEvidenceSeed = { toolsCalled: [] }

  for (const row of executed) {
    seed.toolsCalled.push(row.toolId)
    switch (row.toolId) {
      case "search_operations_graph":
        seed.opsRaw = row.result
        break
      case "get_property_insights":
        seed.propertyInsights = row.result
        break
      case "get_awaiting_decisions":
        seed.repairsToApprove = row.result
        break
      case "rank_properties":
        seed.propertyRanking = row.result
        break
      case "search_residents":
        seed.residentsList = row.result
        break
      case "draft_communication":
        seed.draftCommunicationResult = row.result
        break
      case "list_active_workflows":
        seed.activeWorkflowsResult = row.result
        break
      case "get_weather_alerts":
        seed.weatherAlertsResult = row.result
        break
      case "get_landlord_incentives":
        seed.landlordIncentivesResult = row.result
        break
      case "rank_vendors":
        applyRankVendorsLookup(seed, row.result.metric, row.result.lookup)
        break
      case "get_recurring_repairs":
        seed.recurringRepairs = row.result
        break
      case "get_missing_updates":
        seed.missingUpdates = row.result
        break
      case "get_vendor_verification":
        seed.vendorVerification = row.result
        break
      case "get_portfolio_briefing":
        seed.portfolioBriefing = row.result
        break
      case "summarize_period":
        seed.periodSummary = row.result
        break
      case "get_oldest_waiting_work_order":
        seed.oldestWaitingWorkOrder = row.result
        break
      case "investigate_entity":
        seed.entityInvestigation = row.result
        break
      case "investigate_operations":
        seed.deepOpsInvestigation = row.result
        break
      case "rank_units_by_maintenance":
        seed.unitMaintenanceRanking = row.result
        break
      case "get_property_snapshot":
        seed.property = row.result
        break
      default:
        break
    }
  }

  return seed
}
