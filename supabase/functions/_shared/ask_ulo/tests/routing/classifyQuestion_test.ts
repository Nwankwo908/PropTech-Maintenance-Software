import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import { classifyQuestion } from "../../routing/classifyQuestion.ts"
import { extractBuildingFilter } from "../../tools/properties/buildingFilter.ts"

Deno.test("classifyQuestion: late rent → resident / search / late_rent hint", () => {
  const question = "Which tenants are late on rent at Maple Heights?"
  const classification = classifyQuestion({
    question,
    priorUserTurns: [],
    agentMode: null,
    buildingFilter: extractBuildingFilter(question),
  })

  assertEquals(classification.subject, "resident")
  assertEquals(classification.capability.capability, "search")
  assertEquals(classification.capability.hints.residentFilter, "late_rent")
  assertEquals(classification.propertyLabel, "Maple Heights")
  assertEquals(classification.propertyId, "maple-heights")
  assertEquals(classification.decision.action, "lookup")
  assertEquals(classification.decision.toolCalls.length, 0)
  assertEquals(
    classification.decision.tools.includes("search_residents"),
    true,
  )
  assertEquals(classification.evidencePlan.subject, "resident")
})

Deno.test("classifyQuestion: does not plan tool arguments (decide owns that)", () => {
  const classification = classifyQuestion({
    question: "Who are my fastest plumbers?",
    priorUserTurns: [],
    agentMode: null,
  })
  assertEquals(classification.decision.toolCalls.length, 0)
  assertEquals(classification.subject, "vendor")
})
