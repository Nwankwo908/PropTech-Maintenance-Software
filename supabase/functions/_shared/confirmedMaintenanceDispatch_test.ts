/// <reference lib="deno.ns" />
import {
  confirmedTicketNeedsNearbySearch,
  isCompleteConfirmedDispatch,
} from "./confirmedMaintenanceDispatch.ts"

function assertEqual(actual: unknown, expected: unknown, label: string) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
}

Deno.test("nearby search runs when confirmed ticket has no preferred vendor", () => {
  assertEqual(
    confirmedTicketNeedsNearbySearch({ assigned: false, vendorId: null, skipReason: "no_vendor" }),
    true,
    "no_vendor",
  )
  assertEqual(
    confirmedTicketNeedsNearbySearch({
      assigned: false,
      vendorId: null,
      skipReason: "ai_dispatch_disabled",
    }),
    true,
    "ai dispatch off still needs nearby",
  )
  assertEqual(
    confirmedTicketNeedsNearbySearch({ assigned: false, vendorId: null, skipReason: "assign_failed" }),
    true,
    "assign failed",
  )
  assertEqual(
    confirmedTicketNeedsNearbySearch({ assigned: false, vendorId: null }),
    true,
    "no skip reason",
  )
})

Deno.test("leftover flags do not block nearby search by themselves", () => {
  assertEqual(
    confirmedTicketNeedsNearbySearch({ assigned: false, vendorId: null, skipReason: "no_vendor" }),
    true,
    "no_vendor after confirm",
  )
  assertEqual(
    confirmedTicketNeedsNearbySearch({ assigned: false, vendorId: null }),
    true,
    "missing skipReason still searches",
  )
  assertEqual(
    confirmedTicketNeedsNearbySearch({
      assigned: false,
      vendorId: null,
      skipReason: "ticket_missing",
    }),
    false,
    "missing ticket is an error, not a nearby search",
  )
})

Deno.test("preferred selection or assignment skips nearby search", () => {
  assertEqual(
    confirmedTicketNeedsNearbySearch({
      assigned: true,
      vendorId: "vendor-1",
    }),
    false,
    "assigned",
  )
  assertEqual(
    confirmedTicketNeedsNearbySearch({
      assigned: false,
      vendorId: null,
      skipReason: "awaiting_landlord_choice",
    }),
    false,
    "preferred choice underway",
  )
})

Deno.test("every confirmed outcome is complete except dispatch_error", () => {
  assertEqual(isCompleteConfirmedDispatch("vendor_assigned"), true, "assigned")
  assertEqual(isCompleteConfirmedDispatch("preferred_selection_underway"), true, "preferred")
  assertEqual(isCompleteConfirmedDispatch("nearby_options_sent"), true, "nearby")
  assertEqual(isCompleteConfirmedDispatch("landlord_manual"), true, "manual")
  assertEqual(isCompleteConfirmedDispatch("dispatch_error"), false, "error")
})
