/// <reference lib="deno.ns" />
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  classifyAnalyticalQuery,
  isUnitMaintenanceVolumeQuestion,
} from "./analyticalQuery.ts"
import { classifyAskUloIntent, planToolsForIntent } from "./intent.ts"
import { classifyAskUloReasoningMode } from "./reasoningMode.ts"
import { buildFallbackAskUloAnswer, type AskUloToolPackets } from "./synthesize.ts"

Deno.test("unit maintenance volume question is detected analytically", () => {
  const q = "Which units generate the most maintenance requests?"
  const a = classifyAnalyticalQuery(q)
  assertEquals(a.isUnitMaintenanceVolumeRanking, true)
  assertEquals(a.entity, "unit")
  assertEquals(a.metric, "maintenance_request_count")
  assertEquals(a.ranking, "highest")
  assertEquals(a.timeframeDays, null)
  assertEquals(a.defaultTimeframeDays, 60)
  assertEquals(isUnitMaintenanceVolumeQuestion(q), true)
})

Deno.test("unit maintenance volume → unit_maintenance_ranking intent (not property totals)", () => {
  const q = "Which units generate the most maintenance requests?"
  assertEquals(classifyAskUloIntent(q).intent, "unit_maintenance_ranking")
  assertEquals(classifyAskUloReasoningMode(q).mode, "comparison_ranking")
  assertEquals(planToolsForIntent("unit_maintenance_ranking").runOpsGraph, true)
})

Deno.test("stated timeframe is parsed on unit volume questions", () => {
  const a = classifyAnalyticalQuery(
    "Which units had the most maintenance requests in the last 30 days?",
  )
  assertEquals(a.isUnitMaintenanceVolumeRanking, true)
  assertEquals(a.timeframeDays, 30)
})

Deno.test("open work order total question is NOT unit volume ranking", () => {
  const q = "How many open work orders do I have?"
  assertEquals(isUnitMaintenanceVolumeQuestion(q), false)
  assertEquals(classifyAskUloIntent(q).intent, "maintenance")
})

Deno.test("property attention ranking stays property_priority", () => {
  assertEquals(
    classifyAskUloIntent("Which property needs my attention first?").intent,
    "property_priority",
  )
  assertEquals(
    isUnitMaintenanceVolumeQuestion("Which property needs my attention first?"),
    false,
  )
})

Deno.test("fallback unit ranking uses Quick Answer / Top Units structure", () => {
  const packets: AskUloToolPackets = {
    question: "Which units generate the most maintenance requests?",
    intent: "unit_maintenance_ranking",
    intentLabel: "Unit Maintenance Ranking",
    jurisdiction: { stateCode: "OR", cityLabel: "Portland", citySlug: "portland" },
    reasoningMode: "comparison_ranking",
    unitMaintenanceRanking: {
      available: true,
      canRank: true,
      missingData: [],
      bullets: [],
      citations: [],
      markdown: [
        "## Quick Answer",
        "**Unit 204** at **Maple Heights** generated the most maintenance requests, with **7** requests during the last 60 days.",
        "",
        "## Top Units",
        "1. **Unit 204** — Maple Heights",
        "   7 requests",
        "   Most common issue: Plumbing",
        "   2 currently open",
        "",
        "## What This May Mean",
        "Recurring plumbing repairs may need a deeper inspection.",
        "",
        "## Recommended Next Step",
        "Review the maintenance history for Unit 204 at Maple Heights.",
      ].join("\n"),
      timeframeLabel: "last 60 days",
      timeframeDays: 60,
      timeframeIsDefault: true,
      scopeLabel: "full portfolio",
      unlinkedRequestCount: 0,
      scopedRequestCount: 16,
      openInScope: 3,
      top: {
        unitLabel: "Unit 204",
        building: "Maple Heights",
        totalRequests: 7,
        recentRequests: 2,
        openRequests: 2,
        mostCommonCategory: "Plumbing",
      },
      ranked: [
        {
          unitLabel: "Unit 204",
          building: "Maple Heights",
          totalRequests: 7,
          recentRequests: 2,
          openRequests: 2,
          mostCommonCategory: "Plumbing",
        },
      ],
    },
    toolsUsed: ["unit_maintenance_ranking"],
  }
  const answer = buildFallbackAskUloAnswer(packets)
  assertEquals(answer.includes("Unit 204"), true)
  assertEquals(answer.includes("Maple Heights"), true)
  assertEquals(answer.includes("Quick Answer"), true)
  assertEquals(answer.includes("Top Units"), true)
  assertEquals(/Open maintenance tickets:\s*\d+/i.test(answer), false)
})

Deno.test("fallback incomplete unit ranking does not fabricate a winner", () => {
  const packets: AskUloToolPackets = {
    question: "Which units generate the most maintenance requests?",
    intent: "unit_maintenance_ranking",
    intentLabel: "Unit Maintenance Ranking",
    jurisdiction: { stateCode: "OR", cityLabel: null, citySlug: null },
    reasoningMode: "comparison_ranking",
    unitMaintenanceRanking: {
      available: true,
      canRank: false,
      missingData: ["unit assignments on maintenance requests"],
      bullets: [],
      citations: [],
      markdown:
        "I found maintenance activity for the portfolio, but I could not reliably connect the requests to individual units.",
      timeframeLabel: "last 60 days",
      timeframeDays: 60,
      timeframeIsDefault: true,
      scopeLabel: "full portfolio",
      unlinkedRequestCount: 12,
      scopedRequestCount: 12,
      openInScope: 5,
      top: null,
      ranked: [],
    },
    toolsUsed: ["unit_maintenance_ranking:incomplete"],
  }
  const answer = buildFallbackAskUloAnswer(packets)
  assertEquals(answer.includes("What's missing"), true)
  assertEquals(answer.includes("**12**"), true)
  assertEquals(answer.includes("Unit 204"), false)
  assertEquals(/Top Units|generated the most/i.test(answer), false)
})
