/// <reference lib="deno.ns" />
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  classifyAskUloReasoningMode,
  isComparisonRankingQuestion,
  isExecutiveBriefingQuestion,
  isNarrowFactualOpsQuestion,
  isRecommendationQuestion,
} from "./briefingIntent.ts"
import { classifyAskUloIntent, planToolsForIntent } from "./intent.ts"
import { buildFallbackAskUloAnswer, type AskUloToolPackets } from "./synthesize.ts"

Deno.test("executive briefing: how healthy is my portfolio", () => {
  assertEquals(isExecutiveBriefingQuestion("How healthy is my portfolio right now?"), true)
  const r = classifyAskUloIntent("How healthy is my portfolio right now?")
  assertEquals(r.intent, "executive_briefing")
  assertEquals(planToolsForIntent(r.intent).runOpsGraph, true)
  assertEquals(planToolsForIntent(r.intent).runPropertySnapshot, true)
})

Deno.test("executive briefing: catch me up / what did I miss", () => {
  assertEquals(isExecutiveBriefingQuestion("Catch me up."), true)
  assertEquals(classifyAskUloIntent("Catch me up.").intent, "executive_briefing")
  assertEquals(classifyAskUloIntent("What did I miss?").intent, "executive_briefing")
  assertEquals(classifyAskUloIntent("How are things going?").intent, "executive_briefing")
  assertEquals(
    classifyAskUloIntent("Is there anything I should be worried about?").intent,
    "executive_briefing",
  )
})

Deno.test("strategic focus → executive_briefing; risk/money stay priority", () => {
  assertEquals(isRecommendationQuestion("What should I focus on today?"), false)
  assertEquals(
    classifyAskUloIntent("What should I focus on today?").intent,
    "executive_briefing",
  )
  assertEquals(
    classifyAskUloReasoningMode("What is my biggest risk?").mode,
    "recommendation",
  )
  assertEquals(classifyAskUloIntent("What is my biggest risk?").intent, "property_priority")
  assertEquals(
    ["finance", "property_priority"].includes(
      classifyAskUloIntent("Where am I losing money?").intent,
    ),
    true,
  )
})

Deno.test("comparison ranking: which property needs attention first", () => {
  const q = "Which property needs my attention first?"
  assertEquals(isComparisonRankingQuestion(q), true)
  assertEquals(classifyAskUloReasoningMode(q).mode, "comparison_ranking")
  assertEquals(classifyAskUloIntent(q).intent, "property_priority")
  assertEquals(planToolsForIntent("property_priority").runOpsGraph, true)
  assertEquals(
    classifyAskUloIntent("Which building is performing the worst?").intent,
    "property_priority",
  )
})

Deno.test("diagnosis: is anything becoming a problem", () => {
  assertEquals(
    classifyAskUloReasoningMode("Is anything becoming a problem?").mode,
    "diagnosis",
  )
  assertEquals(
    classifyAskUloIntent("Is anything becoming a problem?").intent,
    "property_priority",
  )
})

Deno.test("narrow factual: how many open work orders stays short-path", () => {
  const q = "How many open work orders do I have?"
  assertEquals(isNarrowFactualOpsQuestion(q), true)
  assertEquals(isExecutiveBriefingQuestion(q), false)
  const r = classifyAskUloIntent(q)
  assertEquals(r.intent, "maintenance")
})

Deno.test("legal questions are not swallowed by briefing", () => {
  const r = classifyAskUloIntent("What is the security deposit limit in Oregon?")
  assertEquals(r.intent, "legal")
})

Deno.test("fallback ranking answer never uses General filler", () => {
  const packets: AskUloToolPackets = {
    question: "Which property needs my attention first?",
    intent: "property_priority",
    intentLabel: "Property Priority",
    jurisdiction: {
      stateCode: "OR",
      cityLabel: "Portland",
      citySlug: "portland",
    },
    reasoningMode: "comparison_ranking",
    propertyRanking: {
      available: true,
      canRank: true,
      missingData: [],
      bullets: [],
      citations: [],
      markdown: "",
      portfolioOpenWorkOrders: 25,
      top: {
        building: "Oakwood Apartments",
        whyLines: [
          "3 critical/urgent work orders",
          "2 escalated workflows needing landlord action",
        ],
        recommendedActions: [
          "Review critical/urgent requests first and confirm resident safety or habitability.",
          "Clear escalated workflows — reassign vendors or make the pending landlord decision.",
        ],
        openWorkOrders: 8,
        criticalWorkOrders: 3,
        agingWorkOrders: 2,
        escalatedWorkflows: 2,
        healthScore: 58,
        healthDelta4w: -8,
      },
      watch: [
        {
          building: "Harbor Point",
          whyLines: ["growing maintenance backlog"],
          openWorkOrders: 12,
        },
      ],
    },
    toolsUsed: ["property_ranking"],
  }
  const answer = buildFallbackAskUloAnswer(packets)
  assertEquals(answer.includes("Oakwood Apartments"), true)
  assertEquals(answer.includes("Why It Ranks First"), true)
  assertEquals(answer.includes("looking at this as"), false)
  assertEquals(answer.includes("Ask a follow-up"), false)
  assertEquals(/Open maintenance tickets:\s*25/i.test(answer), false)
})

Deno.test("fallback incomplete ranking states missing data", () => {
  const packets: AskUloToolPackets = {
    question: "Which property needs my attention first?",
    intent: "property_priority",
    intentLabel: "Property Priority",
    jurisdiction: { stateCode: "OR", cityLabel: null, citySlug: null },
    reasoningMode: "comparison_ranking",
    propertyRanking: {
      available: true,
      canRank: false,
      missingData: ["property assignments on open work orders"],
      bullets: [],
      citations: [],
      markdown: "",
      portfolioOpenWorkOrders: 25,
      top: null,
      watch: [],
    },
    toolsUsed: ["property_ranking:incomplete"],
  }
  const answer = buildFallbackAskUloAnswer(packets)
  assertEquals(answer.includes("**25**"), true)
  assertEquals(answer.includes("What's missing"), true)
  assertEquals(/which properties those open requests belong to/i.test(answer), true)
  assertEquals(/Oakwood|Top priority:\s*\*\*/i.test(answer), false)
  assertEquals(answer.includes("Ask a follow-up"), false)
})
