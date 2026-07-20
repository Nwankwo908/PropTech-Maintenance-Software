/// <reference lib="deno.ns" />
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import { classifyResponseFormat } from "./dynamicResponse.ts"
import { classifyAskUloIntent } from "./intent.ts"
import { isFirstActionPriorityQuestion, isStrategicBriefingQuestion } from "./reasoningFirst.ts"
import { classifyAskUloReasoningMode, shouldFetchPortfolioBriefing } from "./reasoningMode.ts"

Deno.test("strategic briefing detection", () => {
  assertEquals(
    isStrategicBriefingQuestion("What should I worry about over the next 30 days?"),
    true,
  )
  assertEquals(isStrategicBriefingQuestion("What am I missing?"), true)
  assertEquals(isStrategicBriefingQuestion("What would you do?"), true)
  assertEquals(isStrategicBriefingQuestion("What would you do first?"), false)
  assertEquals(
    isStrategicBriefingQuestion("If you owned my portfolio, what would you do first?"),
    false,
  )
  assertEquals(isStrategicBriefingQuestion("What should I prioritize?"), true)
  assertEquals(isStrategicBriefingQuestion("How many open work orders do I have?"), false)
})

Deno.test("strategic questions → executive_briefing mode + intent", () => {
  const q = "What should I worry about over the next 30 days?"
  assertEquals(classifyAskUloReasoningMode(q).mode, "executive_briefing")
  assertEquals(classifyAskUloIntent(q).intent, "executive_briefing")
  assertEquals(classifyResponseFormat(q), "executive_briefing")
})

Deno.test("what should I prioritize is briefing not ranking", () => {
  assertEquals(
    classifyAskUloReasoningMode("What should I prioritize?").mode,
    "executive_briefing",
  )
  assertEquals(
    classifyAskUloReasoningMode("Which property needs my attention first?").mode,
    "comparison_ranking",
  )
})

Deno.test("if you owned / do first → recommendation priority, not briefing", () => {
  const q = "If you owned my portfolio, what would you do first?"
  assertEquals(classifyAskUloReasoningMode(q).mode, "recommendation")
  assertEquals(classifyAskUloIntent(q).intent, "property_priority")
  assertEquals(classifyAskUloReasoningMode("What would you do first?").mode, "recommendation")
})

Deno.test("smartest decision today → recommendation priority, not briefing", () => {
  const q = "What's the smartest decision I can make today to improve my portfolio?"
  assertEquals(isFirstActionPriorityQuestion(q), true)
  assertEquals(isStrategicBriefingQuestion(q), false)
  assertEquals(classifyAskUloReasoningMode(q).mode, "recommendation")
  assertEquals(classifyAskUloIntent(q).intent, "property_priority")
})

Deno.test("portfolio briefing fetch is opt-in only", () => {
  assertEquals(
    shouldFetchPortfolioBriefing({
      intent: "ops",
      reasoningMode: "factual",
      playbookId: "generic_ops",
    }),
    false,
  )
  assertEquals(
    shouldFetchPortfolioBriefing({
      intent: "executive_briefing",
      reasoningMode: "executive_briefing",
      playbookId: "executive_briefing",
    }),
    true,
  )
  assertEquals(
    shouldFetchPortfolioBriefing({
      intent: "property_priority",
      reasoningMode: "recommendation",
      playbookId: "generic_ops",
    }),
    false,
  )
})
