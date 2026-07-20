/// <reference lib="deno.ns" />
import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts"
import { synthesizeAskUloAnswer } from "./synthesize.ts"

Deno.test("synthesize prefers Property Insights over empty deep-ops shell", async () => {
  const prev = Deno.env.get("OPENAI_API_KEY")
  Deno.env.delete("OPENAI_API_KEY")
  try {
    const result = await synthesizeAskUloAnswer({
      question: "What maintenance issues could become expensive if ignored?",
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
        id: "maintenance_risk",
        preferTier1Answer: true,
        consultTier1First: true,
        deepOpsPrimary: false,
      },
      propertyInsights: {
        available: true,
        found: true,
        bullets: ["Recurring Issues: Plumbing issues keep occurring."],
        citations: [],
        markdown:
          "The biggest concern is your recurring **plumbing** problems at **Oakwood Apartments**.",
        insights: [
          {
            tag: "RECURRING ISSUES",
            text: "Plumbing issues keep occurring in Oakwood Apartments.",
            requestCount: 5,
            building: "Oakwood Apartments",
            unitLabel: null,
            categoryLabel: "Plumbing",
          },
        ],
        sufficientForMaintenanceRisk: true,
      },
      deepOpsInvestigation: {
        available: true,
        found: false,
        missingFields: ["request_level"],
        bullets: [],
        citations: [],
        markdown:
          "I can't tell from high-level activity alone — request-level information is unavailable.",
        categories: ["plumbing"],
        isRepairCostQuestion: false,
        ticketCount: 0,
      },
      toolsUsed: ["property_insights", "deep_ops_investigation:none"],
    })

    assertStringIncludes(result.answer, "recurring")
    assertStringIncludes(result.answer, "plumbing")
    assertEquals(/i\s+can'?t\s+tell/i.test(result.answer), false)
  } finally {
    if (prev != null) Deno.env.set("OPENAI_API_KEY", prev)
  }
})
