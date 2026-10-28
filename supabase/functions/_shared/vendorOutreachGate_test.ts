/// <reference lib="deno.ns" />
import {
  shouldHoldRoutineVendorOutreach,
  vendorNotifyAlreadyCovered,
} from "./vendorOutreachGate.ts"

function assertEqual(actual: unknown, expected: unknown, label: string) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
}

Deno.test("routine jobs wait for approval when AI dispatch is off", () => {
  assertEqual(
    shouldHoldRoutineVendorOutreach({
      allowAiDispatch: false,
      emergency: false,
      landlordAcknowledged: false,
    }),
    true,
    "hold before any vendor text",
  )
  assertEqual(
    shouldHoldRoutineVendorOutreach({
      allowAiDispatch: false,
      emergency: false,
      landlordAcknowledged: true,
    }),
    false,
    "approved jobs may contact the vendor",
  )
})

Deno.test("emergencies and AI-dispatch accounts are not held", () => {
  assertEqual(
    shouldHoldRoutineVendorOutreach({
      allowAiDispatch: false,
      emergency: true,
      landlordAcknowledged: false,
    }),
    false,
    "emergency still uses the existing outreach path",
  )
  assertEqual(
    shouldHoldRoutineVendorOutreach({
      allowAiDispatch: true,
      emergency: false,
      landlordAcknowledged: false,
    }),
    false,
    "dispatch-on accounts keep the current path",
  )
})

Deno.test("a repeated approval does not notify the vendor again", () => {
  assertEqual(
    vendorNotifyAlreadyCovered({
      existingVendorId: "vendor-1",
      preferVendorId: "vendor-1",
      alreadyNotified: true,
      landlordAcknowledged: true,
    }),
    true,
    "duplicate approval",
  )
  assertEqual(
    vendorNotifyAlreadyCovered({
      existingVendorId: "vendor-1",
      preferVendorId: "vendor-1",
      alreadyNotified: false,
      landlordAcknowledged: true,
    }),
    false,
    "first approval still sends the job text",
  )
})

Deno.test("a retry while waiting does not count as a new vendor notification", () => {
  assertEqual(
    shouldHoldRoutineVendorOutreach({
      allowAiDispatch: false,
      emergency: false,
      landlordAcknowledged: false,
    }),
    true,
    "retry still holds",
  )
  assertEqual(
    vendorNotifyAlreadyCovered({
      existingVendorId: null,
      preferVendorId: null,
      alreadyNotified: false,
      landlordAcknowledged: false,
    }),
    false,
    "no vendor has been contacted yet",
  )
})
