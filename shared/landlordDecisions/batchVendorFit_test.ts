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

Deno.test("a generalist is not proposed for a pest ticket", () => {
  const proposal = pickBatchVendorProposal({
    vendorId: "gen-1",
    vendorName: "Handy Mike",
    vendorCategory: "general",
    issueCategory: "pest_control",
    windowLabel: "Wed 9am-12pm",
  })
  assertEquals(proposal.matched, false)
  assertEquals(proposal.vendorName, "needs a vendor")
  assertEquals(proposal.windowLabel, null)
  assertEquals(proposal.vendorId, null)
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

Deno.test("a trade match is rejected when dispatchEligible is false", () => {
  const proposal = pickBatchVendorProposal({
    vendorId: "pest-1",
    vendorName: "Ecosafe Pest Management LLC",
    vendorCategory: "pest_control",
    issueCategory: "pest",
    windowLabel: "Wed AM",
    dispatchEligible: false,
  })
  assertEquals(proposal.matched, false)
  assertEquals(proposal.vendorId, null)
  assertEquals(proposal.vendorName, "needs a vendor")
})
