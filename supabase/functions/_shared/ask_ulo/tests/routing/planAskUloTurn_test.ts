import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import { classifyQuestion } from "../../routing/classifyQuestion.ts"
import { planAskUloTurn } from "../../routing/planAskUloTurn.ts"
import { extractBuildingFilter } from "../../tools/properties/buildingFilter.ts"

Deno.test("planAskUloTurn: late rent returns required search_residents + retrieval needs", async () => {
  const question = "Which tenants are late on rent at Maple Heights?"
  const classification = classifyQuestion({
    question,
    priorUserTurns: [],
    agentMode: null,
    buildingFilter: extractBuildingFilter(question),
  })

  const plan = await planAskUloTurn(classification, question)

  assertEquals(plan.requiredTools.includes("search_residents"), true)
  assertEquals(plan.plannedTools.some((t) => t.name === "search_residents"), true)
  assertEquals(
    plan.plannedTools.find((t) => t.name === "search_residents")?.arguments
      ?.filter,
    "late_rent",
  )
  assertEquals(plan.retrievalNeeds.needsListResidents, true)
  assertEquals(typeof plan.toolSelectSource, "string")
  assertEquals(plan.classification.subject, "resident")
  assertEquals(plan.decision.propertyLabel, "Maple Heights")
})
