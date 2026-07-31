/**
 * Route decision card — debuggable intent / subject / tools.
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import { buildExecutionPlan } from "../../routing/buildExecutionPlan.ts"
import { extractBuildingFilter } from "../../tools/properties/buildingFilter.ts"
import {
  capabilityToRouteAction,
  slugifyPropertyLabel,
} from "../../routing/routeDecision.ts"

Deno.test("late rent at Maple Heights → lookup / resident / search_residents", () => {
  const question = "Which tenants are late on rent at Maple Heights?"
  const buildingFilter = extractBuildingFilter(question)
  assertEquals(buildingFilter, "Maple Heights")

  const plan = buildExecutionPlan({
    question,
    priorUserTurns: [],
    agentMode: null,
    buildingFilter,
  })

  assertEquals(plan.decision.action, "lookup")
  assertEquals(plan.decision.subject, "resident")
  assertEquals(plan.decision.capability, "search")
  assertEquals(plan.decision.propertyLabel, "Maple Heights")
  assertEquals(plan.decision.propertyId, "maple-heights")
  assertEquals(plan.decision.tools.includes("search_residents"), true)
  assertEquals(plan.decision.hints.residentFilter, "late_rent")
  assertEquals(
    plan.decision.toolCalls.some(
      (t) => t.name === "search_residents" && t.arguments?.filter === "late_rent",
    ),
    true,
  )
})

Deno.test("capabilityToRouteAction maps search → lookup", () => {
  assertEquals(capabilityToRouteAction("search"), "lookup")
  assertEquals(capabilityToRouteAction("rank"), "rank")
  assertEquals(capabilityToRouteAction("draft"), "draft")
})

Deno.test("slugifyPropertyLabel", () => {
  assertEquals(slugifyPropertyLabel("Maple Heights"), "maple-heights")
  assertEquals(slugifyPropertyLabel(null), null)
})
