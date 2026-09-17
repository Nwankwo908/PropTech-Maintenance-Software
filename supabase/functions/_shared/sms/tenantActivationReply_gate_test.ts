/// <reference lib="deno.ns" />
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  canHandleTenantActivationReply,
  isNonTenantActivationThread,
} from "./tenantMessaging.ts"

Deno.test("waiting YES is eligible even when intake is open", () => {
  assertEquals(
    canHandleTenantActivationReply({
      body: "YES",
      residentId: "resident-1",
      identityType: "resident",
      activeMaintenanceIntake: true,
      activationStatus: "waiting",
      smsConsentStatus: "pending",
      activationSmsSentAt: "2026-01-01T00:00:00.000Z",
    }),
    true,
  )
})

Deno.test("waiting YES is eligible even on a mis-labeled vendor thread", () => {
  assertEquals(isNonTenantActivationThread("vendor", "vendor_alert"), true)
  assertEquals(
    canHandleTenantActivationReply({
      body: "YES",
      residentId: "resident-1",
      identityType: "vendor",
      conversationType: "vendor_alert",
      activationStatus: "waiting",
      smsConsentStatus: "pending",
      activationSmsSentAt: "2026-01-01T00:00:00.000Z",
    }),
    true,
  )
})

Deno.test("YES without resident id is not eligible at the pure gate", () => {
  assertEquals(
    canHandleTenantActivationReply({
      body: "YES",
      residentId: null,
      activationStatus: "waiting",
      smsConsentStatus: "pending",
    }),
    false,
  )
})
