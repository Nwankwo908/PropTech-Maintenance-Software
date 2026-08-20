/// <reference lib="deno.ns" />
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  canHandleTenantActivationReply,
  classifyTenantActivationKeyword,
  classifyTenantComplianceKeyword,
  isNonTenantActivationThread,
  isTenantActivationPending,
} from "./tenantMessaging.ts"
import { parseTenantScheduleDecision } from "./tenantScheduleConfirm.ts"
import { INBOUND_SMS_HANDLERS } from "./inboundHandlerRegistry.ts"

const RESIDENT = "resident-1"

function waitingActivation() {
  return {
    activationStatus: "waiting",
    smsConsentStatus: "pending",
    activationSmsSentAt: "2026-01-01T00:00:00.000Z",
  }
}

function activatedResident() {
  return {
    activationStatus: "activated",
    smsConsentStatus: "opted_in",
    activationSmsSentAt: "2026-01-01T00:00:00.000Z",
  }
}

Deno.test("STOP is global — strict single-token match only", () => {
  assertEquals(classifyTenantComplianceKeyword("STOP"), "stop")
  assertEquals(classifyTenantComplianceKeyword("stop"), "stop")
  assertEquals(classifyTenantComplianceKeyword("Stop!"), "stop")
  assertEquals(classifyTenantComplianceKeyword("HELP"), "help")
  assertEquals(
    classifyTenantComplianceKeyword("The heater stopped working."),
    null,
  )
  assertEquals(classifyTenantComplianceKeyword("Please stop by later"), null)
})

Deno.test("STOP works for onboarding and activated residents (compliance path)", () => {
  assertEquals(classifyTenantComplianceKeyword("STOP"), "stop")
  assertEquals(
    canHandleTenantActivationReply({
      body: "STOP",
      residentId: RESIDENT,
      identityType: "resident",
      ...activatedResident(),
    }),
    false,
  )
})

Deno.test("activation YES is separate from compliance START", () => {
  assertEquals(classifyTenantActivationKeyword("YES"), "start")
  assertEquals(classifyTenantComplianceKeyword("YES"), null)
  assertEquals(classifyTenantComplianceKeyword("START"), "start")
  assertEquals(classifyTenantActivationKeyword("START"), null)
})

Deno.test("1. pending activation + YES → activation reply eligible", () => {
  assertEquals(
    canHandleTenantActivationReply({
      body: "YES",
      residentId: RESIDENT,
      identityType: "resident",
      conversationType: "resident_intake",
      ...waitingActivation(),
    }),
    true,
  )
})

Deno.test("2. pending activation + START → compliance (not activation reply)", () => {
  assertEquals(classifyTenantComplianceKeyword("START"), "start")
  assertEquals(
    canHandleTenantActivationReply({
      body: "START",
      residentId: RESIDENT,
      identityType: "resident",
      conversationType: "resident_intake",
      ...waitingActivation(),
    }),
    false,
  )
})

Deno.test("3. fully activated tenant + YES → not eligible", () => {
  assertEquals(
    canHandleTenantActivationReply({
      body: "YES",
      residentId: RESIDENT,
      identityType: "resident",
      conversationType: "resident_intake",
      ...activatedResident(),
    }),
    false,
  )
})

Deno.test("4. fully activated tenant + START → not activation-reply (global compliance handles it)", () => {
  assertEquals(
    canHandleTenantActivationReply({
      body: "START",
      residentId: RESIDENT,
      identityType: "resident",
      conversationType: "resident_intake",
      ...activatedResident(),
    }),
    false,
  )
})

Deno.test("5. schedule confirmation YES wins over activation reply (registry order + pending task)", () => {
  assertEquals(parseTenantScheduleDecision("YES"), "accept")
  const schedule = INBOUND_SMS_HANDLERS.find((h) => h.id === "schedule_confirm")!
  const activation = INBOUND_SMS_HANDLERS.find((h) => h.id === "tenant_activation_reply")!
  assertEquals(schedule.priority < activation.priority, true)
})

Deno.test("7. vendor YES never triggers tenant activation reply", () => {
  assertEquals(classifyTenantActivationKeyword("YES"), "start")
  assertEquals(isNonTenantActivationThread("vendor", "vendor_alert"), true)
  assertEquals(
    canHandleTenantActivationReply({
      body: "YES",
      residentId: RESIDENT,
      identityType: "vendor",
      conversationType: "vendor_alert",
      ...waitingActivation(),
    }),
    false,
  )
})

Deno.test("8. post-onboarding generic YES is not claimed when not waiting", () => {
  assertEquals(
    canHandleTenantActivationReply({
      body: "YES",
      residentId: RESIDENT,
      identityType: "resident",
      conversationType: "resident_intake",
      activationStatus: "not_started",
      smsConsentStatus: "pending",
      activationSmsSentAt: null,
    }),
    false,
  )
})

Deno.test("opted-out tenant + START is compliance, not waiting-activation YES", () => {
  assertEquals(classifyTenantComplianceKeyword("START"), "start")
  assertEquals(
    canHandleTenantActivationReply({
      body: "START",
      residentId: RESIDENT,
      identityType: "resident",
      conversationType: "resident_intake",
      activationStatus: "opted_out",
      smsConsentStatus: "opted_out",
      activationSmsSentAt: "2026-01-01T00:00:00.000Z",
    }),
    false,
  )
  assertEquals(
    canHandleTenantActivationReply({
      body: "YES",
      residentId: RESIDENT,
      identityType: "resident",
      conversationType: "resident_intake",
      activationStatus: "opted_out",
      smsConsentStatus: "opted_out",
      activationSmsSentAt: "2026-01-01T00:00:00.000Z",
    }),
    false,
  )
})

Deno.test("9. pending consent alone does not infer activation window", () => {
  assertEquals(
    isTenantActivationPending({
      activationStatus: "not_started",
      smsConsentStatus: "pending",
      activationSmsSentAt: "2026-01-01T00:00:00.000Z",
    }),
    false,
  )
  assertEquals(
    isTenantActivationPending({
      activationStatus: "waiting",
      smsConsentStatus: "pending",
      activationSmsSentAt: "2026-01-01T00:00:00.000Z",
    }),
    true,
  )
})
