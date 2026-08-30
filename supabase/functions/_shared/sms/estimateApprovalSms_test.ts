/// <reference lib="deno.ns" />
import { assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts"
import { buildLandlordEstimateApprovalSms } from "./estimateApprovalSms.ts"

Deno.test("landlord estimate SMS asks for APPROVE or DECLINE", () => {
  const body = buildLandlordEstimateApprovalSms({
    vendorName: "Flex Plumbing",
    workOrderRef: "WO-F23A",
    unit: "Unit 2",
    totalCost: 450,
    partsCost: 200,
    laborCost: 250,
    approveUrl: "https://example.com/approve",
    rejectUrl: "https://example.com/decline",
    landlordFirstName: "Maya",
  })
  assertStringIncludes(body, "Hi Maya,")
  assertStringIncludes(body, "This is Ulo.")
  assertStringIncludes(body, "Flex Plumbing submitted an estimate of $450.00")
  assertStringIncludes(body, "work order WO-F23A (Unit 2)")
  assertStringIncludes(body, "Reply APPROVE to let them continue with the repair")
  assertStringIncludes(body, "DECLINE if you need a revised estimate")
  assertStringIncludes(body, "Or tap Approve: https://example.com/approve")
  assertStringIncludes(body, "Decline: https://example.com/decline")
})
