/// <reference lib="deno.ns" />
import { assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts"
import { buildVendorOnboardingOverrideActivatedSms } from "./vendorOnboardingOverrideSmsCopy.ts"

Deno.test("override activation SMS is plain language and names the team", () => {
  const body = buildVendorOnboardingOverrideActivatedSms({
    vendorLabel: "Flex Plumbing",
    companyName: "Harbor Homes",
  })
  assertStringIncludes(body, "Hi Flex Plumbing,")
  assertStringIncludes(body, "property management team at Harbor Homes")
  assertStringIncludes(body, "Your vendor profile is now active")
  assertStringIncludes(body, "eligible to receive work orders")
})
