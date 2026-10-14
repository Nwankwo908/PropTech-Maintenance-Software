import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import { pickBatchVendorProposal } from "./batchVendorFit.ts"

Deno.test("a pest vendor is not proposed for a plumbing ticket", () => {
  const proposal = pickBatchVendorProposal({
    vendorId: "pest-1",
    vendorName: "Dan Conard Pest Control",
    vendorCategory: "Pest Control",
    issueCategory: "plumbing",
    windowLabel: "Wed 9am-12pm",
  })
  assertEquals(proposal.matched, false)
  assertEquals(proposal.vendorName, "needs a vendor")
  assertEquals(proposal.windowLabel, null)
  assertEquals(proposal.vendorId, null)
  assertEquals(proposal.vendorName.includes("Pest"), false)
})

Deno.test("a plumber is proposed for a plumbing ticket", () => {
  const proposal = pickBatchVendorProposal({
    vendorId: "plumb-1",
    vendorName: "ABC Plumbing",
    vendorCategory: "plumbing",
    issueCategory: "plumbing",
    windowLabel: "Tue AM",
  })
  assertEquals(proposal.matched, true)
  assertEquals(proposal.vendorName, "ABC Plumbing")
  assertEquals(proposal.vendorId, "plumb-1")
})
