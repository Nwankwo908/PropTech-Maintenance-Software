/// <reference lib="deno.ns" />
import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts"
import { classifyAskUloIntent } from "./intent.ts"
import { classifyInvestigationPlaybook } from "./investigationPlaybooks.ts"
import { requiresDeepOperationalInvestigation } from "./deepOperationalInvestigation.ts"
import {
  detectQuestionSubject,
  evaluateSubjectMatchQc,
  hasSubjectMismatch,
  isVendorPoorResponseSpeedQuestion,
  isVendorResponseSpeedQuestion,
} from "./questionSubjectMatch.ts"
import {
  detectVendorMetric,
  evaluateMetricMatchQc,
  looksLikeBestForResponseSpeedAnswer,
} from "./questionMetricContext.ts"
import { buildVendorResponseSpeedMarkdown } from "./vendorResponseSpeedLookup.ts"
import { synthesizeAskUloAnswer } from "./synthesize.ts"

Deno.test("vendor response-speed phrases classify correctly and skip deep ops / property priority", () => {
  for (const q of [
    "Which vendors respond the fastest?",
    "Which vendors respond fastest?",
    "Who are the fastest vendors to respond?",
    "Which vendors have poor response times?",
    "Which vendors are slowest to respond?",
  ]) {
    assertEquals(isVendorResponseSpeedQuestion(q), true, q)
    assertEquals(detectQuestionSubject(q), "vendor", q)
    assertEquals(classifyInvestigationPlaybook(q).id, "vendor_speed", q)
    assertEquals(classifyAskUloIntent(q).intent, "vendor", q)
    assertEquals(requiresDeepOperationalInvestigation(q), false, q)
  }
})

Deno.test("poor response times uses slowest framing — not best score", () => {
  const q = "Which vendors have poor response times?"
  assertEquals(isVendorPoorResponseSpeedQuestion(q), true)
  assertEquals(detectVendorMetric(q), "response_speed")
  const bestMd = [
    "**FreshNest Cleaning** is your best vendor right now — score **5/5**.",
    "",
    "Overall vendor score combines satisfaction, completion, response time, and rework — not response speed alone.",
    "",
    "### Top vendors",
    "1. **FreshNest Cleaning** — score **5/5**.",
  ].join("\n")
  assertEquals(looksLikeBestForResponseSpeedAnswer(q, bestMd), true)
  assertEquals(
    evaluateMetricMatchQc({ question: q, answer: bestMd, packetSatisfied: false }).status,
    "fail",
  )

  const speedMd = buildVendorResponseSpeedMarkdown({
    mode: "slowest",
    ranked: [
      {
        vendorId: "v1",
        name: "SlowCo",
        avgResponseMinutes: 720,
        acceptedJobs: 4,
        completedJobs: 2,
        responseSpeedScore: 1,
      },
    ],
  })
  assertStringIncludes(speedMd, "SlowCo")
  assertStringIncludes(speedMd, "average response time")
  assertEquals(/\bTop vendors\b/i.test(speedMd), false)
  assertEquals(/best vendor/i.test(speedMd), false)
})

Deno.test("subject match fails vendor question answered as property priority", () => {
  const q = "Which vendors respond the fastest?"
  const bad = [
    "**Top Priority**",
    "",
    "Oakwood Apartments needs your attention first.",
    "",
    "### Why It Ranks First",
    "- 7 critical/urgent work orders",
  ].join("\n")
  assertEquals(hasSubjectMismatch(q, bad), true)
  const qc = evaluateSubjectMatchQc({ question: q, answer: bad })
  assertEquals(qc.status, "fail")
  assertEquals(qc.subject, "vendor")
})

Deno.test("subject match passes when vendor answer names vendors", () => {
  const q = "Which vendors respond the fastest?"
  const good =
    "**Acme Plumbing** responds the fastest — typically about **45 minutes** from notify to first accept/decline."
  assertEquals(hasSubjectMismatch(q, good), false)
  assertEquals(
    evaluateSubjectMatchQc({ question: q, answer: good }).status,
    "pass",
  )
})

Deno.test("synthesize prefers vendorResponseSpeed over property ranking", async () => {
  const prev = Deno.env.get("OPENAI_API_KEY")
  Deno.env.delete("OPENAI_API_KEY")
  try {
    const md = [
      "**QuickFix HVAC** responds the fastest — typically about **32 minutes** from notify to first accept/decline.",
      "",
      "### Fastest responders",
      "1. **QuickFix HVAC** — about **32 minutes** average response (12 accepted jobs).",
    ].join("\n")
    const result = await synthesizeAskUloAnswer({
      question: "Which vendors respond the fastest?",
      history: [],
      intent: "vendor",
      intentLabel: "Vendor",
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
      vendorResponseSpeed: {
        available: true,
        found: true,
        bullets: ["QuickFix HVAC: about **32 minutes**"],
        citations: [],
        markdown: md,
        ranked: [
          {
            vendorId: "v1",
            name: "QuickFix HVAC",
            avgResponseMinutes: 32,
            acceptedJobs: 12,
            completedJobs: 10,
            responseSpeedScore: 4,
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
        id: "vendor_speed",
        preferTier1Answer: false,
        consultTier1First: false,
        deepOpsPrimary: false,
      },
      toolsUsed: ["vendor_response_speed"],
    })
    assertStringIncludes(result.answer, "QuickFix HVAC")
    assertStringIncludes(result.answer, "Fastest responders")
    assertEquals(/Top Priority/i.test(result.answer), false)
    assertEquals(/needs your attention first/i.test(result.answer), false)
  } finally {
    if (prev != null) Deno.env.set("OPENAI_API_KEY", prev)
  }
})
