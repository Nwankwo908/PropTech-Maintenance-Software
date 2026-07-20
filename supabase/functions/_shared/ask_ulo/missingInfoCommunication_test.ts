/// <reference lib="deno.ns" />
import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  MISSING_INFO_COMMUNICATION_GUIDE,
  evaluateMissingInfoCommunicationQc,
  formatIncompleteAnswer,
  incompleteMaintenanceRiskAnswer,
  looksLikeAiMechanicsLanguage,
  looksLikeClearMissingInfoExplanation,
} from "./missingInfoCommunication.ts"

Deno.test("missing-info guide covers 3-part model + philosophy", () => {
  assertStringIncludes(MISSING_INFO_COMMUNICATION_GUIDE, "What I know")
  assertStringIncludes(MISSING_INFO_COMMUNICATION_GUIDE, "What's missing")
  assertStringIncludes(MISSING_INFO_COMMUNICATION_GUIDE, "What happens next")
  assertStringIncludes(MISSING_INFO_COMMUNICATION_GUIDE, "Never make the user learn how the AI works")
})

Deno.test("forbids AI mechanics phrases", () => {
  assertEquals(
    looksLikeAiMechanicsLanguage(
      "I don't have enough evidence for an evidence-backed answer.",
    ),
    true,
  )
  assertEquals(
    looksLikeAiMechanicsLanguage(
      "What's missing depends on the question — I'm not going to substitute a nearby dashboard metric.",
    ),
    true,
  )
  assertEquals(
    looksLikeAiMechanicsLanguage(
      "I can't tell which requests are becoming emergencies because I can't see how they've progressed.",
    ),
    false,
  )
})

Deno.test("incomplete maintenance risk uses 3-part landlord language", () => {
  const msg = incompleteMaintenanceRiskAnswer({ openCount: 25 })
  assertStringIncludes(msg, "What I know")
  assertStringIncludes(msg, "25")
  assertStringIncludes(msg, "What's missing")
  assertStringIncludes(msg, "What happens next")
  assertEquals(looksLikeAiMechanicsLanguage(msg), false)
  assertEquals(looksLikeClearMissingInfoExplanation(msg), true)
  const qc = evaluateMissingInfoCommunicationQc({
    question: "Which maintenance requests are becoming emergencies?",
    answer: msg,
  })
  assertEquals(qc.status, "pass")
})

Deno.test("AI-speak draft fails QC", () => {
  const qc = evaluateMissingInfoCommunicationQc({
    question: "Which are becoming emergencies?",
    answer: "I started investigating, but I don't have enough evidence yet for an evidence-backed answer.",
  })
  assertEquals(qc.status, "fail")
})

Deno.test("formatIncompleteAnswer structure", () => {
  const text = formatIncompleteAnswer({
    lead: "I can't fully answer that yet.",
    whatIKnow: "I can see open requests.",
    whatsMissing: "I don't have vendor progress.",
    whatHappensNext: "Once that's available, I'll rank them by risk.",
  })
  assertStringIncludes(text, "**What I know**")
  assertStringIncludes(text, "**What's missing**")
  assertStringIncludes(text, "**What happens next**")
})
