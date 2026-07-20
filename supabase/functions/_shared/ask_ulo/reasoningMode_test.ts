/// <reference lib="deno.ns" />
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  classifyAskUloReasoningMode,
  isComparisonRankingQuestion,
  isDiagnosisQuestion,
  isRecommendationQuestion,
  requiresEntityLevelComparison,
} from "./reasoningMode.ts"

Deno.test("reasoning modes cover the attention / risk family", () => {
  assertEquals(
    classifyAskUloReasoningMode("Which property needs my attention first?").mode,
    "comparison_ranking",
  )
  assertEquals(
    classifyAskUloReasoningMode("How healthy is my portfolio?").mode,
    "executive_briefing",
  )
  assertEquals(
    classifyAskUloReasoningMode("What should I focus on today?").mode,
    "executive_briefing",
  )
  assertEquals(
    classifyAskUloReasoningMode("Which building is performing the worst?").mode,
    "comparison_ranking",
  )
  assertEquals(
    classifyAskUloReasoningMode("Is anything becoming a problem?").mode,
    "diagnosis",
  )
  assertEquals(
    classifyAskUloReasoningMode("Where am I losing money?").mode,
    "recommendation",
  )
  assertEquals(
    classifyAskUloReasoningMode("What is my biggest risk?").mode,
    "recommendation",
  )
  assertEquals(
    classifyAskUloReasoningMode("How many open work orders do I have?").mode,
    "factual",
  )
})

Deno.test("Compare Oakwood to Harbor Point is ranking; nearby rentals is comps", () => {
  assertEquals(isComparisonRankingQuestion("Compare Oakwood to Harbor Point"), true)
  assertEquals(
    isComparisonRankingQuestion("Compare Maple Heights to nearby rentals"),
    false,
  )
  assertEquals(requiresEntityLevelComparison("comparison_ranking"), true)
  assertEquals(requiresEntityLevelComparison("factual"), false)
  assertEquals(isDiagnosisQuestion("What is driving the backlog?"), true)
  assertEquals(isRecommendationQuestion("What would you recommend?"), true)
})
