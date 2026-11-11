import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import { shouldReuseIntakeDraft } from "./intakeDraftClaim.ts"

Deno.test("the same open intake is reused", () => {
  assertEquals(
    shouldReuseIntakeDraft({
      separateRequest: false,
      existingCategory: "plumbing",
      incomingCategory: "plumbing",
    }),
    true,
  )
})

Deno.test("a different trade is a new work order", () => {
  assertEquals(
    shouldReuseIntakeDraft({
      separateRequest: false,
      existingCategory: "plumbing",
      incomingCategory: "hvac",
    }),
    false,
  )
})

Deno.test("an explicit new request is not folded into the draft", () => {
  assertEquals(
    shouldReuseIntakeDraft({
      separateRequest: true,
      existingCategory: "plumbing",
      incomingCategory: "plumbing",
    }),
    false,
  )
})

Deno.test("a follow-up with no trade yet stays on the draft", () => {
  assertEquals(
    shouldReuseIntakeDraft({
      separateRequest: false,
      existingCategory: "plumbing",
      incomingCategory: null,
    }),
    true,
  )
})
