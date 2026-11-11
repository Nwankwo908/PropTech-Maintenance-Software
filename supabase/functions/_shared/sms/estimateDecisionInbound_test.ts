import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import { bareEstimateApproval } from "./estimateApprovalGuard.ts"

Deno.test("APPROVE with an open ask can apply", () => {
  assertEquals(
    bareEstimateApproval({ hasActiveAsk: true, pendingCount: 1 }),
    "apply",
  )
})

Deno.test("a lone pending estimate is not approved without an ask", () => {
  assertEquals(
    bareEstimateApproval({ hasActiveAsk: false, pendingCount: 1 }),
    "refuse",
  )
})

Deno.test("several pending estimates are listed, not chosen", () => {
  assertEquals(
    bareEstimateApproval({ hasActiveAsk: false, pendingCount: 2 }),
    "disambiguate",
  )
  assertEquals(
    bareEstimateApproval({ hasActiveAsk: true, pendingCount: 3 }),
    "disambiguate",
  )
})
