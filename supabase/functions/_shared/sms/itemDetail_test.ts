/// <reference lib="deno.ns" />
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  acceptItemDetailAnswer,
  itemDetailQuestion,
} from "../../../../shared/maintenance/itemDetail.ts"
import { composeVendorJobOfferIssue } from "../../../../shared/maintenance/vendorJobOffer.ts"
import {
  applyDiagnosticAnswer,
  applyQuestionPlan,
  determineNextMaintenanceQuestion,
} from "./determineNextMaintenanceQuestion.ts"
import {
  buildConfirmationSummary,
  buildIntakeDescription,
  ticketIssueHeadline,
} from "./residentIntakeTypes.ts"

const LIGHT_QUESTION = "Is it a ceiling light, a wall-mounted light, or something else?"
const HALLWAY = "upstairs hallway near the bedrooms"

function afterPlace(detail?: string) {
  const located = applyQuestionPlan(applyDiagnosticAnswer({
    issue_type: "electrical",
    vendor_trade: "electrical",
    primary_category: "electrical",
    initial_message: "A new problem. The hallway fixture is out.",
    description: "A new problem. The hallway fixture is out.",
    diagnostic_question_type: "room_or_area",
    diagnostic_question: "Which hallway is the light in? For example, upstairs, downstairs, or near a particular room.",
    location_question: "Which hallway is the light in? For example, upstairs, downstairs, or near a particular room.",
    diagnostic_facts: { unit_entry: "Yes" },
    step: "room_or_area",
    preferred_contact_method: "text",
  }, HALLWAY))
  if (!detail) return located
  return applyQuestionPlan(applyDiagnosticAnswer({
    ...located,
    diagnostic_question_type: "item_detail",
    diagnostic_question: LIGHT_QUESTION,
  }, detail))
}

Deno.test("a hallway light asks how it is mounted, then keeps that answer", () => {
  const located = afterPlace()
  assertEquals(located.diagnostic_question, LIGHT_QUESTION)
  assertEquals(located.diagnostic_facts?.unit_entry, "Yes")
  assertEquals(located.room_or_area, HALLWAY)

  const ceiling = afterPlace("ceiling")
  const summary = buildConfirmationSummary({ ...ceiling, step: "awaiting_confirm" })
  const sentence = "The ceiling light in the upstairs hallway near the bedrooms is out."
  assertEquals(summary.includes(sentence), true)
  assertEquals(summary.includes("Staff or a vendor may enter if no one is home."), true)
  assertEquals(/bathroom|gas smell/i.test(summary), false)
  assertEquals(ticketIssueHeadline(ceiling), sentence.replace(/\.$/, ""))
  assertEquals(buildIntakeDescription(ceiling).includes("Item: ceiling."), true)
  assertEquals(buildIntakeDescription(ceiling).includes("Affected area: upstairs hallway near the bedrooms."), true)
  const offer = composeVendorJobOfferIssue({
    description: ceiling.initial_message,
    issueHeadline: "Electrical issue",
    locationQuestion: ceiling.location_question,
    locationAnswer: ceiling.room_or_area,
    facts: ceiling.diagnostic_facts,
  })
  assertEquals(offer, sentence)
})

Deno.test("not sure and a correction do not invent or keep the old light type", () => {
  assertEquals(acceptItemDetailAnswer("not sure"), "not_sure")
  assertEquals(acceptItemDetailAnswer("Is it a ceiling light, a wall-mounted light, or something else"), null)
  const unsure = afterPlace("not sure")
  const unsureSummary = buildConfirmationSummary({ ...unsure, step: "awaiting_confirm" })
  assertEquals(unsureSummary.includes("ceiling light"), false)
  assertEquals(unsureSummary.includes("The light in the upstairs hallway near the bedrooms won't turn on."), true)

  const wall = afterPlace("wall-mounted")
  const corrected = applyQuestionPlan(applyDiagnosticAnswer({
    ...wall,
    diagnostic_question_type: "item_detail",
    diagnostic_question: LIGHT_QUESTION,
    asked_question_types: (wall.asked_question_types ?? []).filter((type) => type !== "item_detail"),
  }, "a sconce by the bedroom door"))
  const summary = buildConfirmationSummary({ ...corrected, step: "awaiting_confirm" })
  assertEquals(
    summary.includes("The sconce by the bedroom door in the upstairs hallway near the bedrooms is out."),
    true,
  )
  assertEquals(/wall-mounted/i.test(summary), false)
})

