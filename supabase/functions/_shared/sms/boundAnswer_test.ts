/// <reference lib="deno.ns" />
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import { composeVendorJobOfferIssue } from "../../../../shared/maintenance/vendorJobOffer.ts"
import {
  applyDiagnosticAnswer,
  applyQuestionPlan,
} from "./determineNextMaintenanceQuestion.ts"
import {
  applySummaryCorrection,
  buildConfirmationSummary,
  buildIntakeDescription,
  sanitizeIntakeState,
  ticketIssueHeadline,
  type SmsIntakeState,
} from "./residentIntakeTypes.ts"

const HALLWAY = "upstairs hallway near the bedrooms"
const SENTENCE = "The ceiling light in the upstairs hallway near the bedrooms is out."

function hallwayDraft(overrides: SmsIntakeState = {}): SmsIntakeState {
  return {
    issue_type: "electrical",
    vendor_trade: "electrical",
    primary_category: "electrical",
    initial_message: "The hallway fixture is out.",
    description: "The hallway fixture is out.",
    room_or_area: HALLWAY,
    location_question: "Which hallway is the light in? For example, upstairs, downstairs, or near a particular room.",
    diagnostic_facts: { unit_entry: "Yes", item_detail: "wall mounted" },
    last_answered_question_type: "item_detail",
    last_answered_question: "Is it a ceiling light, a wall-mounted light, or something else?",
    asked_question_types: ["unit_entry", "room_or_area", "item_detail"],
    step: "awaiting_confirm",
    preferred_contact_method: "text",
    ...overrides,
  }
}

Deno.test("a later ceiling reply corrects the light and keeps the hallway", () => {
  const corrected = applySummaryCorrection(hallwayDraft(), "Ceiling")
  if (corrected.action !== "update") throw new Error(corrected.action)
  assertEquals(corrected.state.room_or_area, HALLWAY)
  assertEquals(corrected.state.diagnostic_facts?.item_detail, "ceiling")
  assertEquals(corrected.state.diagnostic_facts?.unit_entry, "Yes")
  assertEquals(corrected.state.description, "The hallway fixture is out.")
  const summary = buildConfirmationSummary(corrected.state)
  assertEquals(summary.includes(SENTENCE), true)
  assertEquals(summary.includes("Staff or a vendor may enter if no one is home."), true)
  assertEquals(/bathroom|wall-mounted/i.test(summary), false)
  assertEquals(ticketIssueHeadline(corrected.state), SENTENCE.replace(/\.$/, ""))
  assertEquals(buildIntakeDescription(corrected.state).includes("Item: ceiling."), true)
  assertEquals(
    buildIntakeDescription(corrected.state).includes(`Affected area: ${HALLWAY}.`),
    true,
  )
  assertEquals(
    composeVendorJobOfferIssue({
      description: corrected.state.initial_message,
      issueHeadline: "Electrical issue",
      locationQuestion: corrected.state.location_question,
      locationAnswer: corrected.state.room_or_area,
      facts: corrected.state.diagnostic_facts,
    }),
    SENTENCE,
  )
})

Deno.test("sequential answers stay on their own fields", () => {
  const located = applyQuestionPlan(applyDiagnosticAnswer({
    issue_type: "electrical",
    vendor_trade: "electrical",
    initial_message: "The hallway fixture is out.",
    description: "The hallway fixture is out.",
    diagnostic_question_type: "room_or_area",
    diagnostic_question: "Which hallway is the light in? For example, upstairs, downstairs, or near a particular room.",
    diagnostic_facts: { unit_entry: "Yes" },
    step: "room_or_area",
    preferred_contact_method: "text",
  }, HALLWAY))
  assertEquals(located.room_or_area, HALLWAY)
  assertEquals(located.diagnostic_question, "Is it a ceiling light, a wall-mounted light, or something else?")
  const mounted = applyQuestionPlan(applyDiagnosticAnswer(located, "Wall mounted"))
  assertEquals(mounted.diagnostic_facts?.item_detail, "wall mounted")
  assertEquals(mounted.room_or_area, HALLWAY)
  assertEquals(mounted.description, "The hallway fixture is out.")
  const ceiling = applySummaryCorrection(mounted, "ceiling")
  if (ceiling.action !== "update") throw new Error(ceiling.action)
  assertEquals(ceiling.state.diagnostic_facts?.item_detail, "ceiling")
  assertEquals(ceiling.state.room_or_area, HALLWAY)
  assertEquals(ceiling.state.diagnostic_facts?.unit_entry, "Yes")
})

