/// <reference lib="deno.ns" />
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  classifyResponseFormat,
  isPeriodSummaryQuestion,
  parsePeriodSummaryWindow,
} from "./dynamicResponse.ts"
import { classifyAskUloIntent } from "./intent.ts"
import { requiresReasoningTransparency } from "./reasoningTransparency.ts"
import { buildFallbackAskUloAnswer, type AskUloToolPackets } from "./synthesize.ts"

Deno.test("period summary question detection", () => {
  assertEquals(
    isPeriodSummaryQuestion("Give me a summary of everything that happened this week."),
    true,
  )
  assertEquals(isPeriodSummaryQuestion("What happened this week?"), true)
  assertEquals(isPeriodSummaryQuestion("Weekly summary please"), true)
  assertEquals(isPeriodSummaryQuestion("How healthy is my portfolio?"), false)
  assertEquals(isPeriodSummaryQuestion("How many open work orders do I have?"), false)
})

Deno.test("period summary → period_summary intent (not open-ticket briefing)", () => {
  const q = "Give me a summary of everything that happened this week."
  assertEquals(classifyAskUloIntent(q).intent, "period_summary")
  assertEquals(classifyResponseFormat(q), "summary")
  assertEquals(parsePeriodSummaryWindow(q).days, 7)
  assertEquals(parsePeriodSummaryWindow(q).label, "this week")
})

Deno.test("transparency is not forced on period summary or unit ranking", () => {
  assertEquals(
    requiresReasoningTransparency({
      intent: "period_summary",
      reasoningMode: "executive_briefing",
    }),
    false,
  )
  assertEquals(
    requiresReasoningTransparency({
      intent: "unit_maintenance_ranking",
      reasoningMode: "comparison_ranking",
    }),
    false,
  )
  assertEquals(
    requiresReasoningTransparency({
      intent: "property_priority",
      reasoningMode: "comparison_ranking",
    }),
    true,
  )
  assertEquals(
    requiresReasoningTransparency({
      intent: "maintenance",
      reasoningMode: "factual",
    }),
    false,
  )
})

Deno.test("fallback period summary never answers with only open ticket count", () => {
  const packets: AskUloToolPackets = {
    question: "Give me a summary of everything that happened this week.",
    intent: "period_summary",
    intentLabel: "Period Summary",
    jurisdiction: { stateCode: "OR", cityLabel: "Portland", citySlug: "portland" },
    periodSummary: {
      available: true,
      canSummarize: true,
      missingData: [],
      bullets: [],
      citations: [],
      markdown: [
        "## This Week at a Glance",
        "",
        "During this week (July 6 – July 12), **12** maintenance requests were created and about **8** were completed. 4 from this period are still open, including 1 critical/urgent.",
        "",
        "### Maintenance",
        "- 12 new requests",
        "- 8 completed",
        "- 4 from this period still open",
        "",
        "### Vendors",
        "- 6 jobs accepted (from recorded events)",
        "- 1 vendor declines",
        "- 1 reassignments / missed-response actions",
        "",
        "### Rent and Leasing",
        "- 14 rent / collection events",
        "- 3 lease / renewal events",
        "",
        "### Needs Your Attention",
        "- Address critical plumbing issue at Maple Heights · Unit 204",
      ].join("\n"),
      periodLabel: "this week",
      periodDays: 7,
      periodIsDefault: false,
      scopeLabel: "full portfolio",
      facts: {
        newMaintenance: 12,
        completedMaintenance: 8,
        stillOpenCreatedInPeriod: 4,
        criticalOrUrgent: 1,
        graphEventCount: 40,
      },
    },
    toolsUsed: ["period_summary"],
  }
  const answer = buildFallbackAskUloAnswer(packets)
  assertEquals(answer.includes("This Week at a Glance"), true)
  assertEquals(answer.includes("12"), true)
  assertEquals(answer.includes("Maintenance"), true)
  assertEquals(/^## Quick Answer/m.test(answer), false)
  assertEquals(/Open maintenance tickets:\s*\d+/i.test(answer), false)
})

Deno.test("ranking format still preferred for unit volume questions", () => {
  assertEquals(
    classifyResponseFormat("Which units generate the most maintenance requests?"),
    "ranking",
  )
})
