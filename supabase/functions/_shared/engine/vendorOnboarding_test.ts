/// <reference lib="deno.ns" />
import {
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  buildVendorOnboardingReminderSms,
  readVendorOnboardingState,
  vendorOnboardingActionDue,
  vendorOnboardingInviteWasDelivered,
  vendorOnboardingFormWasSubmitted,
  VENDOR_ONBOARDING_WAITING_STEPS,
} from "./vendorOnboardingPolicy.ts"
import type { WorkflowRunRow } from "./types.ts"

function makeRun(patch: Partial<WorkflowRunRow> & {
  current_step: string
  started_at: string
  metadata?: Record<string, unknown>
}): WorkflowRunRow {
  return {
    id: "run-1",
    template_id: "vendor_onboarding",
    workflow_type: "vendor",
    status: "active",
    landlord_id: "landlord-1",
    trigger_type: "dashboard",
    entity_type: null,
    entity_id: null,
    property_id: null,
    unit_id: null,
    resident_id: null,
    current_stage: "act",
    completed_at: null,
    created_at: patch.started_at,
    updated_at: patch.started_at,
    metadata: {},
    ...patch,
  }
}

Deno.test("failed invite delivery must not stay on Active Tasks", () => {
  assertEquals(vendorOnboardingInviteWasDelivered(null), false)
  assertEquals(vendorOnboardingInviteWasDelivered({ anyDelivered: false }), false)
  assertEquals(vendorOnboardingInviteWasDelivered({ anyDelivered: true }), true)
})

Deno.test("vendorOnboardingFormWasSubmitted is true after form submit", () => {
  assertEquals(vendorOnboardingFormWasSubmitted("needs_review", null), true)
  assertEquals(vendorOnboardingFormWasSubmitted("invited", "submitted"), true)
  assertEquals(vendorOnboardingFormWasSubmitted("invited", "invited"), false)
})

Deno.test("vendor onboarding waiting steps include invited and reminder_sent", () => {
  for (const step of ["invited", "in_progress", "needs_review", "reminder_sent"]) {
    assertEquals(VENDOR_ONBOARDING_WAITING_STEPS.has(step), true)
  }
  assertEquals(VENDOR_ONBOARDING_WAITING_STEPS.has("verified"), false)
})

Deno.test("vendorOnboardingActionDue reminds before escalating", () => {
  const started = new Date()
  started.setDate(started.getDate() - 3)
  const run = makeRun({
    current_step: "invited",
    started_at: started.toISOString(),
    metadata: { step_state: { step: "invited", reminder_count: 0 } },
  })
  const due = vendorOnboardingActionDue(run, {
    reminder_days: 2,
    no_response_days: 5,
  })
  assertEquals(due.due, true)
  assertEquals(due.reason, "reminder_due")
})

Deno.test("vendorOnboardingActionDue escalates after no_response_days", () => {
  const started = new Date()
  started.setDate(started.getDate() - 6)
  const reminded = new Date()
  reminded.setDate(reminded.getDate() - 3)
  const run = makeRun({
    current_step: "reminder_sent",
    started_at: started.toISOString(),
    metadata: {
      step_state: {
        step: "reminder_sent",
        reminder_sent_at: reminded.toISOString(),
        reminder_count: 1,
      },
    },
  })
  const due = vendorOnboardingActionDue(run, {
    reminder_days: 2,
    no_response_days: 5,
  })
  assertEquals(due.due, true)
  assertEquals(due.reason, "no_response_by_no_response_days")
})

Deno.test("readVendorOnboardingState prefers current_step", () => {
  const run = makeRun({
    current_step: "in_progress",
    started_at: new Date().toISOString(),
    metadata: {
      verification_id: "ver-1",
      vendor_id: "vendor-1",
      step_state: {
        step: "invited",
        verification_id: "ver-1",
        reminder_count: 0,
      },
    },
  })
  const state = readVendorOnboardingState(run)
  assertEquals(state.step, "in_progress")
  assertEquals(state.verification_id, "ver-1")
  assertEquals(state.vendor_id, "vendor-1")
})

Deno.test("reminder SMS follows Ulo writing standard shape", () => {
  const body = buildVendorOnboardingReminderSms({
    vendorLabel: "Flex Plumbing",
    companyName: "Acme Properties",
    link: "https://app.example/v/token",
  })
  assertEquals(body.includes("Flex Plumbing"), true)
  assertEquals(body.includes("Acme Properties"), true)
  assertEquals(body.includes("https://app.example/v/token"), true)
  assertEquals(/workflow/i.test(body), false)
})
