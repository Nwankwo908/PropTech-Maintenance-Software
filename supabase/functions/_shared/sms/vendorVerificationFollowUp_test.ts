/// <reference lib="deno.ns" />
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import { buildVendorVerificationReceivedSms } from "./vendorVerificationFollowUpCopy.ts"

Deno.test("verification submit SMS acknowledges receipt only", () => {
  const body = buildVendorVerificationReceivedSms({
    vendorLabel: "Flex Plumbing",
    companyName: "Acme Properties",
  })
  assertEquals(body.includes("We received your verification form. Thank you."), true)
  assertEquals(/approved|incomplete|under review|still need attention/i.test(body), false)
  assertEquals(/eligible to receive work orders/i.test(body), false)
})