Deno.test("an ambiguous ceiling does not overwrite a saved place or light", () => {
  const before = hallwayDraft({ last_answered_question_type: undefined, last_answered_question: undefined })
  const held = applySummaryCorrection(before, "ceiling")
  if (held.action !== "clarify") throw new Error(held.action)
  assertEquals(held.state.room_or_area, HALLWAY)
  assertEquals(held.state.diagnostic_facts?.item_detail, "wall mounted")
  assertEquals(held.state.diagnostic_facts?.unit_entry, "Yes")
  assertEquals(/ceiling light/i.test(held.question), true)
  const chosen = applySummaryCorrection(held.state, "ceiling light")
  if (chosen.action !== "update") throw new Error(chosen.action)
  assertEquals(chosen.state.diagnostic_facts?.item_detail, "ceiling")
  assertEquals(chosen.state.room_or_area, HALLWAY)
})

Deno.test("a place correction does not replace the light type", () => {
  const moved = applySummaryCorrection(
    hallwayDraft({ diagnostic_facts: { unit_entry: "Yes", item_detail: "ceiling" } }),
    "downstairs hallway",
  )
  if (moved.action !== "update") throw new Error(moved.action)
  assertEquals(moved.state.room_or_area, "downstairs hallway")
  assertEquals(moved.state.diagnostic_facts?.item_detail, "ceiling")
  assertEquals(moved.state.diagnostic_facts?.unit_entry, "Yes")
})

Deno.test("a leak source stays off the room, and a resumed draft keeps one sentence", () => {
  const leak = applySummaryCorrection({
    issue_type: "plumbing",
    vendor_trade: "plumbing",
    initial_message: "There is a leak",
    description: "There is a leak",
    room_or_area: "kitchen",
    diagnostic_facts: { item_detail: "pipe" },
    last_answered_question_type: "item_detail",
    last_answered_question: "What appears to be leaking? For example, a pipe, the ceiling, or an appliance.",
    step: "awaiting_confirm",
    preferred_contact_method: "text",
  }, "ceiling")
  if (leak.action !== "update") throw new Error(leak.action)
  assertEquals(leak.state.room_or_area, "kitchen")
  assertEquals(leak.state.diagnostic_facts?.item_detail, "ceiling")
  const summary = buildConfirmationSummary(leak.state)
  assertEquals(summary.includes("The ceiling is leaking in the kitchen."), true)

  const resumed = sanitizeIntakeState(hallwayDraft({
    description: "The hallway fixture is out.\nTenant update: Wall mounted\nTenant update: Ceiling",
    diagnostic_facts: { unit_entry: "Yes", item_detail: "ceiling" },
  }))
  assertEquals(resumed.room_or_area, HALLWAY)
  assertEquals(resumed.diagnostic_facts?.item_detail, "ceiling")
  const resumedSummary = buildConfirmationSummary(resumed)
  assertEquals(resumedSummary.includes(SENTENCE), true)
  assertEquals(resumedSummary.includes("Staff or a vendor may enter if no one is home."), true)
  const again = buildConfirmationSummary(resumed)
  assertEquals(again, resumedSummary)
})

Deno.test("another request's details are not copied onto this draft", () => {
  const summary = buildConfirmationSummary(hallwayDraft({
    diagnostic_facts: { unit_entry: "Yes", item_detail: "ceiling" },
  }))
  assertEquals(/bathroom|gas smell|air conditioning/i.test(summary), false)
  assertEquals(summary.includes(SENTENCE), true)
})

Deno.test("Ulo's own question is not stored as the resident's answer", () => {
  const echoed = applySummaryCorrection(
    hallwayDraft(),
    "Is it a ceiling light, a wall-mounted light, or something else?",
  )
  assertEquals(echoed.action, "none")
  if (echoed.action !== "none") return
})
