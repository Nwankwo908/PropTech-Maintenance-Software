import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  canVendorSmsAcceptStatus,
  canVendorSmsDeclineStatus,
  parseVendorSmsReply,
} from "./vendor_workflow.ts"

Deno.test("parseVendorSmsReply treats Yes as accept", () => {
  assertEquals(parseVendorSmsReply("Yes"), "accept")
  assertEquals(parseVendorSmsReply("YES WO-DBF7"), "accept")
})

Deno.test("canVendorSmsAcceptStatus includes assigned-but-unassigned offer rows", () => {
  assertEquals(canVendorSmsAcceptStatus("pending_accept"), true)
  assertEquals(canVendorSmsAcceptStatus("unassigned"), true)
  assertEquals(canVendorSmsAcceptStatus("accepted"), false)
  assertEquals(canVendorSmsAcceptStatus("declined"), false)
})

Deno.test("canVendorSmsDeclineStatus allows unassigned assigned rows", () => {
  assertEquals(canVendorSmsDeclineStatus("unassigned"), true)
  assertEquals(canVendorSmsDeclineStatus("pending_accept"), true)
  assertEquals(canVendorSmsDeclineStatus("completed"), false)
})
