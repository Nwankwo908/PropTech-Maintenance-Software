/// <reference lib="deno.ns" />
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  buildEstimateDecisionClarifySms,
  parseEstimateDecisionKeyword,
} from "./estimateDecisionInbound.ts"
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

Deno.test(
  "parseEstimateDecisionKeyword accepts single-character-transposition typos",
  () => {
    // Semantic allowlist already covers APPROVED / YES APPROVE; these prove
    // literal misspellings of APPROVE/DECLINE themselves are also accepted.
    assertEquals(parseEstimateDecisionKeyword("Aprrove"), "approve")
    assertEquals(parseEstimateDecisionKeyword("Apporve"), "approve")
    assertEquals(parseEstimateDecisionKeyword("Declien"), "reject")
    assertEquals(parseEstimateDecisionKeyword("Decilne"), "reject")
  },
)

Deno.test("parseEstimateDecisionKeyword ignores unrelated text", () => {
  assertEquals(parseEstimateDecisionKeyword("yes"), null)
  assertEquals(parseEstimateDecisionKeyword("on my way"), null)
  assertEquals(parseEstimateDecisionKeyword("blue elephant"), null)
  assertEquals(parseEstimateDecisionKeyword(""), null)
})

Deno.test("buildEstimateDecisionClarifySms references amount and work order", () => {
  const body = buildEstimateDecisionClarifySms({
    totalCost: 942,
    workOrderRef: "WO-B347",
  })
  assertEquals(body.includes("$942.00"), true)
  assertEquals(body.includes("WO-B347"), true)
  assertEquals(body.includes("APPROVE or DECLINE"), true)
  assertEquals(body.includes("How can we help with your maintenance"), false)
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
