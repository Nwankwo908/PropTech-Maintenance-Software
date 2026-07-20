/// <reference lib="deno.ns" />
import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts"
import { classifyAskUloIntent } from "./intent.ts"
import { classifyInvestigationPlaybook } from "./investigationPlaybooks.ts"
import {
  detectVendorMetric,
  evaluateMetricMatchQc,
  isAnyVendorMetricQuestion,
  isVendorBestQuestion,
  looksLikeBestForOverloadAnswer,
} from "./questionMetricContext.ts"
import {
  detectQuestionSubject,
  isVendorFocusedQuestion,
  isVendorOverloadQuestion,
} from "./questionSubjectMatch.ts"
import { classifyTaskContract } from "./taskCompletion.ts"

const OVERLOAD_Q = "Which vendors are overloaded?"

Deno.test("overloaded vendors route to vendor_overload — not best score", () => {
  assertEquals(isVendorOverloadQuestion(OVERLOAD_Q), true)
  assertEquals(isVendorBestQuestion(OVERLOAD_Q), false)
  assertEquals(isAnyVendorMetricQuestion(OVERLOAD_Q), true)
  assertEquals(isVendorFocusedQuestion(OVERLOAD_Q), true)
  assertEquals(detectQuestionSubject(OVERLOAD_Q), "vendor")
  assertEquals(detectVendorMetric(OVERLOAD_Q), "workload")
  assertEquals(classifyInvestigationPlaybook(OVERLOAD_Q).id, "vendor_overload")
  assertEquals(classifyAskUloIntent(OVERLOAD_Q).intent, "vendor")
  assertStringIncludes(classifyTaskContract(OVERLOAD_Q).expectedOutput, "open assigned jobs")
})

Deno.test("metric match fails when overloaded is answered as best vendor", () => {
  const bad = [
    "**FreshNest Cleaning** is your best vendor right now — score **5/5**; 5/5 resident rating (1); 100% completion · 1 finished.",
    "",
    "Overall vendor score combines satisfaction, completion, response time, and rework — not response speed alone.",
    "",
    "### Top vendors",
    "1. **FreshNest Cleaning** — score **5/5**.",
  ].join("\n")
  assertEquals(looksLikeBestForOverloadAnswer(OVERLOAD_Q, bad), true)
  assertEquals(
    evaluateMetricMatchQc({ question: OVERLOAD_Q, answer: bad, packetSatisfied: false }).status,
    "fail",
  )
})

Deno.test("metric match passes when overload answer uses open jobs", () => {
  const good =
    "**Apex Plumbing Co** looks the most overloaded — **4** open jobs still assigned to them. " +
    "I'm ranking by open assigned jobs (waiting on accept, accepted, or in progress)."
  assertEquals(looksLikeBestForOverloadAnswer(OVERLOAD_Q, good), false)
  assertEquals(
    evaluateMetricMatchQc({ question: OVERLOAD_Q, answer: good, packetSatisfied: true }).status,
    "pass",
  )
})
