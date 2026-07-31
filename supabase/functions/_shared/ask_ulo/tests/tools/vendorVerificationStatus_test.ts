import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import { classifyInvestigationPlaybook } from "../../routing/investigationPlaybooks.ts"
import { detectVendorMetric, isAnyVendorMetricQuestion } from "../../tools/_shared/questionMetricContext.ts"
import { detectQuestionSubject, isVendorInactivityQuestion } from "../../routing/detectSubject.ts"
import { isVendorVerificationStatusQuestion } from "../../tools/vendors/vendorVerificationStatusLookup.ts"

Deno.test("isVendorVerificationStatusQuestion: universal search prompt", () => {
  assertEquals(
    isVendorVerificationStatusQuestion("Show vendor verification status."),
    true,
  )
})

Deno.test("isVendorVerificationStatusQuestion: verified / pending phrasing", () => {
  assertEquals(isVendorVerificationStatusQuestion("Which vendors are verified?"), true)
  assertEquals(isVendorVerificationStatusQuestion("Which vendors are still pending verification?"), true)
  assertEquals(isVendorVerificationStatusQuestion("Show compliance and verification for my vendors"), true)
})

Deno.test("isVendorVerificationStatusQuestion: does not steal inactivity", () => {
  assertEquals(
    isVendorVerificationStatusQuestion("Show vendors that haven't accepted jobs recently"),
    false,
  )
  assertEquals(
    isVendorInactivityQuestion("Show vendors that haven't accepted jobs recently"),
    true,
  )
  assertEquals(
    isVendorInactivityQuestion("Show vendor verification status"),
    false,
  )
})

Deno.test("classifyInvestigationPlaybook: vendor_verification before vendor_best", () => {
  const pb = classifyInvestigationPlaybook("Show vendor verification status.")
  assertEquals(pb.id, "vendor_verification")
})

Deno.test("detectQuestionSubject + metric: verification", () => {
  const q = "Show vendor verification status"
  assertEquals(detectQuestionSubject(q), "vendor")
  assertEquals(detectVendorMetric(q), "verification")
  assertEquals(isAnyVendorMetricQuestion(q), true)
})
