/// <reference lib="deno.ns" />
import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts"
import { detectAskUloActionBoundary } from "../../guards/actionBoundary.ts"
import { detectAskUloCapability } from "../../routing/capability.ts"
import { resolveCapabilityRoute } from "../../routing/capabilityRoute.ts"
import { detectQuestionSubject } from "../../routing/detectSubject.ts"
import { planEvidenceForQuestion } from "../../guards/evidenceGuard.ts"
import {
  detectDraftCommunicationKind,
  draftCommunication,
  isDraftCommunicationQuestion,
} from "../../tools/maintenance/draftCommunication.ts"

Deno.test("detects draft water shutoff notice question", () => {
  const q = "Draft a notice for water shutoff tomorrow"
  assertEquals(isDraftCommunicationQuestion(q), true)
  assertEquals(detectDraftCommunicationKind(q), "water_shutoff_notice")
})

Deno.test("capability draft + route → draft_communication", () => {
  const q = "Draft a notice for water shutoff tomorrow"
  const subject = detectQuestionSubject(q)
  const cap = detectAskUloCapability(q, subject)
  assertEquals(cap.capability, "draft")
  const route = resolveCapabilityRoute({ subject, capability: cap.capability })
  assertEquals(route.requiredTools.includes("draft_communication"), true)
})

Deno.test("draft tool returns notice template, not work-order gap", () => {
  const result = draftCommunication({
    question: "Draft a notice for water shutoff tomorrow",
  })
  assertEquals(result.tool, "draft_communication")
  assertStringIncludes(result.markdown, "NOTICE OF TEMPORARY WATER SHUTOFF")
  assertEquals(/\bspecifically about other\b/i.test(result.markdown), false)
})

Deno.test("draft shutoff notice is not blocked by action boundary", () => {
  const b = detectAskUloActionBoundary("Draft a notice for water shutoff tomorrow")
  assertEquals(b.blocked, false)
})

Deno.test("actually shutting off water remains blocked", () => {
  const b = detectAskUloActionBoundary("Shut off the water for the delinquent tenant")
  assertEquals(b.blocked, true)
})

Deno.test("draft notice forbids portfolio briefing", () => {
  const plan = planEvidenceForQuestion("Draft a notice for water shutoff tomorrow")
  assertEquals(plan.allowPortfolioBriefing, false)
})
