/// <reference lib="deno.ns" />
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import { isTicketAwaitingVendorAssignment } from "./vendorOnboardingOverrideDispatchGate.ts"

Deno.test("unassigned tickets with no vendor are waiting for dispatch", () => {
  assertEquals(
    isTicketAwaitingVendorAssignment({
      assigned_vendor_id: null,
      vendor_work_status: "unassigned",
    }),
    true,
  )
  assertEquals(
    isTicketAwaitingVendorAssignment({
      assigned_vendor_id: "",
      vendor_work_status: "",
    }),
    true,
  )
})

Deno.test("assigned or closed tickets are not waiting for dispatch", () => {
  assertEquals(
    isTicketAwaitingVendorAssignment({
      assigned_vendor_id: "vendor-1",
      vendor_work_status: "unassigned",
    }),
    false,
  )
  assertEquals(
    isTicketAwaitingVendorAssignment({
      assigned_vendor_id: null,
      vendor_work_status: "cancelled",
    }),
    false,
  )
  assertEquals(
    isTicketAwaitingVendorAssignment({
      assigned_vendor_id: null,
      vendor_work_status: "pending_accept",
    }),
    false,
  )
})
