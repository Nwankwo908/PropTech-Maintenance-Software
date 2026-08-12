/**
 * Specialty retrieval — executes plannedTools through executePlannedDomainTools only.
 *
 * Tool selection happens in planAskUloTurn (capability route + buildRetrievalToolPlan).
 * Legal RAG / structured compliance still run here when the legacy intent plan requires them.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import type { DraftCommunicationResult } from "../tools/maintenance/draftCommunication.ts"
import type { ListActiveWorkflowsResult } from "../tools/maintenance/listActiveWorkflows.ts"
import type { GetWeatherAlertsResult } from "../tools/localMarket/getWeatherAlerts.ts"
import type { GetLandlordIncentivesResult } from "../tools/finance/getLandlordIncentives.ts"
import type { PortfolioBriefingResult } from "../tools/properties/portfolioBriefingLookup.ts"
import type { RankPropertiesResult } from "../tools/properties/rankProperties.ts"
import type { PeriodSummaryResult } from "../tools/properties/periodSummaryLookup.ts"
import type { UnitMaintenanceRankingResult } from "../tools/maintenance/unitMaintenanceRankingLookup.ts"
import type { OldestWaitingWorkOrderResult } from "../tools/maintenance/oldestWaitingWorkOrderLookup.ts"
import type { EntityInvestigationLookupResult } from "../tools/maintenance/entityInvestigationLookup.ts"
import type { DeepOpsLookupResult } from "../tools/maintenance/deepOperationalInvestigationLookup.ts"
import type { RecurringRepairsResult } from "../tools/maintenance/recurringRepairsLookup.ts"
import type { MissingUpdatesResult } from "../tools/maintenance/missingUpdatesLookup.ts"
import type { VendorResponseSpeedResult } from "../tools/vendors/vendorResponseSpeedLookup.ts"
import type { VendorBestResult } from "../tools/vendors/vendorBestLookup.ts"
import type { VendorCompletionResult } from "../tools/vendors/vendorCompletionLookup.ts"
import type { VendorInactiveResult } from "../tools/vendors/vendorInactiveLookup.ts"
import type { VendorVerificationStatusResult } from "../tools/vendors/vendorVerificationStatusLookup.ts"
import type { VendorOverloadResult } from "../tools/vendors/vendorOverloadLookup.ts"
import type { GetPropertyInsightsResult } from "../tools/properties/getPropertyInsights.ts"
import type { GetAwaitingDecisionsResult } from "../tools/maintenance/getAwaitingDecisions.ts"
import type { ListResidentsResult } from "../tools/residents/listResidents.ts"
import type { PlannedDomainToolCall } from "../routing/selectTools.ts"
import { searchLegalSources } from "../tools/legal/searchLegalSources.ts"
import type { SearchOperationsGraphResult } from "../tools/maintenance/searchOperationsGraph.ts"
import type { PropertySnapshotResult } from "../tools/properties/propertySnapshot.ts"
import type { AskUloCapabilityResult } from "../routing/capability.ts"
import type { AnalyticalQuery } from "../routing/analyticalQuery.ts"
import type { DomainToolId } from "../tools/_shared/registry.ts"
import { executePlannedDomainTools } from "../tools/_shared/executeDomainTool.ts"
import { applyDomainToolResults } from "./applyDomainToolResults.ts"

export type SpecialtyFetchConfig = {
  runStructured: boolean
  intentIsLegal: boolean
  runLegalTools: boolean
  needsMarketIntelligence: boolean
}

export type SpecialtyFetchContext = {
  supabase: SupabaseClient
  landlordId: string
  question: string
  retrievalQuestion: string
  buildingFilter: string | null
  plannedTools: PlannedDomainToolCall[]
  capabilityHints: AskUloCapabilityResult["hints"]
  analytical: AnalyticalQuery
  portfolioJurisdiction: {
    stateCode: string | null
    citySlug: string | null
  }
  effectiveJurisdiction: {
    stateCode: string | null
    cityLabel: string | null
    citySlug: string | null
  }
}

export type SpecialtyEvidenceBag = {
  opsRaw: SearchOperationsGraphResult | null
  structuredNonLegal: Awaited<
    ReturnType<typeof searchLegalSources>
  >["structured"]
  property: PropertySnapshotResult | null
  portfolioBriefing: PortfolioBriefingResult | null
  propertyInsights: GetPropertyInsightsResult | null
  recurringRepairs: RecurringRepairsResult | null
  repairsToApprove: GetAwaitingDecisionsResult | null
  missingUpdates: MissingUpdatesResult | null
  vendorResponseSpeed: VendorResponseSpeedResult | null
  vendorBest: VendorBestResult | null
  vendorCompletion: VendorCompletionResult | null
  vendorInactive: VendorInactiveResult | null
  vendorOverload: VendorOverloadResult | null
  vendorVerification: VendorVerificationStatusResult | null
  propertyRanking: RankPropertiesResult | null
  unitMaintenanceRanking: UnitMaintenanceRankingResult | null
  periodSummary: PeriodSummaryResult | null
  oldestWaitingWorkOrder: OldestWaitingWorkOrderResult | null
  entityInvestigation: EntityInvestigationLookupResult | null
  deepOpsInvestigation: DeepOpsLookupResult | null
  residentsList: ListResidentsResult | null
  draftCommunicationResult: DraftCommunicationResult | null
  activeWorkflowsResult: ListActiveWorkflowsResult | null
  weatherAlertsResult: GetWeatherAlertsResult | null
  landlordIncentivesResult: GetLandlordIncentivesResult | null
  toolsCalled: string[]
}

function enrichPlannedToolsForFetch(
  planned: PlannedDomainToolCall[],
  capabilityHints: AskUloCapabilityResult["hints"],
  effectiveJurisdiction: SpecialtyFetchContext["effectiveJurisdiction"],
): PlannedDomainToolCall[] {
  return planned
    .filter((t) => t.name !== "search_work_orders")
    .map((call) => {
      if (call.name === "search_residents") {
        const filter =
          (typeof call.arguments.filter === "string"
            ? call.arguments.filter
            : null) ??
            capabilityHints.residentFilter ??
            "late_rent"
        return {
          ...call,
          arguments: {
            ...call.arguments,
            filter,
            sortBy:
              call.arguments.sortBy ??
              (filter === "move_in"
                ? "move_in_date"
                : filter === "message_nonresponse"
                  ? "awaiting_reply_hours"
                  : "balance_due"),
            sortOrder: call.arguments.sortOrder ?? "desc",
            dateRangeDays: call.arguments.dateRangeDays ??
              (filter === "move_in" ? 31 : 30),
            limit: call.arguments.limit ?? 25,
          },
        }
      }
      if (call.name === "get_awaiting_decisions") {
        return {
          ...call,
          arguments: {
            ...call.arguments,
            maintenanceOnly: call.arguments.maintenanceOnly ?? true,
            priorities: call.arguments.priorities ?? capabilityHints.priorities,
          },
        }
      }
      if (call.name === "list_active_workflows") {
        return {
          ...call,
          arguments: {
            ...call.arguments,
            limit: call.arguments.limit ?? 40,
          },
        }
      }
      if (call.name === "get_property_snapshot") {
        return {
          ...call,
          arguments: {
            ...call.arguments,
            stateCode: call.arguments.stateCode ?? effectiveJurisdiction.stateCode,
            cityLabel: call.arguments.cityLabel ?? effectiveJurisdiction.cityLabel,
            citySlug: call.arguments.citySlug ?? effectiveJurisdiction.citySlug,
          },
        }
      }
      return call
    })
}

function structuredFetchSuppressed(planned: ReadonlySet<string>): boolean {
  return (
    planned.has("draft_communication") ||
    planned.has("list_active_workflows") ||
    planned.has("get_weather_alerts") ||
    planned.has("get_landlord_incentives")
  )
}

function auditToolsCalled(
  seed: ReturnType<typeof applyDomainToolResults>,
  config: SpecialtyFetchConfig,
  structuredNonLegal: SpecialtyEvidenceBag["structuredNonLegal"],
): string[] {
  const toolsCalled = [...seed.toolsCalled]
  const push = (id: DomainToolId | string, present: boolean) => {
    if (present && !toolsCalled.includes(id)) toolsCalled.push(id)
  }

  push("search_operations_graph", Boolean(seed.opsRaw))
  push("get_property_snapshot", Boolean(seed.property))
  push("get_portfolio_briefing", Boolean(seed.portfolioBriefing))
  push("get_property_insights", Boolean(seed.propertyInsights))
  push("get_recurring_repairs", Boolean(seed.recurringRepairs))
  push("get_awaiting_decisions", Boolean(seed.repairsToApprove))
  push("get_missing_updates", Boolean(seed.missingUpdates))
  push("get_vendor_verification", Boolean(seed.vendorVerification))
  push("rank_properties", Boolean(seed.propertyRanking))
  push("rank_units_by_maintenance", Boolean(seed.unitMaintenanceRanking))
  push("summarize_period", Boolean(seed.periodSummary))
  push("get_oldest_waiting_work_order", Boolean(seed.oldestWaitingWorkOrder))
  push("investigate_entity", Boolean(seed.entityInvestigation))
  push("investigate_operations", Boolean(seed.deepOpsInvestigation))
  push("search_residents", Boolean(seed.residentsList))
  push("draft_communication", Boolean(seed.draftCommunicationResult))
  push("list_active_workflows", Boolean(seed.activeWorkflowsResult))
  push("get_weather_alerts", Boolean(seed.weatherAlertsResult))
  push("get_landlord_incentives", Boolean(seed.landlordIncentivesResult))
  if (
    seed.vendorResponseSpeed ||
    seed.vendorBest ||
    seed.vendorCompletion ||
    seed.vendorInactive ||
    seed.vendorOverload
  ) {
    push("rank_vendors", true)
  }
  if (config.runLegalTools || structuredNonLegal) {
    push("search_legal_sources", true)
  }
  if (config.needsMarketIntelligence) {
    push("get_market_intelligence", true)
  }

  return toolsCalled
}

/**
 * Execute the turn's planned domain tools and map results into the evidence bag.
 */
