/**
 * Parallel specialty lookups for the retrieve stage.
 *
 * Planned live domain tools run through executePlannedDomainTools first.
 * Legacy playbook-only lookups still run when needed and not covered by the plan.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import {
  draftCommunication,
  type DraftCommunicationResult,
} from "../tools/maintenance/draftCommunication.ts"
import {
  listActiveWorkflows,
  type ListActiveWorkflowsResult,
} from "../tools/maintenance/listActiveWorkflows.ts"
import {
  getWeatherAlerts,
  type GetWeatherAlertsResult,
} from "../tools/localMarket/getWeatherAlerts.ts"
import {
  getLandlordIncentives,
  type GetLandlordIncentivesResult,
} from "../tools/finance/getLandlordIncentives.ts"
import { portfolioBriefingLookup } from "../tools/properties/portfolioBriefingLookup.ts"
import { rankProperties } from "../tools/properties/rankProperties.ts"
import { periodSummaryLookup } from "../tools/properties/periodSummaryLookup.ts"
import { unitMaintenanceRankingLookup } from "../tools/maintenance/unitMaintenanceRankingLookup.ts"
import { oldestWaitingWorkOrderLookup } from "../tools/maintenance/oldestWaitingWorkOrderLookup.ts"
import { entityInvestigationLookup } from "../tools/maintenance/entityInvestigationLookup.ts"
import { deepOperationalInvestigationLookup } from "../tools/maintenance/deepOperationalInvestigationLookup.ts"
import { recurringRepairsLookup } from "../tools/maintenance/recurringRepairsLookup.ts"
import { missingUpdatesLookup } from "../tools/maintenance/missingUpdatesLookup.ts"
import { vendorResponseSpeedLookup } from "../tools/vendors/vendorResponseSpeedLookup.ts"
import { vendorBestLookup } from "../tools/vendors/vendorBestLookup.ts"
import { vendorCompletionLookup } from "../tools/vendors/vendorCompletionLookup.ts"
import { vendorInactiveLookup } from "../tools/vendors/vendorInactiveLookup.ts"
import { vendorVerificationStatusLookup } from "../tools/vendors/vendorVerificationStatusLookup.ts"
import { vendorOverloadLookup } from "../tools/vendors/vendorOverloadLookup.ts"
import {
  getAwaitingDecisions,
  getPropertyInsights,
  listResidents,
} from "../tools/_shared/mod.ts"
import type { PlannedDomainToolCall } from "../routing/selectTools.ts"
import { searchLegalSources } from "../tools/legal/searchLegalSources.ts"
import { searchOperationsGraph } from "../tools/maintenance/searchOperationsGraph.ts"
import { propertySnapshotLookup } from "../tools/properties/propertySnapshot.ts"
import type { AskUloCapabilityResult } from "../routing/capability.ts"
import type { AnalyticalQuery } from "../routing/analyticalQuery.ts"
import type { DomainToolId } from "../tools/_shared/registry.ts"
import { executePlannedDomainTools } from "../tools/_shared/executeDomainTool.ts"
import { applyDomainToolResults } from "./applyDomainToolResults.ts"
import { buildImplicitDomainToolPlan } from "./buildImplicitDomainToolPlan.ts"

export type SpecialtyFetchNeeds = {
  needsOpsGraph: boolean
  runLegalTools: boolean
  runStructured: boolean
  intentIsLegal: boolean
  needsDraftCommunication: boolean
  needsActiveWorkflows: boolean
  needsWeatherAlerts: boolean
  needsLandlordIncentives: boolean
  runPropertySnapshot: boolean
  needsListResidents: boolean
  needsBriefing: boolean
  needsPropertyInsights: boolean
  needsRecurringRepairs: boolean
  needsApproveRepairs: boolean
  needsMissingUpdates: boolean
  needsVendorResponseSpeed: boolean
  needsVendorBest: boolean
  needsVendorCompletion: boolean
  needsVendorInactive: boolean
  needsVendorOverload: boolean
  needsVendorVerification: boolean
  needsRanking: boolean
  needsUnitRanking: boolean
  needsPeriodSummary: boolean
  needsOldestWaiting: boolean
  needsEntityInvestigation: boolean
  needsDeepOps: boolean
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
  opsRaw: Awaited<ReturnType<typeof searchOperationsGraph>> | null
  structuredNonLegal: Awaited<
    ReturnType<typeof searchLegalSources>
  >["structured"]
  property: Awaited<ReturnType<typeof propertySnapshotLookup>> | null
  portfolioBriefing: Awaited<ReturnType<typeof portfolioBriefingLookup>> | null
  propertyInsights: Awaited<ReturnType<typeof getPropertyInsights>> | null
  recurringRepairs: Awaited<ReturnType<typeof recurringRepairsLookup>> | null
  repairsToApprove: Awaited<ReturnType<typeof getAwaitingDecisions>> | null
  missingUpdates: Awaited<ReturnType<typeof missingUpdatesLookup>> | null
  vendorResponseSpeed: Awaited<
    ReturnType<typeof vendorResponseSpeedLookup>
  > | null
  vendorBest: Awaited<ReturnType<typeof vendorBestLookup>> | null
  vendorCompletion: Awaited<ReturnType<typeof vendorCompletionLookup>> | null
  vendorInactive: Awaited<ReturnType<typeof vendorInactiveLookup>> | null
  vendorOverload: Awaited<ReturnType<typeof vendorOverloadLookup>> | null
  vendorVerification: Awaited<
    ReturnType<typeof vendorVerificationStatusLookup>
  > | null
  propertyRanking: Awaited<ReturnType<typeof rankProperties>> | null
  unitMaintenanceRanking: Awaited<
    ReturnType<typeof unitMaintenanceRankingLookup>
  > | null
  periodSummary: Awaited<ReturnType<typeof periodSummaryLookup>> | null
  oldestWaitingWorkOrder: Awaited<
    ReturnType<typeof oldestWaitingWorkOrderLookup>
  > | null
  entityInvestigation: Awaited<
    ReturnType<typeof entityInvestigationLookup>
  > | null
  deepOpsInvestigation: Awaited<
    ReturnType<typeof deepOperationalInvestigationLookup>
  > | null
  residentsList: Awaited<ReturnType<typeof listResidents>> | null
  draftCommunicationResult: DraftCommunicationResult | null
  activeWorkflowsResult: ListActiveWorkflowsResult | null
  weatherAlertsResult: GetWeatherAlertsResult | null
  landlordIncentivesResult: GetLandlordIncentivesResult | null
  /** Live domain tools that were actually invoked (for toolsCalled audit). */
  toolsCalled: string[]
}

