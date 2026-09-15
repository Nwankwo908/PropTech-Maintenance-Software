/// <reference lib="deno.ns" />
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  canHandleTenantActivationHold,
  mergeParkedOnboardingRequest,
  takeParkedOnboardingRequest,
} from "./tenantActivationPending.ts"

const waiting = {
  activationStatus: "waiting",
  smsConsentStatus: "pending",
  activationSmsSentAt: "2026-09-14T16:47:00.000Z",
}

Deno.test("hold gate: waiting + repair ask is eligible", () => {
  assertEquals(
    canHandleTenantActivationHold({
      body: "Hi and thank you I was trying to see if an exterminator can come out",
      residentId: "r1",
      identityType: "resident",
      conversationType: "resident_intake",
      ...waiting,
    }),
    true,
  )
})

Deno.test("hold gate: YES/NO/STOP are not holds", () => {
  for (const body of ["YES", "yes", "NO", "no", "STOP", "HELP", "START"]) {
    assertEquals(
      canHandleTenantActivationHold({
        body,
        residentId: "r1",
        identityType: "resident",
        conversationType: "resident_intake",
        ...waiting,
      }),
      false,
      body,
    )
  }
})

Deno.test("hold gate: not waiting → false", () => {
  assertEquals(
    canHandleTenantActivationHold({
      body: "Kitchen sink is leaking",
      residentId: "r1",
      identityType: "resident",
      conversationType: "resident_intake",
      activationStatus: "activated",
      smsConsentStatus: "opted_in",
      activationSmsSentAt: "2026-09-14T16:47:00.000Z",
    }),
    false,
  )
})

Deno.test("park merge appends a later message", () => {
  const first = mergeParkedOnboardingRequest(
    {},
    { body: "Need an exterminator", mediaUrls: [] },
    "t1",
  )
  const second = mergeParkedOnboardingRequest(
    first,
    { body: "Also the sink", mediaUrls: ["https://img"] },
    "t2",
  )
  assertEquals(
    second.pending_onboarding_request_body,
    "Need an exterminator\nAlso the sink",
  )
  assertEquals(second.pending_onboarding_request_media, ["https://img"])
})

Deno.test("take parked request clears intake keys", () => {
  const { parked, next } = takeParkedOnboardingRequest({
    pending_onboarding_request_body: "Need an exterminator",
    pending_onboarding_request_media: [],
    pending_onboarding_request_at: "t1",
    step: "issue_type",
  })
  assertEquals(parked?.body, "Need an exterminator")
  assertEquals("pending_onboarding_request_body" in next, false)
  assertEquals(next.step, "issue_type")
})
