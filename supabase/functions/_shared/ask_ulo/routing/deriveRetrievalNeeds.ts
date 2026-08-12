/**
 * Retrieval playbook flags — used at plan time (`buildRetrievalToolPlan`) and for
 * permission / audit metadata after retrieve. Does **not** dispatch lookups;
 * `plannedTools` + `executePlannedDomainTools` do.
 */

import type { AskUloClassification } from "./classifyQuestion.ts"
import type { DomainToolNeedsPatch } from "./toolSelectNeeds.ts"
import type { AskUloToolPlan } from "./detectIntent.ts"
import { isPeriodSummaryQuestion } from "./dynamicResponse.ts"
import { isOldestWaitingWorkOrderQuestion } from "../tools/maintenance/taskCompletion.ts"
import { isEntityInvestigationQuestion } from "../tools/maintenance/entityInvestigation.ts"
import { requiresDeepOperationalInvestigation } from "../tools/maintenance/deepOperationalInvestigation.ts"
import {
  isLandlordIncentivesQuestion,
  isUloActiveTasksQuestion,
  isWeatherAlertsQuestion,
} from "./detectSubject.ts"
import { shouldFetchPortfolioBriefing } from "./reasoningMode.ts"
import type { AskUloCapabilityResult } from "./capability.ts"
import type { RankVendorsMetric } from "../tools/vendors/rankVendors.ts"
import { routeRequiresTool } from "./capabilityRoute.ts"

function vendorHintIs(
  hints: AskUloCapabilityResult["hints"],
  ...metrics: RankVendorsMetric[]
): boolean {
  const metric = hints.vendorMetric
  return metric != null && metrics.includes(metric)
}

export type AskUloRetrievalNeeds = {
  needsPeriodSummary: boolean
  needsOldestWaiting: boolean
  needsEntityInvestigation: boolean
  deepOpsCandidate: boolean
  needsDeepOps: boolean
  needsDraftCommunication: boolean
  needsActiveWorkflows: boolean
  needsWeatherAlerts: boolean
  needsLandlordIncentives: boolean
  needsListResidents: boolean
  needsPropertyInsights: boolean
  needsRecurringRepairs: boolean
  needsApproveRepairs: boolean
  needsMissingUpdates: boolean
  needsVendorResponseSpeed: boolean
  needsVendorCompletion: boolean
  needsVendorInactive: boolean
  needsVendorOverload: boolean
  needsVendorVerification: boolean
  needsVendorBest: boolean
  needsUnitRanking: boolean
  needsBriefing: boolean
  needsRanking: boolean
}

