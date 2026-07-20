/// <reference lib="deno.ns" />
import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts"
import { classifyInvestigationPlaybook } from "./investigationPlaybooks.ts"
import { requiresDeepOperationalInvestigation } from "./deepOperationalInvestigation.ts"
import { isMissingUpdatesQuestion } from "./missingUpdatesLookup.ts"
import { synthesizeAskUloAnswer } from "./synthesize.ts"

Deno.test("missing-updates phrases classify correctly and skip deep ops", () => {
  for (const q of [
    "Which work orders are missing updates?",
    "Which tickets have no status updates?",
    "What repairs are stale with no progress?",
  ]) {
    assertEquals(isMissingUpdatesQuestion(q), true, q)
    assertEquals(classifyInvestigationPlaybook(q).id, "missing_updates", q)
    assertEquals(requiresDeepOperationalInvestigation(q), false, q)
  }
  const p = classifyInvestigationPlaybook("Which work orders are missing updates?")
  assertEquals(p.deepOpsPrimary, false)
  assertEquals(p.preferTier1Answer, false)
})

Deno.test("synthesize prefers missingUpdates list over deep-ops field dump", async () => {
  const prev = Deno.env.get("OPENAI_API_KEY")
  Deno.env.delete("OPENAI_API_KEY")
  try {
    const md = [
      "These **3** open repairs are missing updates — nothing meaningful has moved in a while.",
      "",
      "### Going quiet",
      "- **Refrigerator not cooling** — Oakwood Apartments · Unit 204 (WO-B8AF): Still unassigned — sitting in the backlog (4 days). I'd assign a vendor today.",
    ].join("\n")
    const result = await synthesizeAskUloAnswer({
      question: "Which work orders are missing updates?",
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
      portfolioBriefing: null,
      propertyInsights: null,
      periodSummary: null,
      oldestWaitingWorkOrder: null,
      entityInvestigation: null,
      deepOpsInvestigation: {
        available: true,
        found: true,
        markdown:
          "The appliance repair request at **Oakwood Apartments, Unit 204** (WO-B8AF) is the one I'd focus on first.\n\n### What's going on\n- **Work order:** WO-B8AF\n- **Labor estimate:** 1–2 hours",
        bullets: [],
        citations: [],
        categories: ["appliance"],
        ticketCount: 1,
        missingFields: [],
        isRepairCostQuestion: false,
        workOrders: [],
        operationalEvidenceJson: "",
      },
      recurringRepairs: null,
      repairsToApprove: null,
      missingUpdates: {
        available: true,
        found: true,
        bullets: ["Refrigerator: unassigned"],
        citations: [],
        markdown: md,
        openCount: 12,
        items: [
          {
            displayId: "WO-B8AF",
            label: "Refrigerator not cooling",
            building: "Oakwood Apartments",
            unitLabel: "204",
            whyMissing: "Still unassigned",
            daysWaiting: 4,
            status: "unassigned",
          },
        ],
      },
      investigationPlaybook: {
        id: "missing_updates",
        preferTier1Answer: false,
        consultTier1First: false,
        deepOpsPrimary: false,
      },
      toolsUsed: ["missing_updates"],
    })
    assertStringIncludes(result.answer, "Going quiet")
    assertStringIncludes(result.answer, "missing updates")
    assertEquals(/Labor estimate/i.test(result.answer), false)
    assertEquals(/What's going on/i.test(result.answer), false)
  } finally {
    if (prev != null) Deno.env.set("OPENAI_API_KEY", prev)
  }
})