export async function fetchSpecialtyEvidence(
  config: SpecialtyFetchConfig,
  ctx: SpecialtyFetchContext,
): Promise<SpecialtyEvidenceBag> {
  const {
    supabase,
    landlordId,
    question,
    retrievalQuestion,
    buildingFilter,
    plannedTools,
    capabilityHints,
    analytical,
    portfolioJurisdiction,
    effectiveJurisdiction,
  } = ctx

  const enrichedPlanned = enrichPlannedToolsForFetch(
    plannedTools,
    capabilityHints,
    effectiveJurisdiction,
  )
  const domainExecuted = enrichedPlanned.length
    ? await executePlannedDomainTools(supabase, enrichedPlanned, {
      organizationId: landlordId,
      question,
      buildingFilter,
      analytical,
    })
    : []
  const seed = applyDomainToolResults(domainExecuted)

  const plannedSet = new Set(plannedTools.map((t) => t.name))
  const structuredNonLegal =
    !config.runLegalTools &&
      config.runStructured &&
      !config.intentIsLegal &&
      !structuredFetchSuppressed(plannedSet)
      ? (await searchLegalSources(supabase, {
        question: retrievalQuestion,
        stateCode: portfolioJurisdiction.stateCode,
        citySlug: portfolioJurisdiction.citySlug,
        includeRag: false,
        includeStructured: true,
      })).structured
      : null

  const toolsCalled = auditToolsCalled(seed, config, structuredNonLegal)

  return {
    opsRaw: seed.opsRaw ?? null,
    structuredNonLegal,
    property: seed.property ?? null,
    portfolioBriefing: seed.portfolioBriefing ?? null,
    propertyInsights: seed.propertyInsights ?? null,
    recurringRepairs: seed.recurringRepairs ?? null,
    repairsToApprove: seed.repairsToApprove ?? null,
    missingUpdates: seed.missingUpdates ?? null,
    vendorResponseSpeed: seed.vendorResponseSpeed ?? null,
    vendorBest: seed.vendorBest ?? null,
    vendorCompletion: seed.vendorCompletion ?? null,
    vendorInactive: seed.vendorInactive ?? null,
    vendorOverload: seed.vendorOverload ?? null,
    vendorVerification: seed.vendorVerification ?? null,
    propertyRanking: seed.propertyRanking ?? null,
    unitMaintenanceRanking: seed.unitMaintenanceRanking ?? null,
    periodSummary: seed.periodSummary ?? null,
    oldestWaitingWorkOrder: seed.oldestWaitingWorkOrder ?? null,
    entityInvestigation: seed.entityInvestigation ?? null,
    deepOpsInvestigation: seed.deepOpsInvestigation ?? null,
    residentsList: seed.residentsList ?? null,
    draftCommunicationResult: seed.draftCommunicationResult ?? null,
    activeWorkflowsResult: seed.activeWorkflowsResult ?? null,
    weatherAlertsResult: seed.weatherAlertsResult ?? null,
    landlordIncentivesResult: seed.landlordIncentivesResult ?? null,
    toolsCalled,
  }
}
