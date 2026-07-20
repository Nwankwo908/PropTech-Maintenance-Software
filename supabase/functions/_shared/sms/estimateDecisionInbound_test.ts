/// <reference lib="deno.ns" />
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import { parseEstimateDecisionKeyword } from "./estimateDecisionInbound.ts"
import {
  buildMaintenanceEstimateSubmittedInboxBody,
  isMaintenanceEstimateSubmittedBody,
} from "./maintenanceEstimateInbox.ts"

Deno.test("parseEstimateDecisionKeyword recognizes approve variants", () => {
  assertEquals(parseEstimateDecisionKeyword("APPROVE"), "approve")
  assertEquals(parseEstimateDecisionKeyword("approve!"), "approve")
  assertEquals(parseEstimateDecisionKeyword("Yes Approve"), "approve")
  assertEquals(parseEstimateDecisionKeyword("APPROVE ESTIMATE"), "approve")
})

Deno.test("parseEstimateDecisionKeyword recognizes decline variants", () => {
  assertEquals(parseEstimateDecisionKeyword("DECLINE"), "reject")
  assertEquals(parseEstimateDecisionKeyword("reject"), "reject")
  assertEquals(parseEstimateDecisionKeyword("DECLINED."), "reject")
})

Deno.test("parseEstimateDecisionKeyword ignores unrelated text", () => {
  assertEquals(parseEstimateDecisionKeyword("yes"), null)
  assertEquals(parseEstimateDecisionKeyword("on my way"), null)
  assertEquals(parseEstimateDecisionKeyword(""), null)
})

Deno.test("estimate inbox body is detectable for admin monitoring", () => {
  const body = buildMaintenanceEstimateSubmittedInboxBody({
    workOrderRef: "WO-F23A",
    unit: "2B",
    partsCost: 100,
    laborCost: 350,
    totalCost: 450,
    notes: "Extra parts needed",
  })
  assertEquals(isMaintenanceEstimateSubmittedBody(body), true)
  assertEquals(body.includes("Waiting for your approval."), true)
  assertEquals(body.includes("$450.00"), true)
})
