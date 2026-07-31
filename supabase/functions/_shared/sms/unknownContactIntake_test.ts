import { assertEquals, assertMatch } from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  buildAskConsentSms,
  buildAskLocationSms,
  buildSavedAndSubmittedSms,
  createInitialUnknownContactState,
  detectUrgentIssue,
  extractBuildingHints,
  extractRelationship,
  extractSenderName,
  parseContactConsent,
} from "./unknownContactIntake.ts"
import { extractUnitFromMessage } from "./resolveIdentity.ts"

Deno.test("detectUrgentIssue catches leak / emergency language", () => {
  assertEquals(
    detectUrgentIssue("Hey, the bathroom ceiling is leaking really badly."),
    true,
  )
  assertEquals(detectUrgentIssue("My fridge is making a noise."), false)
})

Deno.test("extractUnitFromMessage + building hints from free text", () => {
  assertEquals(extractUnitFromMessage("Apt 3B at 123 Main."), "3B")
  const hints = extractBuildingHints("Apt 3B at 123 Main.")
  assertEquals(hints.some((h) => /123\s*main/i.test(h)), true)
})

Deno.test("extractSenderName + relationship", () => {
  assertEquals(
    extractSenderName("Yes, I'm the new subletter, Jordan."),
    "Jordan",
  )
  assertEquals(
    extractRelationship("Yes, I'm the new subletter, Jordan."),
    "subletter",
  )
  assertEquals(extractRelationship("I'm a guest staying here"), "guest")
  assertEquals(extractRelationship("roommate in 3B"), "household_member")
})

Deno.test("parseContactConsent flexible yes/no", () => {
  assertEquals(parseContactConsent("Yes"), true)
  assertEquals(parseContactConsent("Yes, I'm the new subletter, Jordan."), true)
  assertEquals(parseContactConsent("sure"), true)
  assertEquals(parseContactConsent("No"), false)
  assertEquals(parseContactConsent("don't save it"), false)
  assertEquals(parseContactConsent("Apt 3B"), null)
})

Deno.test("copy matches example tone", () => {
  assertMatch(
    buildAskLocationSms("ceiling leaking"),
    /don't recognize this phone number/i,
  )
  assertMatch(
    buildAskConsentSms({
      unitLabel: "3B",
      buildingLabel: "123 Main",
      urgent: true,
    }),
    /This sounds urgent/,
  )
  assertMatch(
    buildAskConsentSms({
      unitLabel: "3B",
      buildingLabel: "123 Main",
      urgent: true,
    }),
    /may I save this phone number/i,
  )
  assertMatch(
    buildSavedAndSubmittedSms({
      senderName: "Jordan",
      unitLabel: "3B",
      urgent: true,
      tradeLabel: "plumbing",
    }),
    /Thanks, Jordan/,
  )
  assertMatch(
    buildSavedAndSubmittedSms({
      senderName: "Jordan",
      unitLabel: "3B",
      urgent: true,
      tradeLabel: "plumbing",
    }),
    /property team has been notified/i,
  )
})

Deno.test("createInitialUnknownContactState seeds issue + urgency", () => {
  const state = createInitialUnknownContactState({
    conversationId: "c1",
    landlordId: "l1",
    senderPhone: "+15551234567",
    originalMessage: "Hey, the bathroom ceiling is leaking really badly.",
  })
  assertEquals(state.status, "identifying_location")
  assertEquals(state.severity, "urgent")
  assertEquals(state.detectedIntent, "maintenance")
  assertMatch(state.issueSummary ?? "", /leaking/i)
})
