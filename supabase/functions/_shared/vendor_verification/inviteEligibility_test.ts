import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import { vendorInviteBlockReason } from "./inviteEligibility.ts"

Deno.test("inviteEligibility: active roster may be invited", () => {
  assertEquals(
    vendorInviteBlockReason({ vendorActive: true, availability: "active" }),
    null,
  )
})

Deno.test("inviteEligibility: blocks inactive, paused, suspended, banned", () => {
  assertEquals(
    vendorInviteBlockReason({ vendorActive: false })?.includes("inactive"),
    true,
  )
  assertEquals(
    vendorInviteBlockReason({ availability: "paused" })?.includes("paused"),
    true,
  )
  assertEquals(
    vendorInviteBlockReason({ rosterStatus: "suspended" })?.includes("suspended"),
    true,
  )
  assertEquals(
    vendorInviteBlockReason({ rosterStatus: "banned" })?.includes("banned"),
    true,
  )
})
