/**
 * Retrieval tool plan — playbook needs → domain tool calls at plan time.
 */
/// <reference lib="deno.ns" />
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import { classifyQuestion } from "../../routing/classifyQuestion.ts"
import { deriveRetrievalNeeds } from "../../routing/deriveRetrievalNeeds.ts"
import { planToolsForIntent } from "../../routing/detectIntent.ts"
import { buildRetrievalToolPlan, shouldPlanOpsGraph } from "../../routing/buildRetrievalToolPlan.ts"
import { applyPlannedToolsToNeeds, emptyNeedsPatch } from "../../routing/toolSelectNeeds.ts"
import { extractBuildingFilter } from "../../tools/properties/buildingFilter.ts"

function planForQuestion(question: string) {
  const classification = classifyQuestion({
    question,
    priorUserTurns: [],
    agentMode: null,
    buildingFilter: extractBuildingFilter(question),
  })
  const legacyToolPlan = planToolsForIntent(classification.intentResult.intent)
  const toolNeeds = emptyNeedsPatch()
  toolNeeds.needsVendorResponseSpeed = true
  const retrievalNeeds = deriveRetrievalNeeds({
    question,
    classification,
    toolNeeds,
    legacyToolPlan,
  })
  return buildRetrievalToolPlan({
    retrievalNeeds,
    classification,
    legacyToolPlan,
    toolNeeds,
  })
}

Deno.test("buildRetrievalToolPlan: vendor speed → rank_vendors response_time", () => {
  const planned = planForQuestion("Which vendor responds fastest?")
  const rank = planned.find((p) => p.name === "rank_vendors")
  assertEquals(rank?.arguments.metric, "response_time")
})

Deno.test("buildRetrievalToolPlan: approve repairs → get_awaiting_decisions", () => {
  const classification = classifyQuestion({
    question: "What repairs need my approval?",
    priorUserTurns: [],
    agentMode: null,
    buildingFilter: null,
  })
  const legacyToolPlan = planToolsForIntent(classification.intentResult.intent)
  const toolNeeds = applyPlannedToolsToNeeds(
    [{ name: "get_awaiting_decisions", arguments: { maintenanceOnly: true } }],
    classification.toolSelectLocks,
  )
  const retrievalNeeds = deriveRetrievalNeeds({
    question: "What repairs need my approval?",
    classification,
    toolNeeds,
    legacyToolPlan,
  })
  const planned = buildRetrievalToolPlan({
    retrievalNeeds,
    classification,
    legacyToolPlan,
    toolNeeds,
  })
  assertEquals(planned.some((p) => p.name === "get_awaiting_decisions"), true)
})

Deno.test("buildRetrievalToolPlan: property snapshot when intent allows", () => {
  const classification = classifyQuestion({
    question: "Tell me about Maple Heights",
    priorUserTurns: [],
    agentMode: null,
    buildingFilter: "Maple Heights",
  })
  const legacyToolPlan = planToolsForIntent(classification.intentResult.intent)
  const retrievalNeeds = deriveRetrievalNeeds({
    question: "Tell me about Maple Heights",
    classification,
    toolNeeds: emptyNeedsPatch(),
    legacyToolPlan,
  })
  const planned = buildRetrievalToolPlan({
    retrievalNeeds,
    classification,
    legacyToolPlan,
    toolNeeds: emptyNeedsPatch(),
  })
  if (legacyToolPlan.runPropertySnapshot) {
    assertEquals(planned.some((p) => p.name === "get_property_snapshot"), true)
  }
})

Deno.test("shouldPlanOpsGraph respects period-summary exclusion", () => {
  assertEquals(
    shouldPlanOpsGraph({
      retrievalNeeds: {
        needsPeriodSummary: true,
        needsUnitRanking: false,
        needsOldestWaiting: false,
        needsEntityInvestigation: false,
        needsListResidents: false,
        needsDraftCommunication: false,
        needsActiveWorkflows: false,
        needsWeatherAlerts: false,
        needsLandlordIncentives: false,
        needsDeepOps: false,
      } as Parameters<typeof shouldPlanOpsGraph>[0]["retrievalNeeds"],
      legacyToolPlan: { runOpsGraph: true } as Parameters<
        typeof shouldPlanOpsGraph
      >[0]["legacyToolPlan"],
      toolNeeds: { needsOpsGraph: false } as Parameters<
        typeof shouldPlanOpsGraph
      >[0]["toolNeeds"],
      playbookDeepOpsPrimary: false,
    }),
    false,
  )
  assertEquals(
    shouldPlanOpsGraph({
      retrievalNeeds: {
        needsPeriodSummary: false,
        needsUnitRanking: false,
        needsOldestWaiting: false,
        needsEntityInvestigation: false,
        needsListResidents: false,
        needsDraftCommunication: false,
        needsActiveWorkflows: false,
        needsWeatherAlerts: false,
        needsLandlordIncentives: false,
        needsDeepOps: false,
      } as Parameters<typeof shouldPlanOpsGraph>[0]["retrievalNeeds"],
      legacyToolPlan: { runOpsGraph: true } as Parameters<
        typeof shouldPlanOpsGraph
      >[0]["legacyToolPlan"],
      toolNeeds: { needsOpsGraph: false } as Parameters<
        typeof shouldPlanOpsGraph
      >[0]["toolNeeds"],
      playbookDeepOpsPrimary: false,
    }),
    true,
  )
})

Deno.test("mergePlannedToolCalls: primary wins on duplicate tool id", async () => {
  const { mergePlannedToolCalls } = await import("../../routing/mergePlannedTools.ts")
  const merged = mergePlannedToolCalls(
    [{ name: "get_missing_updates", arguments: { source: "primary" } }],
    [{ name: "get_missing_updates", arguments: { source: "secondary" } }],
  )
  assertEquals(merged.length, 1)
  assertEquals(merged[0]?.arguments.source, "primary")
})
