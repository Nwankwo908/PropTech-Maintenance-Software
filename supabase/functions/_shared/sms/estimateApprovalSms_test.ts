/// <reference lib="deno.ns" />
import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts"
import { buildLandlordEstimateApprovalSms } from "./estimateApprovalSms.ts"
import { landlordAskSummaryLine } from "./landlordAskSms.ts"

Deno.test("landlord ask summary omits bare unit-only location", () => {
  assertEquals(landlordAskSummaryLine({ locationLabel: "1" }), "")
  assertEquals(landlordAskSummaryLine({ unit: "1" }), "")
  assertEquals(
    landlordAskSummaryLine({
      locationLabel: "14 Maple Ave",
      issueHeadline: "leak",
    }),
    "14 Maple Ave · leak",
  )
})

Deno.test("landlord estimate SMS asks for APPROVE or DECLINE", () => {
  const body = buildLandlordEstimateApprovalSms({
    vendorName: "Flex Plumbing",
    workOrderRef: "WO-F23A",
    unit: "Unit 2",
    locationLabel: "14 Maple Ave · Unit 2",
    issueHeadline: "kitchen faucet",
    totalCost: 450,
    partsCost: 200,
    laborCost: 250,
    approveUrl: "https://example.com/approve",
    rejectUrl: "https://example.com/decline",
    landlordFirstName: "Maya",
  })
  assertStringIncludes(body, "Hi Maya — estimate needs approval")
  assertStringIncludes(body, "14 Maple Ave · Unit 2 · kitchen faucet")
  assertStringIncludes(body, "Flex Plumbing submitted an estimate of $450.00")
  assertStringIncludes(body, "Ref: WO-F23A")
  assertStringIncludes(body, "Reply APPROVE to let them continue with the repair")
  assertStringIncludes(body, "if you have more than one pending, include the address")
  assertStringIncludes(body, "DECLINE if you need a revised estimate")
  assertStringIncludes(body, "Or tap Approve: https://example.com/approve")
  assertStringIncludes(body, "Decline: https://example.com/decline")
})
