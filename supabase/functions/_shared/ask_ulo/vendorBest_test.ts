/// <reference lib="deno.ns" />
import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts"
import { classifyAskUloIntent } from "./intent.ts"
import { classifyInvestigationPlaybook } from "./investigationPlaybooks.ts"
import { requiresDeepOperationalInvestigation } from "./deepOperationalInvestigation.ts"
import {
  detectVendorMetric,
  evaluateMetricMatchQc,
  isAnyVendorMetricQuestion,
  isVendorBestQuestion,
  isVendorRecommendQuestion,
  looksLikeResponseSpeedForBestAnswer,
} from "./questionMetricContext.ts"
import {
  detectQuestionSubject,
  evaluateSubjectMatchQc,
  hasSubjectMismatch,
  isVendorResponseSpeedQuestion,
} from "./questionSubjectMatch.ts"
import { classifyTaskContract } from "./taskCompletion.ts"
import { synthesizeAskUloAnswer } from "./synthesize.ts"

Deno.test("recommend another plumber routes to vendor_best — not generic gap", () => {
  const q = "Recommend another plumber."
  assertEquals(isVendorRecommendQuestion(q), true)
  assertEquals(isVendorBestQuestion(q), true)
  assertEquals(isAnyVendorMetricQuestion(q), true)
  assertEquals(detectQuestionSubject(q), "vendor")
  assertEquals(classifyInvestigationPlaybook(q).id, "vendor_best")
  assertEquals(classifyAskUloIntent(q).intent, "vendor")
  assertEquals(requiresDeepOperationalInvestigation(q), false)
})

Deno.test("best electrician is overall quality — not response speed", () => {
  const q = "Who is my best electrician?"
  assertEquals(isVendorBestQuestion(q), true)
  assertEquals(isVendorResponseSpeedQuestion(q), false)
  assertEquals(detectVendorMetric(q), "overall_quality")
  assertEquals(detectQuestionSubject(q), "vendor")
  assertEquals(classifyInvestigationPlaybook(q).id, "vendor_best")
  assertEquals(classifyAskUloIntent(q).intent, "vendor")
  assertEquals(requiresDeepOperationalInvestigation(q), false)
  assertStringIncludes(classifyTaskContract(q).expectedOutput, "overall vendor score")
})

Deno.test("fastest vendors still map to vendor_speed, not vendor_best", () => {
  const q = "Which vendors respond the fastest?"
  assertEquals(isVendorBestQuestion(q), false)
  assertEquals(isVendorResponseSpeedQuestion(q), true)
  assertEquals(detectVendorMetric(q), "response_speed")
  assertEquals(classifyInvestigationPlaybook(q).id, "vendor_speed")
})

Deno.test("metric match fails when best is answered as timed responses", () => {
  const q = "Who is my best electrician?"
  const bad = [
    "I don't have enough timed vendor responses yet to say who responds the fastest.",
    "",
    "### What's missing",
    "Accept / decline timings after vendors are notified on jobs.",
  ].join("\n")
  assertEquals(looksLikeResponseSpeedForBestAnswer(q, bad), true)
  assertEquals(hasSubjectMismatch(q, bad), true)
  assertEquals(evaluateSubjectMatchQc({ question: q, answer: bad }).status, "fail")
  assertEquals(
    evaluateMetricMatchQc({ question: q, answer: bad, packetSatisfied: false }).status,
    "fail",
  )
})

Deno.test("metric match passes when best answer uses overall vendor score", () => {
  const q = "Who is my best electrician?"
  const good =
    "**Sparky Electric** is your best electrician right now — score **4.6/5**. " +
    "I'm ranking by overall vendor score (resident satisfaction, completion, response speed, and rework)."
  assertEquals(looksLikeResponseSpeedForBestAnswer(q, good), false)
  assertEquals(
    evaluateMetricMatchQc({ question: q, answer: good, packetSatisfied: false }).status,
    "pass",
  )
})

Deno.test("synthesize prefers vendorBest over response-speed for best electrician", async () => {
  const prev = Deno.env.get("OPENAI_API_KEY")
  Deno.env.delete("OPENAI_API_KEY")
  try {
    const bestMd = [
      "**Sparky Electric** is your best electrician right now — score **4.6/5**.",
      "",
      "I'm ranking by **overall vendor score** — not response speed alone.",
    ].join("\n")
    const speedMd = [
      "I don't have enough timed vendor responses yet to say who responds the fastest.",
      "",
      "### What's missing",
      "Accept / decline timings after vendors are notified on jobs.",
    ].join("\n")
    const result = await synthesizeAskUloAnswer({
      question: "Who is my best electrician?",
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
        found: false,
        bullets: [],
        citations: [],
        markdown: speedMd,
        ranked: [],
      },
      vendorBest: {
        available: true,
        found: true,
        tradeSlug: "electrical",
        tradeLabel: "electrician",
        bullets: ["Sparky Electric: score 4.6/5"],
        citations: [],
        markdown: bestMd,
        ranked: [
          {
            vendorId: "v1",
            name: "Sparky Electric",
            category: "electrical",
            vendorScore: 4.6,
            residentSatisfaction: 4.8,
            reviewCount: 6,
            completedJobs: 14,
            acceptedJobs: 16,
            avgResponseMinutes: 55,
            completionRate: 0.9,
          },
        ],
      },
      propertyRanking: null,
      investigationPlaybook: {
        id: "vendor_best",
        preferTier1Answer: false,
        consultTier1First: false,
        deepOpsPrimary: false,
      },
      toolsUsed: ["vendor_best"],
    })
    assertStringIncludes(result.answer, "Sparky Electric")
    assertStringIncludes(result.answer, "overall vendor score")
    assertEquals(/timed vendor responses/i.test(result.answer), false)
    assertEquals(/responds the fastest/i.test(result.answer), false)
  } finally {
    if (prev != null) Deno.env.set("OPENAI_API_KEY", prev)
  }
})
