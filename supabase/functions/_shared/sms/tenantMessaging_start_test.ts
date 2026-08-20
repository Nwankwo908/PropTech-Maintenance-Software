/// <reference lib="deno.ns" />
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  classifyTenantActivationKeyword,
  classifyTenantComplianceKeyword,
  planSmsStartAction,
  smsOptInActivationPatch,
  smsOptOutPatch,
  tenantAlreadySubscribedConfirmationSms,
  tenantReOptInConfirmationSms,
  tenantUnknownStartConfirmationSms,
} from "./tenantMessaging.ts"
import { parseInspectionResidentReply } from "../engine/inspectionChecklist.ts"
import { shouldSkipInboundInterpretation } from "./inboundInterpretation.ts"

const RESIDENT = "resident-1"

Deno.test("START is a global compliance keyword (not YES)", () => {
  assertEquals(classifyTenantComplianceKeyword("START"), "start")
  assertEquals(classifyTenantComplianceKeyword("start"), "start")
  assertEquals(classifyTenantComplianceKeyword("UNSTOP"), "start")
  assertEquals(classifyTenantComplianceKeyword("YES"), null)
  assertEquals(classifyTenantActivationKeyword("YES"), "start")
  assertEquals(classifyTenantActivationKeyword("START"), null)
})

Deno.test("START is skipped by inbound interpretation (maintenance cannot consume it)", () => {
  assertEquals(shouldSkipInboundInterpretation("START"), true)
  assertEquals(shouldSkipInboundInterpretation("start"), true)
  assertEquals(shouldSkipInboundInterpretation("UNSTOP"), true)
  assertEquals(shouldSkipInboundInterpretation("The leak in the start"), false)
})

Deno.test("STOP → opted_out patch keeps consent and activation together", () => {
  const patch = smsOptOutPatch("2026-08-15T00:00:00.000Z")
  assertEquals(patch.sms_consent_status, "opted_out")
  assertEquals(patch.activation_status, "opted_out")
})

Deno.test("START → opted_in + activated patch keeps Residents chip in sync", () => {
  const patch = smsOptInActivationPatch("2026-08-15T00:00:00.000Z")
  assertEquals(patch.sms_consent_status, "opted_in")
  assertEquals(patch.activation_status, "activated")
})

Deno.test("opted-out tenant START plans reactivation (not a new identity)", () => {
  const plan = planSmsStartAction({
    residentId: RESIDENT,
    smsConsentStatus: "opted_out",
    activationStatus: "opted_out",
  })
  assertEquals(plan.shouldUpdateResident, true)
  assertEquals(plan.shouldLogOptIn, true)
  assertEquals(plan.shouldLogActivationCompleted, true)
  assertEquals(plan.shouldActivateUnit, true)
  assertEquals(plan.confirmationKind, "reopt_in")
  assertEquals(
    tenantReOptInConfirmationSms().includes("subscribed to Ulo messages again"),
    true,
  )
})

Deno.test("already activated START is idempotent", () => {
  const plan = planSmsStartAction({
    residentId: RESIDENT,
    smsConsentStatus: "opted_in",
    activationStatus: "activated",
  })
  assertEquals(plan.shouldUpdateResident, false)
  assertEquals(plan.shouldLogOptIn, false)
  assertEquals(plan.shouldLogActivationCompleted, false)
  assertEquals(plan.shouldActivateUnit, true)
  assertEquals(plan.shouldMarkIdentityVerified, false)
  assertEquals(plan.confirmationKind, "already_subscribed")
  assertEquals(tenantAlreadySubscribedConfirmationSms().includes("already subscribed"), true)
})

Deno.test("repeated START after reactivation stays idempotent", () => {
  const first = planSmsStartAction({
    residentId: RESIDENT,
    smsConsentStatus: "opted_out",
    activationStatus: "opted_out",
  })
  assertEquals(first.confirmationKind, "reopt_in")
  const second = planSmsStartAction({
    residentId: RESIDENT,
    smsConsentStatus: "opted_in",
    activationStatus: "activated",
  })
  assertEquals(second.shouldUpdateResident, false)
  assertEquals(second.shouldLogOptIn, false)
  assertEquals(second.shouldLogActivationCompleted, false)
  assertEquals(second.shouldActivateUnit, true)
})

Deno.test("unknown number START captures consent without binding a resident", () => {
  const plan = planSmsStartAction({
    residentId: null,
    smsConsentStatus: null,
    activationStatus: null,
  })
  assertEquals(plan.shouldUpdateResident, false)
  assertEquals(plan.shouldLogActivationCompleted, false)
  assertEquals(plan.shouldMarkIdentityVerified, false)
  assertEquals(plan.shouldActivateUnit, false)
  assertEquals(plan.confirmationKind, "unknown")
  const body = tenantUnknownStartConfirmationSms()
  assertEquals(body.includes("Unit"), false)
  assertEquals(/resident|property|lease/i.test(body), false)
})

Deno.test("waiting YES/START first opt-in still activates (onboarding continues to work)", () => {
  const plan = planSmsStartAction({
    residentId: RESIDENT,
    smsConsentStatus: "pending",
    activationStatus: "waiting",
  })
  assertEquals(plan.confirmationKind, "first_opt_in")
  assertEquals(plan.shouldUpdateResident, true)
  assertEquals(plan.shouldLogActivationCompleted, true)
})

Deno.test("inspection READY still starts a walkthrough; bare START is consent first", () => {
  assertEquals(classifyTenantComplianceKeyword("START"), "start")
  assertEquals(classifyTenantComplianceKeyword("READY"), null)
  assertEquals(parseInspectionResidentReply("READY"), "start")
  assertEquals(parseInspectionResidentReply("START"), "start")
})

Deno.test("START does not look like a new repair to compliance classification", () => {
  assertEquals(classifyTenantComplianceKeyword("leak in the start"), null)
  assertEquals(classifyTenantComplianceKeyword("the heater stopped working"), null)
})
