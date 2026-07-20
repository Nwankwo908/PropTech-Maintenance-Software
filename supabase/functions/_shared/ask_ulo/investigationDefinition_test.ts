/// <reference lib="deno.ns" />
import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts"
import { classifyAskUloReasoningMode, isNarrowFactualOpsQuestion } from "./reasoningMode.ts"
import { classifyTaskContract } from "./taskCompletion.ts"
import {
  INVESTIGATION_DEFINITION_GUIDE,
  classifyInvestigation,
  evaluateInvestigationDefinitionQc,
  looksLikeSingleMetricInvestigationFailure,
  requiresInvestigation,
} from "./investigationDefinition.ts"

Deno.test("investigation definition guide covers contract", () => {
  assertStringIncludes(INVESTIGATION_DEFINITION_GUIDE, "Definition of Investigation")
  assertStringIncludes(INVESTIGATION_DEFINITION_GUIDE, "single dashboard metric")
  assertStringIncludes(INVESTIGATION_DEFINITION_GUIDE, "Incomplete tasks")
  assertStringIncludes(INVESTIGATION_DEFINITION_GUIDE, "must never be shown")
})

Deno.test("investigation triggers fire for Why/Which/What should/…", () => {
  const cases = [
    "Why hasn't Unit 304's plumbing issue been resolved?",
    "Which property needs attention first?",
    "What should I prioritize this week?",
    "What's causing the maintenance backlog?",
    "What's becoming a risk at Maple Heights?",
    "What's changing in my portfolio?",
    "What concerns should I watch?",
    "What am I missing?",
    "How can I improve vendor response times?",
  ]
  for (const q of cases) {
    assertEquals(requiresInvestigation(q), true, q)
    assertEquals(classifyInvestigation(q).forbidsSingleMetric, true, q)
  }
})

Deno.test("factual counts do not require investigation", () => {
  assertEquals(requiresInvestigation("How many open work orders do I have?"), false)
  assertEquals(isNarrowFactualOpsQuestion("How many open work orders do I have?"), true)
})

Deno.test("investigation questions are not narrow factual", () => {
  assertEquals(
    isNarrowFactualOpsQuestion("Why are escalations rising?"),
    false,
  )
  assertEquals(
    isNarrowFactualOpsQuestion("What am I missing?"),
    false,
  )
})

Deno.test("investigation why → diagnosis reasoning mode", () => {
  const r = classifyAskUloReasoningMode("Why are escalations rising?")
  assertEquals(r.mode, "diagnosis")
})

Deno.test("task contract rejects KPIs for investigation triggers", () => {
  const c = classifyTaskContract("What's causing delays in vendor acceptance?")
  assertEquals(c.rejectsGenericKpis, true)
})

Deno.test("single-metric answers fail investigation QC", () => {
  assertEquals(
    looksLikeSingleMetricInvestigationFailure(
      "You currently have 25 open work orders across the portfolio.",
    ),
    true,
  )
  const qc = evaluateInvestigationDefinitionQc({
    question: "What's causing the maintenance backlog?",
    answer: "## Quick Answer\nYou currently have 25 open work orders.",
  })
  assertEquals(qc.status, "fail")
})

Deno.test("evidence-backed investigation answer passes QC", () => {
  const qc = evaluateInvestigationDefinitionQc({
    question: "What's causing the maintenance backlog?",
    answer:
      "The backlog is driven by vendors who haven't accepted assignments — three plumbing tickets alone have been waiting over two weeks. This matters because water risk compounds fast. I'd follow up with ABC Plumbing today and reassign anything they won't commit to.",
  })
  assertEquals(qc.status, "pass")
})

Deno.test("missing-evidence honesty passes QC", () => {
  const qc = evaluateInvestigationDefinitionQc({
    question: "What am I missing?",
    answer:
      "I can't finish a full 30-day risk map yet.\n\n**What I know**\nI can see open maintenance and high-level portfolio activity.\n\n**What's missing**\nI don't have upcoming lease end dates or vendor COI expirations.\n\n**What happens next**\nOnce those are available, I'll flag the deadlines that matter most and what I'd watch first.",
  })
  assertEquals(qc.status, "pass")
})
