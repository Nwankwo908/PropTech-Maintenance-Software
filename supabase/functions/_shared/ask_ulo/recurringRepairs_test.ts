/// <reference lib="deno.ns" />
import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts"
import { classifyInvestigationPlaybook } from "./investigationPlaybooks.ts"
import {
  isRecurringRepairsQuestion,
  looksLikePropertyInsightsHeadlineDump,
  normalizeRepairFamily,
  normalizeRepairType,
} from "./recurringRepairsLookup.ts"
import { synthesizeAskUloAnswer } from "./synthesize.ts"

Deno.test("recurring question phrases classify as recurring_repairs", () => {
  for (const q of [
    "What repairs keep happening over and over?",
    "Which repairs are recurring?",
    "What maintenance issues keep coming back?",
    "Are we fixing the same problems repeatedly?",
  ]) {
    assertEquals(isRecurringRepairsQuestion(q), true, q)
    assertEquals(classifyInvestigationPlaybook(q).id, "recurring_repairs", q)
  }
})

Deno.test("normalizeRepairType prefers specific types over broad family", () => {
  assertEquals(
    normalizeRepairType("plumbing", "kitchen faucet drip").id,
    "faucet_sink_leaks",
  )
  assertEquals(normalizeRepairType(null, "clogged drain in bathroom").id, "drain_problems")
  assertEquals(normalizeRepairType("hvac", "AC not cooling upstairs").id, "ac_not_cooling")
  assertEquals(normalizeRepairType("hvac", "AC down during heat advisory").id, "ac_not_cooling")
  assertEquals(
    normalizeRepairType("hvac", "Preventive maintenance: HVAC filter replacement").id,
    "hvac_general",
  )
  assertEquals(normalizeRepairType("electrical", "breaker keeps tripping").id, "breaker_tripping")
  assertEquals(
    normalizeRepairType(
      "electrical",
      "Breaker panel sparking when AC compressor kicks on. Smell of burning plastic.",
    ).id,
    "sparking",
  )
  assertEquals(normalizeRepairFamily("plumbing", "kitchen faucet leak"), "plumbing")
})

Deno.test("insights headline dump detector", () => {
  assertEquals(
    looksLikePropertyInsightsHeadlineDump(
      "### Property Insights\n- **Needs Attention:** Unit 204 has generated the most maintenance requests.\n- **Prevent Future Repairs:** Inspect Unit 305.",
    ),
    true,
  )
  assertEquals(
    looksLikePropertyInsightsHeadlineDump(
      "The repair that keeps recurring most often is faucet and sink leaks at Oakwood.\n\n### Repeated repairs\n- **Faucet and sink leaks:** 4 requests in the last 60 days",
    ),
    false,
  )
})

Deno.test("synthesize prefers recurring repairs over soft unavailable deep-ops", async () => {
  const prev = Deno.env.get("OPENAI_API_KEY")
  Deno.env.delete("OPENAI_API_KEY")
  try {
    const result = await synthesizeAskUloAnswer({
      question: "What repairs keep happening over and over?",
      history: [],
      intent: "ops",
      intentLabel: "Operations",
      jurisdiction: {
        countryCode: "US",
        stateCode: "GA",
        countySlug: null,
        countyLabel: null,
        cityLabel: null,
        citySlug: null,
        courtSystem: null,
        housingProgram: null,
        codeSet: null,
      },
      legalGate: null,
      fairHousing: null,
      humanDecision: null,
      screeningIsolation: false,
      ops: null,
      legal: null,
      structured: null,
      property: null,
      market: null,
      priceHistory: null,
      rentHistory: null,
      investigationPlaybook: {
        id: "recurring_repairs",
        preferTier1Answer: true,
        consultTier1First: true,
        deepOpsPrimary: false,
      },
      recurringRepairs: {
        available: true,
        found: true,
        bullets: ["Faucet and sink leaks: 4"],
        citations: [],
        ticketCount: 12,
        completedTicketCount: 7,
        completedWorkflowCount: 4,
        windowDays: 60,
        patterns: [
          {
            kind: "repair_type",
            label: "Faucet and sink leaks",
            repairTypeId: "faucet_sink_leaks",
            repairTypeLabel: "Faucet and sink leaks",
            count: 4,
            building: "Oakwood Apartments",
            unitLabel: null,
            categoryFamily: "plumbing",
            completedCount: 3,
            openCount: 1,
            reopenedAfterCompletion: true,
          },
        ],
        markdown:
          "The repair that keeps recurring most often is **faucet and sink leaks** at Oakwood Apartments.\n\n### Repeated repairs\n- **Faucet and sink leaks:** 4 requests in the last 60 days (3 completed)",
      },
      deepOpsInvestigation: {
        available: true,
        found: false,
        missingFields: [],
        bullets: [],
        citations: [],
        markdown:
          "I can see high-level activity across your portfolio. I'm missing the request-level history.",
        categories: [],
        isRepairCostQuestion: false,
        ticketCount: 0,
      },
      toolsUsed: ["recurring_repairs"],
    })

    assertStringIncludes(result.answer, "faucet")
    assertStringIncludes(result.answer, "60 days")
    assertEquals(/Needs Attention/i.test(result.answer), false)
    assertEquals(/Prevent Future Repairs/i.test(result.answer), false)
    assertEquals(/request-level history/i.test(result.answer), false)
  } finally {
    if (prev != null) Deno.env.set("OPENAI_API_KEY", prev)
  }
})
