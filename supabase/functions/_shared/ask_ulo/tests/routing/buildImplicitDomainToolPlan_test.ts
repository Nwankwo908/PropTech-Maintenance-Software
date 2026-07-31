/**
 * Implicit domain tool plan — playbook needs without explicit capability plan.
 */
/// <reference lib="deno.ns" />
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import { buildImplicitDomainToolPlan } from "../../retrieval/buildImplicitDomainToolPlan.ts"
import type { SpecialtyFetchContext, SpecialtyFetchNeeds } from "../../retrieval/fetchSpecialtyEvidence.ts"

function emptyNeeds(): SpecialtyFetchNeeds {
  return {
    needsOpsGraph: false,
    runLegalTools: false,
    runStructured: false,
    intentIsLegal: false,
    needsDraftCommunication: false,
    needsActiveWorkflows: false,
    needsWeatherAlerts: false,
    needsLandlordIncentives: false,
    runPropertySnapshot: false,
    needsListResidents: false,
    needsBriefing: false,
    needsPropertyInsights: false,
    needsRecurringRepairs: false,
    needsApproveRepairs: false,
    needsMissingUpdates: false,
    needsVendorResponseSpeed: false,
    needsVendorBest: false,
    needsVendorCompletion: false,
    needsVendorInactive: false,
    needsVendorOverload: false,
    needsVendorVerification: false,
    needsRanking: false,
    needsUnitRanking: false,
    needsPeriodSummary: false,
    needsOldestWaiting: false,
    needsEntityInvestigation: false,
    needsDeepOps: false,
    needsMarketIntelligence: false,
  }
}

function baseCtx(): SpecialtyFetchContext {
  return {
    supabase: {} as SpecialtyFetchContext["supabase"],
    landlordId: "landlord-1",
    question: "Which vendor responds fastest?",
    retrievalQuestion: "Which vendor responds fastest?",
    buildingFilter: null,
    plannedTools: [],
    capabilityHints: { vendorMetric: "response_time" },
    analytical: {
      entity: null,
      metric: null,
      ranking: null,
      timeframeDays: null,
      defaultTimeframeDays: 60,
      scope: null,
      isUnitMaintenanceVolumeRanking: false,
      confidence: "low",
      reason: "test",
    },
    portfolioJurisdiction: { stateCode: "OR", citySlug: null },
    effectiveJurisdiction: { stateCode: "OR", cityLabel: null, citySlug: null },
  }
}

Deno.test("buildImplicitDomainToolPlan: vendor speed → rank_vendors response_time", () => {
  const needs = emptyNeeds()
  needs.needsVendorResponseSpeed = true
  const planned = buildImplicitDomainToolPlan(needs, baseCtx(), new Set())
  const rank = planned.find((p) => p.name === "rank_vendors")
  assertEquals(rank?.arguments.metric, "response_time")
})

Deno.test("buildImplicitDomainToolPlan: approve repairs → get_awaiting_decisions", () => {
  const needs = emptyNeeds()
  needs.needsApproveRepairs = true
  const planned = buildImplicitDomainToolPlan(needs, baseCtx(), new Set())
  assertEquals(planned.some((p) => p.name === "get_awaiting_decisions"), true)
})

Deno.test("buildImplicitDomainToolPlan: property snapshot intent → get_property_snapshot", () => {
  const needs = emptyNeeds()
  needs.runPropertySnapshot = true
  const planned = buildImplicitDomainToolPlan(needs, baseCtx(), new Set())
  assertEquals(planned.some((p) => p.name === "get_property_snapshot"), true)
})

Deno.test("buildImplicitDomainToolPlan: skips tools already in planned set", () => {
  const needs = emptyNeeds()
  needs.needsMissingUpdates = true
  const planned = buildImplicitDomainToolPlan(needs, baseCtx(), new Set(["get_missing_updates"]))
  assertEquals(planned.some((p) => p.name === "get_missing_updates"), false)
})
