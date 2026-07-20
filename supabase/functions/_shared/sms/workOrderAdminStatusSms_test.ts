/// <reference lib="deno.ns" />
import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  buildEstimateDecisionStatusSms,
  vendorJobDecisionFromWorkStatus,
} from "./workOrderAdminStatusSms.ts"

Deno.test("vendorJobDecisionFromWorkStatus maps statuses", () => {
  assertEquals(vendorJobDecisionFromWorkStatus("pending_accept"), "pending")
  assertEquals(vendorJobDecisionFromWorkStatus("accepted"), "accepted")
  assertEquals(vendorJobDecisionFromWorkStatus("in_progress"), "accepted")
  assertEquals(vendorJobDecisionFromWorkStatus("declined"), "declined")
  assertEquals(vendorJobDecisionFromWorkStatus(null), "pending")
})

Deno.test("approve SMS for pending vendor keeps asking YES/NO", () => {
  const body = buildEstimateDecisionStatusSms({
    vendorName: "Flex Plumbing",
    workOrderRef: "WO-F23A",
    approved: true,
    totalCost: 450,
    jobLink: "https://www.ulohome.io/w/token",
    vendorDecision: "pending",
  })
  assertEquals(body != null, true)
  assertStringIncludes(body!, "Hi Flex Plumbing,")
  assertStringIncludes(body!, "Update for work order WO-F23A.")
  assertStringIncludes(body!, "approved your estimate of $450.00")
  assertStringIncludes(body!, "Would you like to continue with this job?")
  assertStringIncludes(
    body!,
    "Reply YES to accept the work order or NO if you're unable to take it.",
  )
  assertStringIncludes(body!, "View details:")
  assertStringIncludes(body!, "https://www.ulohome.io/w/token")
})

Deno.test("approve SMS for accepted vendor does not re-ask", () => {
  const body = buildEstimateDecisionStatusSms({
    vendorName: "Flex Plumbing",
    workOrderRef: "WO-F23A",
    approved: true,
    totalCost: 250,
    jobLink: "https://www.ulohome.io/w/token",
    vendorDecision: "accepted",
  })
  assertEquals(body != null, true)
  assertStringIncludes(body!, "You can now continue with the repair.")
  assertEquals(body!.includes("Reply YES"), false)
  assertEquals(body!.includes("Would you like to continue"), false)
})

Deno.test("declined vendor gets no estimate decision SMS", () => {
  const body = buildEstimateDecisionStatusSms({
    vendorName: "Flex Plumbing",
    workOrderRef: "WO-F23A",
    approved: true,
    totalCost: 250,
    vendorDecision: "declined",
  })
  assertEquals(body, null)
})

Deno.test("estimate decline for accepted vendor asks for revised estimate", () => {
  const body = buildEstimateDecisionStatusSms({
    vendorName: "Flex Plumbing",
    workOrderRef: "WO-F23A",
    approved: false,
    totalCost: 450,
    jobLink: "https://www.ulohome.io/w/token",
    vendorDecision: "accepted",
  })
  assertEquals(body != null, true)
  assertStringIncludes(body!, "declined your estimate")
  assertStringIncludes(body!, "revised estimate")
  assertEquals(body!.includes("Reply YES"), false)
})
