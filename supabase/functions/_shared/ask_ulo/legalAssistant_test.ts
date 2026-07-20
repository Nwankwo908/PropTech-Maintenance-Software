/// <reference lib="deno.ns" />
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import { applyAskUloAgentModeBias } from "./agentMode.ts"
import { detectLegalSensitiveTopics } from "./legalSensitiveTopics.ts"

Deno.test("detectLegalSensitiveTopics: fair housing + eviction", () => {
  const topics = detectLegalSensitiveTopics(
    "Can I evict for fair housing complaints after a disability accommodation request?",
  )
  const ids = topics.map((t) => t.id).sort()
  assertEquals(ids.includes("eviction"), true)
  assertEquals(ids.includes("fair_housing"), true)
  assertEquals(ids.includes("disability_accommodation"), true)
})

Deno.test("detectLegalSensitiveTopics: screening + denial", () => {
  const topics = detectLegalSensitiveTopics(
    "What do I need before denying a rental application after a background check?",
  )
  const ids = topics.map((t) => t.id)
  assertEquals(ids.includes("tenant_screening"), true)
  assertEquals(ids.includes("application_denial"), true)
})

Deno.test("detectLegalSensitiveTopics: domestic violence + retaliation + mold", () => {
  const topics = detectLegalSensitiveTopics(
    "Tenant claims retaliation after reporting mold and asking about domestic violence lease early termination.",
  )
  const ids = topics.map((t) => t.id)
  assertEquals(ids.includes("domestic_violence"), true)
  assertEquals(ids.includes("retaliation"), true)
  assertEquals(ids.includes("lead_environmental"), true)
})

Deno.test("detectLegalSensitiveTopics: lockout / shutoff", () => {
  const topics = detectLegalSensitiveTopics(
    "Can I change the locks or shut off the water if rent is late?",
  )
  assertEquals(topics.some((t) => t.id === "illegal_self_help"), true)
})

Deno.test("applyAskUloAgentModeBias: legal_insights forces legal on general", () => {
  const biased = applyAskUloAgentModeBias(
    { intent: "general", confidence: "low", label: "General" },
    "legal_insights",
  )
  assertEquals(biased.intent, "legal")
})

Deno.test("applyAskUloAgentModeBias: keeps high-confidence market analysis", () => {
  const biased = applyAskUloAgentModeBias(
    { intent: "market_analysis", confidence: "high", label: "Market Analysis" },
    "legal_insights",
  )
  assertEquals(biased.intent, "market_analysis")
})