Deno.test("other categories ask only for a missing identifier", () => {
  assertEquals(
    itemDetailQuestion("The kitchen sink is leaking"),
    null,
  )
  assertEquals(
    itemDetailQuestion("There is a leak"),
    "What appears to be leaking? For example, a pipe, the ceiling, or an appliance.",
  )
  assertEquals(itemDetailQuestion("The fridge won't turn on"), null)
  assertEquals(itemDetailQuestion("An appliance isn't working"), "Which appliance is it?")
  assertEquals(itemDetailQuestion("I saw roaches in the kitchen"), null)
  assertEquals(itemDetailQuestion("There are bugs"), "What did you see?")
  assertEquals(itemDetailQuestion("The bedroom window is broken"), null)
  assertEquals(itemDetailQuestion("The window"), "What isn't working with the window?")
  assertEquals(itemDetailQuestion("The ceiling light in the upstairs hallway is out"), null)
})

Deno.test("a leak, an appliance, and pests keep the resident's own detail", () => {
  assertEquals(
    buildConfirmationSummary({
      issue_type: "plumbing",
      vendor_trade: "plumbing",
      initial_message: "There is a leak",
      description: "There is a leak",
      room_or_area: "kitchen",
      diagnostic_facts: { item_detail: "pipe" },
      preferred_contact_method: "text",
      step: "awaiting_confirm",
    }).includes("The pipe is leaking in the kitchen."),
    true,
  )
  assertEquals(
    buildConfirmationSummary({
      issue_type: "appliance",
      vendor_trade: "appliance_repair",
      initial_message: "An appliance isn't working",
      description: "An appliance isn't working",
      room_or_area: "kitchen",
      diagnostic_facts: { item_detail: "fridge" },
      preferred_contact_method: "text",
      step: "awaiting_confirm",
    }).includes("The fridge isn't working in the kitchen."),
    true,
  )
  assertEquals(
    buildConfirmationSummary({
      issue_type: "pest",
      vendor_trade: "pest_control",
      initial_message: "There are bugs",
      description: "There are bugs",
      room_or_area: "kitchen",
      diagnostic_facts: { item_detail: "mice" },
      preferred_contact_method: "text",
      step: "awaiting_confirm",
    }).includes("There are mice in the kitchen."),
    true,
  )
})

Deno.test("emergencies do not wait for an item detail", () => {
  assertEquals(itemDetailQuestion("I smell gas in the hallway"), null)
  const gas = determineNextMaintenanceQuestion({
    issue_type: "other",
    vendor_trade: "other",
    primary_category: "general",
    initial_message: "I smell gas in the hallway",
    description: "I smell gas in the hallway",
    preferred_contact_method: "text",
  })
  const gasQuestion = gas.shouldAsk ? gas.question : ""
  assertEquals(/ceiling light|what did you see|what appears to be leaking/i.test(gasQuestion), false)
  const distress = determineNextMaintenanceQuestion({
    issue_type: "HVAC",
    vendor_trade: "hvac",
    primary_category: "hvac",
    initial_message: "It's 100 inside and my son feels dizzy. The hallway light is out.",
    description: "It's 100 inside and my son feels dizzy. The hallway light is out.",
    preferred_contact_method: "text",
  })
  const distressQuestion = distress.shouldAsk ? distress.question : ""
  assertEquals(/ceiling light/i.test(distressQuestion), false)
})