export function deriveRetrievalNeeds(input: {
  question: string
  classification: AskUloClassification
  toolNeeds: DomainToolNeedsPatch
  legacyToolPlan: AskUloToolPlan
}): AskUloRetrievalNeeds {
  const { question, classification, toolNeeds, legacyToolPlan } = input
  const intentResult = classification.intentResult
  const playbook = classification.playbook
  const capabilityResult = classification.capability
  const capabilityRoute = classification.capabilityRoute
  const evidencePlan = classification.evidencePlan
  const reasoningEarly = classification.reasoningMode
  const analytical = classification.analytical
  const vendorSubjectLock = classification.toolSelectLocks.vendorLock
  const propertyDashboardLock =
    classification.toolSelectLocks.blockPropertyDashboard

  const needsPeriodSummary =
    toolNeeds.needsPeriodSummary ||
    intentResult.intent === "period_summary" ||
    isPeriodSummaryQuestion(question)
  const needsOldestWaiting =
    !needsPeriodSummary &&
    (toolNeeds.needsOldestWaiting ||
      capabilityResult.hints.metric === "wait_age" ||
      routeRequiresTool(capabilityRoute, "get_oldest_waiting_work_order") ||
      intentResult.intent === "oldest_waiting_work_order" ||
      isOldestWaitingWorkOrderQuestion(question))
  const needsEntityInvestigation =
    !needsPeriodSummary &&
    !needsOldestWaiting &&
    (toolNeeds.needsEntityInvestigation ||
      routeRequiresTool(capabilityRoute, "investigate_entity") ||
      intentResult.intent === "entity_investigation" ||
      isEntityInvestigationQuestion(question))
  const deepOpsCandidate =
    !needsPeriodSummary &&
    !needsOldestWaiting &&
    (requiresDeepOperationalInvestigation(question) ||
      routeRequiresTool(capabilityRoute, "investigate_operations"))
  const needsDeepOps =
    toolNeeds.needsDeepOps ||
    (deepOpsCandidate &&
      (playbook.deepOpsPrimary ||
        capabilityResult.capability === "investigate_root_cause" ||
        playbook.id === "why_not_resolved" ||
        playbook.id === "generic_ops" ||
        playbook.id === "maintenance_risk" ||
        playbook.id === "emergency_escalation"))
  const needsDraftCommunication =
    capabilityResult.capability === "draft" ||
    capabilityRoute.requiredTools.includes("draft_communication") ||
    toolNeeds.needsDraftCommunication
  const needsActiveWorkflows =
    !needsDraftCommunication &&
    (isUloActiveTasksQuestion(question) ||
      capabilityRoute.requiredTools.includes("list_active_workflows") ||
      toolNeeds.needsActiveWorkflows ||
      (evidencePlan.subject === "workflow" &&
        (capabilityResult.capability === "explain_status" ||
          capabilityResult.capability === "search")))
  const needsWeatherAlerts =
    !needsDraftCommunication &&
    !needsActiveWorkflows &&
    (isWeatherAlertsQuestion(question) ||
      capabilityRoute.requiredTools.includes("get_weather_alerts") ||
      toolNeeds.needsWeatherAlerts ||
      evidencePlan.subject === "weather")
  const needsLandlordIncentives =
    !needsDraftCommunication &&
    !needsActiveWorkflows &&
    !needsWeatherAlerts &&
    (isLandlordIncentivesQuestion(question) ||
      capabilityRoute.requiredTools.includes("get_landlord_incentives") ||
      toolNeeds.needsLandlordIncentives ||
      evidencePlan.subject === "incentives")
  const needsListResidents =
    !needsPeriodSummary &&
    !needsDraftCommunication &&
    !needsActiveWorkflows &&
    !needsWeatherAlerts &&
    !needsLandlordIncentives &&
    (Boolean(capabilityResult.hints.residentFilter) ||
      toolNeeds.needsListResidents ||
      ((evidencePlan.subject === "resident" ||
        evidencePlan.subject === "finance") &&
        capabilityRoute.requiredTools.includes("search_residents")))
  const needsPropertyInsights =
    evidencePlan.allowPropertyInsights &&
    !vendorSubjectLock &&
    !needsListResidents &&
    !needsDraftCommunication &&
    !needsActiveWorkflows &&
    !needsWeatherAlerts &&
    !needsLandlordIncentives &&
    !needsPeriodSummary &&
    !needsOldestWaiting &&
    !needsEntityInvestigation &&
    (toolNeeds.needsPropertyInsights ||
      routeRequiresTool(capabilityRoute, "get_property_insights") ||
      ((playbook.consultTier1First ||
        capabilityResult.capability === "identify_risk" ||
        capabilityResult.capability === "identify_recurring_pattern") &&
        playbook.id !== "approve_repairs" &&
        capabilityResult.capability !== "identify_pending_decision" &&
        playbook.id !== "missing_updates" &&
        playbook.id !== "vendor_speed" &&
        playbook.id !== "vendor_best" &&
        playbook.id !== "vendor_completion" &&
        playbook.id !== "vendor_inactive" &&
        playbook.id !== "vendor_overload"))
  const needsRecurringRepairs =
    !needsPeriodSummary &&
    !needsOldestWaiting &&
    !needsEntityInvestigation &&
    !needsListResidents &&
    !needsDraftCommunication &&
    (toolNeeds.needsRecurringRepairs ||
      routeRequiresTool(capabilityRoute, "get_recurring_repairs") ||
      capabilityResult.capability === "identify_recurring_pattern")
  const needsApproveRepairs =
    !needsPeriodSummary &&
    !needsOldestWaiting &&
    !needsEntityInvestigation &&
    !needsListResidents &&
    !needsDraftCommunication &&
    (toolNeeds.needsApproveRepairs ||
      routeRequiresTool(capabilityRoute, "get_awaiting_decisions") ||
      capabilityResult.capability === "identify_pending_decision")
  const needsMissingUpdates =
    !needsPeriodSummary &&
    !needsOldestWaiting &&
    !needsEntityInvestigation &&
    !needsListResidents &&
    !needsDraftCommunication &&
    (toolNeeds.needsMissingUpdates ||
      capabilityResult.hints.metric === "missing_updates" ||
      routeRequiresTool(capabilityRoute, "get_missing_updates"))
  const needsVendorResponseSpeed =
    !needsPeriodSummary &&
    !needsOldestWaiting &&
    !needsEntityInvestigation &&
    !needsListResidents &&
    !needsDraftCommunication &&
    (toolNeeds.needsVendorResponseSpeed ||
      vendorHintIs(capabilityResult.hints, "response_time") ||
      routeRequiresTool(capabilityRoute, "rank_vendors"))
  const needsVendorCompletion =
    !needsPeriodSummary &&
    !needsOldestWaiting &&
    !needsEntityInvestigation &&
    !needsListResidents &&
    !needsDraftCommunication &&
    (toolNeeds.needsVendorCompletion ||
      vendorHintIs(capabilityResult.hints, "completion_rate"))
  const needsVendorInactive =
    !needsPeriodSummary &&
    !needsOldestWaiting &&
    !needsEntityInvestigation &&
    !needsListResidents &&
    !needsDraftCommunication &&
    (toolNeeds.needsVendorInactive ||
      vendorHintIs(capabilityResult.hints, "inactive"))
  const needsVendorOverload =
    !needsPeriodSummary &&
    !needsOldestWaiting &&
    !needsEntityInvestigation &&
    !needsListResidents &&
    !needsDraftCommunication &&
    (toolNeeds.needsVendorOverload ||
      vendorHintIs(capabilityResult.hints, "workload"))
  const needsVendorVerification =
    !needsPeriodSummary &&
    !needsOldestWaiting &&
    !needsEntityInvestigation &&
    !needsListResidents &&
    !needsDraftCommunication &&
    (toolNeeds.needsVendorVerification ||
      capabilityResult.hints.metric === "vendor_verification" ||
      routeRequiresTool(capabilityRoute, "get_vendor_verification"))
  const needsVendorBest =
    !needsPeriodSummary &&
    !needsOldestWaiting &&
    !needsEntityInvestigation &&
    !needsListResidents &&
    !needsDraftCommunication &&
    (toolNeeds.needsVendorBest ||
      vendorHintIs(capabilityResult.hints, "overall_quality") ||
      capabilityResult.capability === "recommend")
  const needsUnitRanking =
    !needsPeriodSummary &&
    !needsOldestWaiting &&
    !needsEntityInvestigation &&
    !needsListResidents &&
    !needsDraftCommunication &&
    (toolNeeds.needsUnitRanking ||
      routeRequiresTool(capabilityRoute, "rank_units_by_maintenance") ||
      intentResult.intent === "unit_maintenance_ranking" ||
      analytical.isUnitMaintenanceVolumeRanking)
  const needsBriefing =
    !propertyDashboardLock &&
    !needsListResidents &&
    !needsDraftCommunication &&
    !needsActiveWorkflows &&
    !needsWeatherAlerts &&
    !needsLandlordIncentives &&
    !legacyToolPlan.runMarketData &&
    intentResult.intent !== "market_rent_estimate" &&
    intentResult.intent !== "market_analysis" &&
    intentResult.intent !== "comparable_rentals" &&
    intentResult.intent !== "property_priority" &&
    reasoningEarly.mode !== "recommendation" &&
    reasoningEarly.mode !== "comparison_ranking" &&
    reasoningEarly.mode !== "diagnosis" &&
    evidencePlan.allowPortfolioBriefing &&
    !needsPeriodSummary &&
    !needsOldestWaiting &&
    !needsEntityInvestigation &&
    !needsVendorInactive &&
    !needsVendorOverload &&
    !needsVendorVerification &&
    !needsVendorCompletion &&
    !needsVendorBest &&
    !needsVendorResponseSpeed &&
    (toolNeeds.needsBriefing ||
      shouldFetchPortfolioBriefing({
        intent: intentResult.intent,
        reasoningMode: reasoningEarly.mode,
        playbookId: playbook.id,
      }))
  const needsRanking =
    !propertyDashboardLock &&
    !needsListResidents &&
    !needsDraftCommunication &&
    !needsActiveWorkflows &&
    !needsWeatherAlerts &&
    !needsLandlordIncentives &&
    evidencePlan.allowPropertyRanking &&
    !needsUnitRanking &&
    !needsPeriodSummary &&
    !needsOldestWaiting &&
    !needsEntityInvestigation &&
    !needsVendorResponseSpeed &&
    !needsVendorCompletion &&
    !needsVendorInactive &&
    !needsVendorOverload &&
    !needsVendorVerification &&
    !needsVendorBest &&
    !needsMissingUpdates &&
    !needsApproveRepairs &&
    !needsRecurringRepairs &&
    intentResult.intent !== "vendor" &&
    playbook.id !== "vendor_speed" &&
    playbook.id !== "vendor_best" &&
    playbook.id !== "vendor_completion" &&
    playbook.id !== "vendor_inactive" &&
    playbook.id !== "vendor_overload" &&
    playbook.id !== "vendor_verification" &&
    !playbook.preferTier1Answer &&
    (toolNeeds.needsRankProperties ||
      routeRequiresTool(capabilityRoute, "rank_properties") ||
      intentResult.intent === "property_priority" ||
      reasoningEarly.mode === "comparison_ranking" ||
      reasoningEarly.mode === "diagnosis" ||
      reasoningEarly.mode === "recommendation")

  return {
    needsPeriodSummary,
    needsOldestWaiting,
    needsEntityInvestigation,
    deepOpsCandidate,
    needsDeepOps,
    needsDraftCommunication,
    needsActiveWorkflows,
    needsWeatherAlerts,
    needsLandlordIncentives,
    needsListResidents,
    needsPropertyInsights,
    needsRecurringRepairs,
    needsApproveRepairs,
    needsMissingUpdates,
    needsVendorResponseSpeed,
    needsVendorCompletion,
    needsVendorInactive,
    needsVendorOverload,
    needsVendorVerification,
    needsVendorBest,
    needsUnitRanking,
    needsBriefing,
    needsRanking,
  }
}

/** Prefer turn-plan flags; derive when retrieve runs without a full turn plan. */
export function resolveRetrievalNeeds(input: {
  question: string
  classification: AskUloClassification
  toolNeeds: DomainToolNeedsPatch
  legacyToolPlan: AskUloToolPlan
  precomputed?: AskUloRetrievalNeeds | null
}): AskUloRetrievalNeeds {
  if (input.precomputed) return input.precomputed
  return deriveRetrievalNeeds(input)
}
