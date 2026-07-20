/// <reference lib="deno.ns" />
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import { redactPiiForExternalAi } from "./privacyRedact.ts"

Deno.test("redactPii: email and phone", () => {
  const r = redactPiiForExternalAi(
    "Call Jane at 503-555-0199 or jane.doe@example.com about the unit.",
  )
  assertEquals(r.redacted, true)
  assertEquals(r.text.includes("503-555-0199"), false)
  assertEquals(r.text.includes("jane.doe@example.com"), false)
  assertEquals(r.text.includes("[REDACTED_PHONE]"), true)
  assertEquals(r.text.includes("[REDACTED_EMAIL]"), true)
})

Deno.test("redactPii: SSN and credit score", () => {
  const r = redactPiiForExternalAi("SSN 123-45-6789 and credit score is 720")
  assertEquals(r.categories.includes("ssn"), true)
  assertEquals(r.categories.includes("screening_score"), true)
  assertEquals(r.text.includes("123-45-6789"), false)
})

Deno.test("redactPii: plain legal question untouched", () => {
  const r = redactPiiForExternalAi("How much notice before entry in Oregon?")
  assertEquals(r.redacted, false)
})
