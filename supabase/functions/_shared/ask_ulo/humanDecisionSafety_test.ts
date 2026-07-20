/// <reference lib="deno.ns" />
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import { detectHumanDecisionSafety } from "./humanDecisionSafety.ts"

Deno.test("humanDecision: grant ESA → refuse", () => {
  const s = detectHumanDecisionSafety(
    "Should I grant this emotional support animal request?",
  )
  assertEquals(s.refuseDecision, true)
  assertEquals(
    s.flags.some((f) => f.id === "disability_accommodation_decision"),
    true,
  )
})

Deno.test("humanDecision: explain accommodation rules → allow", () => {
  const s = detectHumanDecisionSafety(
    "What does the Fair Housing Act say about reasonable accommodations?",
  )
  assertEquals(s.refuseDecision, false)
})

Deno.test("humanDecision: eviction strategy → refuse", () => {
  const s = detectHumanDecisionSafety("What's the best legal strategy to evict this tenant?")
  assertEquals(s.refuseDecision, true)
  assertEquals(
    s.flags.some((f) => f.id === "eviction_strategy_decision"),
    true,
  )
})

Deno.test("humanDecision: retaliatory raise → refuse", () => {
  const s = detectHumanDecisionSafety(
    "Should I raise rent because the tenant complained to code enforcement?",
  )
  assertEquals(s.refuseDecision, true)
})
