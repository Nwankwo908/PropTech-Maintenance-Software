/// <reference lib="deno.ns" />
import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  EVIDENCE_THRESHOLD,
  RESPONSE_SUFFICIENCY_GUIDE,
  classifyEvidenceQuestionKind,
  collectEvidenceHits,
  evaluateResponseSufficiency,
  failsGenericResponseFilter,
  responseSufficiencyPromptBlock,
} from "./responseSufficiency.ts"

Deno.test("response sufficiency guide covers earn-the-right + thresholds", () => {
  assertStringIncludes(RESPONSE_SUFFICIENCY_GUIDE, "earn the right to answer")
  assertStringIncludes(RESPONSE_SUFFICIENCY_GUIDE, "Evidence Threshold")
  assertStringIncludes(RESPONSE_SUFFICIENCY_GUIDE, "Generic Response Filter")
  assertStringIncludes(RESPONSE_SUFFICIENCY_GUIDE, "Understand success")
})

Deno.test("evidence thresholds match contract", () => {
  assertEquals(EVIDENCE_THRESHOLD.factual, 1)
  assertEquals(EVIDENCE_THRESHOLD.comparison, 2)
  assertEquals(EVIDENCE_THRESHOLD.summary, 3)
  assertEquals(EVIDENCE_THRESHOLD.recommendation, 4)
  assertEquals(EVIDENCE_THRESHOLD.prediction, 5)
  assertEquals(EVIDENCE_THRESHOLD.root_cause, 6)
  assertEquals(EVIDENCE_THRESHOLD.risk_assessment, 7)
})

Deno.test("classify evidence kinds", () => {
  assertEquals(
    classifyEvidenceQuestionKind("Which maintenance requests are becoming emergencies?"),
    "risk_assessment",
  )
  assertEquals(classifyEvidenceQuestionKind("Why are escalations rising?"), "root_cause")
  assertEquals(classifyEvidenceQuestionKind("Which property needs attention first?"), "comparison")
  assertEquals(classifyEvidenceQuestionKind("What should I prioritize?"), "recommendation")
  assertEquals(classifyEvidenceQuestionKind("How many open work orders do I have?"), "factual")
})

Deno.test("generic filter fails open-maintenance shell", () => {
  const q = "Which maintenance requests are becoming emergencies?"
  const bad =
    "## Quick Answer\nOpen maintenance tickets: 25\n\nPortfolio health looks stable. No action needed based on available data."
  assertEquals(failsGenericResponseFilter(q, bad), true)
  const qc = evaluateResponseSufficiency({ question: q, answer: bad })
  assertEquals(qc.status, "fail")
})

Deno.test("evidence-backed emergency findings pass sufficiency", () => {
  const q = "Which maintenance requests are becoming emergencies?"
  const good = `
Three work orders are starting to concern me because they've either exceeded their SLA or could cause additional property damage.

1. Unit 204 — Water leak
Open 18 days. Vendor hasn't responded. Risk: water damage spreading. Priority: High.

2. Unit 118 — Electrical outlet sparking
Resident reported the issue twice. Vendor cancelled the appointment. Priority: Critical.

3. Unit 402 — HVAC failure
Forecast shows 97° this weekend and the resident is elderly. Priority: High.

I'd follow up with the unresponsive plumbing vendor today and escalate the electrical ticket.
`.trim()
  const hits = collectEvidenceHits(good)
  assertEquals(hits.length >= 7, true, `expected ≥7 evidence hits, got ${hits.length}: ${hits.join(",")}`)
  const qc = evaluateResponseSufficiency({ question: q, answer: good })
  assertEquals(qc.status, "pass", qc.summary)
  assertEquals(qc.meetsEvidenceThreshold, true)
  assertEquals(qc.genericFilterFailed, false)
})

Deno.test("underspecified risk answer fails evidence threshold", () => {
  const q = "Which maintenance requests are becoming emergencies?"
  const thin =
    "A few tickets look risky based on priority. You should watch open maintenance across the portfolio."
  const qc = evaluateResponseSufficiency({ question: q, answer: thin })
  assertEquals(qc.status, "fail")
})

Deno.test("missing-evidence honesty can pass", () => {
  const q = "What's causing delayed vendor responses?"
  const honest = `
I can't pin down what's causing delayed vendor responses yet.

**What I know**
I can see open maintenance activity and that some tickets are waiting on vendors.

**What's missing**
I don't have vendor reply times or missed-deadline history for each request.

**What happens next**
Once those details are available, I'll explain what's driving the delays and which vendors to follow up with first.
`.trim()
  const qc = evaluateResponseSufficiency({ question: q, answer: honest })
  assertEquals(qc.status, "pass", qc.summary)
})

Deno.test("prompt block includes threshold for risk questions", () => {
  const block = responseSufficiencyPromptBlock(
    "Which maintenance requests are becoming emergencies?",
  )
  assertStringIncludes(block, "evidence_threshold: 7")
  assertStringIncludes(block, "earn the right to answer")
})
