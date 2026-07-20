/// <reference lib="deno.ns" />
import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts"
import { classifyAskUloIntent } from "./intent.ts"
import { classifyInvestigationPlaybook } from "./investigationPlaybooks.ts"
import { requiresDeepOperationalInvestigation } from "./deepOperationalInvestigation.ts"
import {
  detectVendorMetric,
  isAnyVendorMetricQuestion,
} from "./questionMetricContext.ts"
import {
  detectQuestionSubject,
  evaluateSubjectMatchQc,
  hasSubjectMismatch,
  isVendorFocusedQuestion,
  isVendorInactivityQuestion,
  looksLikePortfolioBriefingAnswer,
} from "./questionSubjectMatch.ts"
import { classifyTaskContract } from "./taskCompletion.ts"
import { synthesizeAskUloAnswer } from "./synthesize.ts"

const INACTIVE_Q = "Show vendors that haven't accepted jobs recently."

Deno.test("haven't accepted routes to vendor_inactive — not portfolio briefing", () => {
  assertEquals(isVendorInactivityQuestion(INACTIVE_Q), true)
  assertEquals(isVendorFocusedQuestion(INACTIVE_Q), true)
  assertEquals(isAnyVendorMetricQuestion(INACTIVE_Q), true)
  assertEquals(detectVendorMetric(INACTIVE_Q), "inactivity")
  assertEquals(detectQuestionSubject(INACTIVE_Q), "vendor")
  assertEquals(classifyInvestigationPlaybook(INACTIVE_Q).id, "vendor_inactive")
  assertEquals(classifyAskUloIntent(INACTIVE_Q).intent, "vendor")
  assertEquals(requiresDeepOperationalInvestigation(INACTIVE_Q), false)
  assertStringIncludes(classifyTaskContract(INACTIVE_Q).expectedOutput, "pending accepts")
})

Deno.test("subject match fails inactivity question answered as portfolio briefing", () => {
  const bad = [
    "**Portfolio briefing packet**",
    "",
    "Assessment: Stable · Health score 70/100",
    "",
    "### Health components",
    "PM compliance and vendor performance defaulted to neutral (no signal).",
    "",
    "Occupancy 0% · 25 open work orders.",
  ].join("\n")
  assertEquals(looksLikePortfolioBriefingAnswer(bad), true)
  assertEquals(hasSubjectMismatch(INACTIVE_Q, bad), true)
  assertEquals(evaluateSubjectMatchQc({ question: INACTIVE_Q, answer: bad }).status, "fail")
})

Deno.test("synthesize prefers vendorInactive over portfolio briefing", async () => {
  const prev = Deno.env.get("OPENAI_API_KEY")
  Deno.env.delete("OPENAI_API_KEY")
  try {
    const inactiveMd = [
      "The biggest follow-up today is **Acme Plumbing**. They still haven't responded to **2** recently assigned jobs — that could delay getting those repairs started.",
      "",
      "### Vendors to chase",
      "1. **Acme Plumbing** — 2 jobs still waiting for a response (assigned today).",
    ].join("\n")
    const result = await synthesizeAskUloAnswer({
      question: INACTIVE_Q,
      history: [],
      intent: "vendor",
      intentLabel: "Vendor",
      reasoningMode: "factual",
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
      portfolioBriefing: {
        available: true,
        assessment: "stable",
        healthScore: 70,
        healthDelta4w: 0,
        facts: {},
        bullets: ["Health 70/100"],
        citations: [],
        markdown:
          "**Portfolio briefing packet**\n\nAssessment: Stable · Health score 70/100\n\nOccupancy 0%.",
      },
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
      vendorCompletion: null,
      vendorInactive: {
        available: true,
        found: true,
        bullets: ["Acme Plumbing: 2 jobs waiting for the vendor to accept"],
        citations: [],
        markdown: inactiveMd,
        ranked: [
          {
            vendorId: "v1",
            name: "Acme Plumbing",
            pendingAcceptJobs: 2,
            acceptedJobs: 0,
            lastAssignedAt: null,
            daysSinceAssigned: null,
            reason: "2 jobs waiting for the vendor to accept",
          },
        ],
      },
      propertyRanking: null,
      investigationPlaybook: {
        id: "vendor_inactive",
        preferTier1Answer: false,
        consultTier1First: false,
        deepOpsPrimary: false,
      },
      toolsUsed: ["vendor_inactive"],
    })
    assertStringIncludes(result.answer, "Acme Plumbing")
    assertStringIncludes(result.answer.toLowerCase(), "follow-up")
    assertEquals(/Portfolio briefing/i.test(result.answer), false)
    assertEquals(/Health score/i.test(result.answer), false)
    assertEquals(/\bI'?m listing\b/i.test(result.answer), false)
  } finally {
    if (prev != null) Deno.env.set("OPENAI_API_KEY", prev)
  }
})