function enrichPlannedToolsForFetch(
  planned: PlannedDomainToolCall[],
  capabilityHints: AskUloCapabilityResult["hints"],
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
      return call
    })
}

function legacyFetch(
  planned: Set<string>,
  toolId: DomainToolId,
  need: boolean,
): boolean {
  return need && !planned.has(toolId)
}

/**
 * Run specialty retrieval — domain tools first, legacy lookups for the rest.
 */
export async function fetchSpecialtyEvidence(
  needs: SpecialtyFetchNeeds,
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

  const plannedSet = new Set(plannedTools.map((t) => t.name))
  const implicitPlanned = buildImplicitDomainToolPlan(needs, ctx, plannedSet)
  const allPlanned = [...plannedTools, ...implicitPlanned]
  const allPlannedSet = new Set(allPlanned.map((t) => t.name))
  const enrichedPlanned = enrichPlannedToolsForFetch(allPlanned, capabilityHints)
  const domainExecuted = enrichedPlanned.length
    ? await executePlannedDomainTools(supabase, enrichedPlanned, {
      organizationId: landlordId,
      question,
      buildingFilter,
      analytical,
    })
    : []
  const seed = applyDomainToolResults(domainExecuted)

  const [
    opsRaw,
    structuredNonLegal,
    property,
    portfolioBriefing,
    propertyInsights,
    recurringRepairs,
    repairsToApprove,
    missingUpdates,
    vendorResponseSpeed,
    vendorBest,
    vendorCompletion,
    vendorInactive,
    vendorOverload,
    vendorVerification,
    propertyRanking,
    unitMaintenanceRanking,
    periodSummary,
    oldestWaitingWorkOrder,
    entityInvestigation,
    deepOpsInvestigation,
    residentsList,
    draftCommunicationResult,
    activeWorkflowsResult,
    weatherAlertsResult,
    landlordIncentivesResult,
  ] = await Promise.all([
    legacyFetch(allPlannedSet, "search_operations_graph", needs.needsOpsGraph)
      ? searchOperationsGraph(supabase, {
        organizationId: landlordId,
        buildingFilter,
      })
      : Promise.resolve(seed.opsRaw ?? null),
    !needs.runLegalTools &&
      needs.runStructured &&
      !needs.intentIsLegal &&
      !needs.needsDraftCommunication &&
      !needs.needsActiveWorkflows &&
      !needs.needsWeatherAlerts &&
      !needs.needsLandlordIncentives
      ? searchLegalSources(supabase, {
        question: retrievalQuestion,
        stateCode: portfolioJurisdiction.stateCode,
        citySlug: portfolioJurisdiction.citySlug,
        includeRag: false,
        includeStructured: true,
      }).then((r) => r.structured)
      : Promise.resolve(null),
    legacyFetch(
      allPlannedSet,
      "get_property_snapshot",
      needs.runPropertySnapshot &&
        !needs.needsListResidents &&
        !needs.needsDraftCommunication &&
        !needs.needsActiveWorkflows &&
        !needs.needsWeatherAlerts &&
        !needs.needsLandlordIncentives,
    )
      ? propertySnapshotLookup(supabase, {
        landlordId,
        question: retrievalQuestion,
        jurisdiction: {
          stateCode: effectiveJurisdiction.stateCode,
          cityLabel: effectiveJurisdiction.cityLabel,
          citySlug: effectiveJurisdiction.citySlug,
        },
      })
      : Promise.resolve(seed.property ?? null),
    legacyFetch(allPlannedSet, "get_portfolio_briefing", needs.needsBriefing)
      ? portfolioBriefingLookup(supabase, { landlordId })
      : Promise.resolve(seed.portfolioBriefing ?? null),
    legacyFetch(allPlannedSet, "get_property_insights", needs.needsPropertyInsights)
      ? getPropertyInsights(supabase, { organizationId: landlordId })
      : Promise.resolve(seed.propertyInsights ?? null),
    legacyFetch(allPlannedSet, "get_recurring_repairs", needs.needsRecurringRepairs)
      ? recurringRepairsLookup(supabase, { landlordId })
      : Promise.resolve(seed.recurringRepairs ?? null),
    legacyFetch(allPlannedSet, "get_awaiting_decisions", needs.needsApproveRepairs)
      ? getAwaitingDecisions(supabase, {
        organizationId: landlordId,
        priorities: capabilityHints.priorities,
        maintenanceOnly: true,
      })
      : Promise.resolve(seed.repairsToApprove ?? null),
    legacyFetch(allPlannedSet, "get_missing_updates", needs.needsMissingUpdates)
      ? missingUpdatesLookup(supabase, { landlordId })
      : Promise.resolve(seed.missingUpdates ?? null),
    legacyFetch(allPlannedSet, "rank_vendors", needs.needsVendorResponseSpeed)
      ? vendorResponseSpeedLookup(supabase, { landlordId, question })
      : Promise.resolve(seed.vendorResponseSpeed ?? null),
    legacyFetch(allPlannedSet, "rank_vendors", needs.needsVendorBest)
      ? vendorBestLookup(supabase, { landlordId, question, buildingFilter })
      : Promise.resolve(seed.vendorBest ?? null),
    legacyFetch(allPlannedSet, "rank_vendors", needs.needsVendorCompletion)
      ? vendorCompletionLookup(supabase, { landlordId })
      : Promise.resolve(seed.vendorCompletion ?? null),
    legacyFetch(allPlannedSet, "rank_vendors", needs.needsVendorInactive)
      ? vendorInactiveLookup(supabase, { landlordId })
      : Promise.resolve(seed.vendorInactive ?? null),
    legacyFetch(allPlannedSet, "rank_vendors", needs.needsVendorOverload)
      ? vendorOverloadLookup(supabase, { landlordId })
      : Promise.resolve(seed.vendorOverload ?? null),
    legacyFetch(allPlannedSet, "get_vendor_verification", needs.needsVendorVerification)
      ? vendorVerificationStatusLookup(supabase, { landlordId })
      : Promise.resolve(seed.vendorVerification ?? null),
    legacyFetch(allPlannedSet, "rank_properties", needs.needsRanking)
      ? rankProperties(supabase, { organizationId: landlordId })
      : Promise.resolve(seed.propertyRanking ?? null),
    legacyFetch(allPlannedSet, "rank_units_by_maintenance", needs.needsUnitRanking)
      ? unitMaintenanceRankingLookup(supabase, {
        landlordId,
        buildingFilter,
        analytical,
      })
      : Promise.resolve(seed.unitMaintenanceRanking ?? null),
    legacyFetch(allPlannedSet, "summarize_period", needs.needsPeriodSummary)
      ? periodSummaryLookup(supabase, {
        landlordId,
        question,
        buildingFilter,
      })
      : Promise.resolve(seed.periodSummary ?? null),
    legacyFetch(allPlannedSet, "get_oldest_waiting_work_order", needs.needsOldestWaiting)
      ? oldestWaitingWorkOrderLookup(supabase, {
        landlordId,
        buildingFilter,
      })
      : Promise.resolve(seed.oldestWaitingWorkOrder ?? null),
    legacyFetch(allPlannedSet, "investigate_entity", needs.needsEntityInvestigation)
      ? entityInvestigationLookup(supabase, {
        landlordId,
        question,
        buildingFilter,
      })
      : Promise.resolve(seed.entityInvestigation ?? null),
    legacyFetch(allPlannedSet, "investigate_operations", needs.needsDeepOps)
      ? deepOperationalInvestigationLookup(supabase, {
        landlordId,
        question,
        buildingFilter,
      })
      : Promise.resolve(seed.deepOpsInvestigation ?? null),
    legacyFetch(allPlannedSet, "search_residents", needs.needsListResidents)
      ? listResidents(supabase, {
        organizationId: landlordId,
        filter: (() => {
          const fromPlan = plannedTools.find((t) => t.name === "search_residents")
            ?.arguments.filter
          if (
            typeof fromPlan === "string" &&
            [
              "late_rent",
              "outstanding_balance",
              "lease_ending",
              "high_maintenance_activity",
              "move_in",
              "move_out",
              "message_nonresponse",
            ].includes(fromPlan)
          ) {
            return fromPlan as
              | "late_rent"
              | "outstanding_balance"
              | "lease_ending"
              | "high_maintenance_activity"
              | "move_in"
              | "move_out"
              | "message_nonresponse"
          }
          return capabilityHints.residentFilter ?? "late_rent"
        })(),
        sortBy:
          capabilityHints.residentFilter === "move_in"
            ? "move_in_date"
            : capabilityHints.residentFilter === "message_nonresponse"
              ? "awaiting_reply_hours"
              : "balance_due",
        sortOrder: "desc",
        dateRangeDays: capabilityHints.residentFilter === "move_in" ? 31 : 30,
        limit: 25,
      })
      : Promise.resolve(seed.residentsList ?? null),
    legacyFetch(allPlannedSet, "draft_communication", needs.needsDraftCommunication)
      ? Promise.resolve(draftCommunication({ question }))
      : Promise.resolve(seed.draftCommunicationResult ?? null),
    legacyFetch(allPlannedSet, "list_active_workflows", needs.needsActiveWorkflows)
      ? listActiveWorkflows(supabase, {
        organizationId: landlordId,
        limit: 40,
      })
      : Promise.resolve(seed.activeWorkflowsResult ?? null),
    legacyFetch(allPlannedSet, "get_weather_alerts", needs.needsWeatherAlerts)
      ? getWeatherAlerts(supabase, { organizationId: landlordId })
      : Promise.resolve(seed.weatherAlertsResult ?? null),
    legacyFetch(
      allPlannedSet,
      "get_landlord_incentives",
      needs.needsLandlordIncentives,
    )
      ? getLandlordIncentives(supabase, { organizationId: landlordId })
      : Promise.resolve(seed.landlordIncentivesResult ?? null),
  ])

  const toolsCalled = [...seed.toolsCalled]

  const pushLegacyTool = (id: string, present: boolean) => {
    if (present && !toolsCalled.includes(id)) toolsCalled.push(id)
  }

  pushLegacyTool("get_property_insights", Boolean(propertyInsights))
  pushLegacyTool("get_property_snapshot", Boolean(property))
  pushLegacyTool("get_awaiting_decisions", Boolean(repairsToApprove))
  pushLegacyTool("search_residents", Boolean(residentsList))
  pushLegacyTool("draft_communication", Boolean(draftCommunicationResult))
  pushLegacyTool("list_active_workflows", Boolean(activeWorkflowsResult))
  pushLegacyTool("get_weather_alerts", Boolean(weatherAlertsResult))
  pushLegacyTool("get_landlord_incentives", Boolean(landlordIncentivesResult))
  pushLegacyTool("rank_properties", Boolean(propertyRanking))
  pushLegacyTool("search_operations_graph", Boolean(opsRaw))
  if (needs.runLegalTools || structuredNonLegal) {
    pushLegacyTool("search_legal_sources", true)
  }
  if (needs.needsMarketIntelligence) {
    pushLegacyTool("get_market_intelligence", true)
  }
  if (
    vendorResponseSpeed ||
    vendorBest ||
    vendorCompletion ||
    vendorInactive ||
    vendorOverload ||
    vendorVerification
  ) {
    pushLegacyTool("rank_vendors", true)
  }

  return {
    opsRaw,
    structuredNonLegal,
    property,
    portfolioBriefing,
    propertyInsights,
    recurringRepairs,
    repairsToApprove,
    missingUpdates,
    vendorResponseSpeed,
    vendorBest,
    vendorCompletion,
    vendorInactive,
    vendorOverload,
    vendorVerification,
    propertyRanking,
    unitMaintenanceRanking,
    periodSummary,
    oldestWaitingWorkOrder,
    entityInvestigation,
    deepOpsInvestigation,
    residentsList,
    draftCommunicationResult,
    activeWorkflowsResult,
    weatherAlertsResult,
    landlordIncentivesResult,
    toolsCalled,
  }
}
