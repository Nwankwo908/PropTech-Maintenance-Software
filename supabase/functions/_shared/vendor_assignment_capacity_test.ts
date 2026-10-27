/// <reference lib="deno.ns" />
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import { offerVendorStillAvailable } from "./vendor_assignment.ts"

const overridden = {
  id: "a1b2c3d4-0000-4000-8000-000000000022",
  active: true,
  roster_status: null,
  onboarding_overridden_at: "2026-10-27T11:05:06.940Z",
}

Deno.test("an overridden vendor with no verification can still be approved", () => {
  assertEquals(offerVendorStillAvailable({
    vendor: overridden,
    verification: null,
  }), true)
})

Deno.test("a paused vendor cannot be approved", () => {
  assertEquals(offerVendorStillAvailable({
    vendor: overridden,
    verification: { status: "verified", availability: "paused" },
  }), false)
})

Deno.test("a missing vendor cannot be approved", () => {
  assertEquals(offerVendorStillAvailable({
    vendor: null,
    verification: null,
  }), false)
})

Deno.test("a suspended vendor cannot be approved", () => {
  assertEquals(offerVendorStillAvailable({
    vendor: { ...overridden, roster_status: "suspended" },
    verification: { status: "verified", availability: "active" },
  }), false)
})

Deno.test("a verified vendor who is accepting work can be approved", () => {
  assertEquals(offerVendorStillAvailable({
    vendor: { ...overridden, onboarding_overridden_at: null },
    verification: { status: "verified", availability: "active" },
  }), true)
})

Deno.test("an unverified vendor without an override cannot be approved", () => {
  assertEquals(offerVendorStillAvailable({
    vendor: { ...overridden, onboarding_overridden_at: null },
    verification: null,
  }), false)
})
