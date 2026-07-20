/// <reference lib="deno.ns" />
import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts"
import { classifyAskUloIntent } from "./intent.ts"
import { classifyInvestigationPlaybook } from "./investigationPlaybooks.ts"
import { requiresDeepOperationalInvestigation } from "./deepOperationalInvestigation.ts"
import {
  detectVendorMetric,
  evaluateMetricMatchQc,
  isVendorCompletionQuestion,
  isAnyVendorMetricQuestion,
} from "./questionMetricContext.ts"
import {
  detectQuestionSubject,
  evaluateSubjectMatchQc,
  hasSubjectMismatch,
} from "./questionSubjectMatch.ts"
import { classifyTaskContract } from "./taskCompletion.ts"
import { synthesizeAskUloAnswer } from "./synthesize.ts"

Deno.test("highest completion rate routes to vendor_completion — not property priority", () => {
  const q = "Which vendor has the highest completion rate?"
  assertEquals(isVendorCompletionQuestion(q), true)
  assertEquals(isAnyVendorMetricQuestion(q), true)
  assertEquals(detectVendorMetric(q), "completion")
  assertEquals(detectQuestionSubject(q), "vendor")
  assertEquals(classifyInvestigationPlaybook(q).id, "vendor_completion")
  assertEquals(classifyAskUloIntent(q).intent, "vendor")
  assertEquals(requiresDeepOperationalInvestigation(q), false)
  assertStringIncludes(classifyTaskContract(q).expectedOutput, "completion rate")
})

Deno.test("metric/subject match fails completion question answered as Oakwood priority", () => {
  const q = "Which vendor has the highest completion rate?"
  const bad = [
    "**Top Priority**",
    "",
    "Oakwood Apartments needs your attention first.",
    "",
    "### Why It Ranks First",
    "- 7 critical/urgent work orders",
  ].join("\n")
  assertEquals(hasSubjectMismatch(q, bad), true)
  assertEquals(evaluateSubjectMatchQc({ question: q, answer: bad }).status, "fail")
  assertEquals(
    evaluateMetricMatchQc({ question: q, answer: bad, packetSatisfied: false }).status,
    "fail",
  )
})

Deno.test("synthesize prefers vendorCompletion over property ranking", async () => {
  const prev = Deno.env.get("OPENAI_API_KEY")
  Deno.env.delete("OPENAI_API_KEY")
  try {
    const completionMd = [
      "**Acme Plumbing** has the highest completion rate — **94%** across **18** completed jobs.",
      "",
      "I'm ranking by **completion rate** — not response speed or property priority.",
    ].join("\n")
    const result = await synthesizeAskUloAnswer({
      question: "Which vendor has the highest completion rate?",
      history: [],
      intent: "vendor",
      intentLabel: "Vendor",
      reasoningMode: "comparison_ranking",
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
      deepOpsInvestigation: null,
      recurringRepairs: null,
      repairsToApprove: null,
      missingUpdates: null,
      vendorResponseSpeed: null,
      vendorBest: null,
      vendorCompletion: {
        available: true,
        found: true,
        bullets: ["Acme Plumbing: **94%**"],
        citations: [],
        markdown: completionMd,
        ranked: [
          {
            vendorId: "v1",
            name: "Acme Plumbing",
            completionRate: 0.94,
            completedJobs: 18,
            acceptedJobs: 19,
          },
        ],
      },
      propertyRanking: {
        available: true,
        canRank: true,
        missingData: [],
        bullets: ["Oakwood first"],
        citations: [],
        markdown:
          "**Top Priority**\n\nOakwood Apartments needs your attention first.\n\n### Why It Ranks First\n- 7 critical/urgent work orders",
        portfolioOpenWorkOrders: 40,
        top: {
          building: "Oakwood Apartments",
          whyLines: ["7 critical/urgent work orders"],
          recommendedActions: ["Review critical WOs"],
          criticalWorkOrders: 7,
          escalatedWorkflows: 2,
          openWorkOrders: 18,
          agingWorkOrders: 3,
          healthScore: 42,
          healthDelta4w: -5,
        },
        watch: [],
      },
      investigationPlaybook: {
        id: "vendor_completion",
        preferTier1Answer: false,
        consultTier1First: false,
        deepOpsPrimary: false,
      },
      toolsUsed: ["vendor_completion"],
    })
    assertStringIncludes(result.answer, "Acme Plumbing")
    assertStringIncludes(result.answer, "completion rate")
    assertEquals(/Top Priority/i.test(result.answer), false)
    assertEquals(/needs your attention first/i.test(result.answer), false)
  } finally {
    if (prev != null) Deno.env.set("OPENAI_API_KEY", prev)
  }
})
