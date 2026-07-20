import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import { detectAskUloActionBoundary } from "./actionBoundary.ts"

Deno.test("blocks send eviction notice for me", () => {
  const b = detectAskUloActionBoundary("Please send the eviction notice to unit 2B for me")
  assertEquals(b.blocked, true)
  assertEquals(b.actions.some((a) => a.id === "eviction_notice"), true)
})

Deno.test("allows explain eviction notice requirements", () => {
  const b = detectAskUloActionBoundary(
    "What notice period do I need for an eviction in Portland?",
  )
  assertEquals(b.blocked, false)
})

Deno.test("blocks reject this applicant now", () => {
  const b = detectAskUloActionBoundary("Reject this applicant now")
  assertEquals(b.blocked, true)
  assertEquals(b.actions.some((a) => a.id === "reject_applicant"), true)
})

Deno.test("allows draft water shutoff notice (writing, not executing)", () => {
  const b = detectAskUloActionBoundary("Draft a notice for water shutoff tomorrow")
  assertEquals(b.blocked, false)
})

Deno.test("blocks shut off utilities", () => {
  const b = detectAskUloActionBoundary("Shut off the water for the delinquent tenant")
  assertEquals(b.blocked, true)
})

Deno.test("allows what rent should I charge", () => {
  const b = detectAskUloActionBoundary("What rent should I charge for Maple Heights?")
  assertEquals(b.blocked, false)
})

Deno.test("blocks change the rent to 2200 for me", () => {
  const b = detectAskUloActionBoundary("Change the rent to 2200 for me automatically")
  assertEquals(b.blocked, true)
})
