/// <reference lib="deno.ns" />
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  acceptLocationReply,
  clarifyIssueLocation,
  withoutConversationInstruction,
} from "../../../../shared/maintenance/locationClarification.ts"
import { composeVendorJobOfferIssue } from "../../../../shared/maintenance/vendorJobOffer.ts"
import { looksLikeSeparateNewRequest, matchOpenRequests } from "./inboundContextualFollowUp.ts"
import {
  applyDiagnosticAnswer,
  applyQuestionPlan,
  determineNextMaintenanceQuestion,
} from "./determineNextMaintenanceQuestion.ts"
import {
  buildConfirmationSummary,
  confirmationClarification,
  repairStaleLocationAsk,
} from "./residentIntakeTypes.ts"
import { interpretConfirmedLocation } from "../../../../shared/maintenance/requestConfirmation.ts"

function questionFor(message: string, counts?: { bedroomCount?: number; bathroomCount?: number }) {
  const next = determineNextMaintenanceQuestion({
    issue_type: "general",
    vendor_trade: "general",
    primary_category: "general",
    initial_message: message,
    description: message,
    preferred_contact_method: "text",
    property_bedroom_count: counts?.bedroomCount,
    property_bathroom_count: counts?.bathroomCount,
  })
  return next.shouldAsk ? next.question : ""
}

Deno.test("unclear locations get a short follow-up", () => {
  assertEquals(questionFor("The sink is leaking"), "Which sink is leaking?")
  if (!questionFor("The bedroom window is broken").includes("Which bedroom is it in?")) {
    throw new Error(questionFor("The bedroom window is broken"))
  }
  assertEquals(questionFor("There's a leak outside"), "Where outside is the leak?")
  assertEquals(questionFor("The bathroom light isn't working"), "Which bathroom is it in?")
})

Deno.test("a clear or already answered location is not asked again", () => {
  assertEquals(
    clarifyIssueLocation({ text: "The kitchen sink is leaking" }).question,
    null,
  )
  assertEquals(
    clarifyIssueLocation({ text: "The master bedroom window is broken" }).location,
    "master bedroom",
  )
  assertEquals(
    clarifyIssueLocation({ text: "The hall bathroom light won't turn on" }).question,
    null,
  )
  assertEquals(
    clarifyIssueLocation({ text: "The leak is on the front porch" }).question,
    null,
  )
  assertEquals(
    clarifyIssueLocation({
      text: "The bathroom light isn't working",
      bathroomCount: 1,
    }).question,
    null,
  )
  assertEquals(clarifyIssueLocation({ text: "The AC isn't working" }).question, null)
  assertEquals(/which |where /i.test(questionFor("The AC isn't working")), false)
})

Deno.test("a free-text place is kept and shown on the summary", () => {
  assertEquals(acceptLocationReply("the upstairs hall bathroom"), "upstairs hall bathroom")
  const answered = applyQuestionPlan(applyDiagnosticAnswer({
    issue_type: "electrical",
    vendor_trade: "electrical",
    primary_category: "electrical",
    initial_message: "The bathroom light isn't working",
    description: "The bathroom light isn't working",
    diagnostic_question_type: "room_or_area",
    diagnostic_question: "Which bathroom is it in?",
    step: "room_or_area",
  }, "the upstairs hall bathroom"))
  assertEquals(answered.room_or_area, "upstairs hall bathroom")
  const summary = buildConfirmationSummary({
    ...answered,
    step: "awaiting_confirm",
  })
  if (!summary.toLowerCase().includes("upstairs hall bathroom")) {
    throw new Error(summary)
  }
})

Deno.test("a gas emergency does not wait on a location question", () => {
  const next = determineNextMaintenanceQuestion({
    issue_type: "other",
    vendor_trade: "other",
    primary_category: "general",
    initial_message: "I smell gas",
    description: "I smell gas",
    preferred_contact_method: "text",
  })
  const question = next.shouldAsk ? next.question : ""
  assertEquals(/which|where/i.test(question), false)
  assertEquals(
    clarifyIssueLocation({ text: "I smell gas in the kitchen" }).question,
    null,
  )
  assertEquals(
    clarifyIssueLocation({ text: "I smell gas in the kitchen" }).location,
    "kitchen",
  )
})

Deno.test("a loose only does not name which bathroom", () => {
  assertEquals(
    clarifyIssueLocation({
      text: "The bathroom light isn't working. Only in that room",
    }).question,
    "Which bathroom is it in?",
  )
})

const HALLWAY_QUESTION =
  "Which hallway is the light in? For example, upstairs, downstairs, or near a particular room."

Deno.test("a new problem among other requests asks which hallway before submission", () => {
  const body = "A new problem. The hallway fixture is out."
  const open = [
    { id: "bath", description: "The bathroom light won't turn on", vendor_work_status: "accepted", issue_category: "electrical" },
    { id: "gas", description: "I smell gas in the kitchen", vendor_work_status: "unassigned", issue_category: "other" },
    { id: "ac", description: "The AC isn't working", vendor_work_status: "unassigned", issue_category: "hvac" },
  ]
  assertEquals(looksLikeSeparateNewRequest(body), true)
  assertEquals(matchOpenRequests(body, open).map((row) => row.id), [])
  assertEquals(
    withoutConversationInstruction(body),
    "The hallway fixture is out.",
  )
  const planned = applyQuestionPlan({
    issue_type: "electrical",
    vendor_trade: "electrical",
    primary_category: "electrical",
    initial_message: body,
    description: body,
    room_or_area: "hallway",
    diagnostic_facts: { unit_entry: "Yes" },
    preferred_contact_method: "text",
  })
  assertEquals(planned.diagnostic_question, HALLWAY_QUESTION)
  assertEquals(planned.diagnostic_facts?.unit_entry, "Yes")
  assertEquals(planned.room_or_area, undefined)
  assertEquals(confirmationClarification(planned), HALLWAY_QUESTION)
  const summary = buildConfirmationSummary({
    ...planned,
    step: "awaiting_confirm",
  })
  assertEquals(/upstairs hallway near the bedrooms/i.test(summary), false)
  assertEquals(/bathroom light|smell gas|AC isn't/i.test(summary), false)
})

Deno.test("a clear hallway is kept and a missing one is asked", () => {
  assertEquals(
    clarifyIssueLocation({ text: "The upstairs hallway light is out" }).question,
    null,
  )
  assertEquals(
    clarifyIssueLocation({ text: "The upstairs hallway near the bedrooms light is out" }).location,
    "upstairs hallway near the bedrooms",
  )
  assertEquals(
    clarifyIssueLocation({ text: "The hallway light is out" }).question,
    HALLWAY_QUESTION,
  )
  assertEquals(
    clarifyIssueLocation({ text: "The closet shelf fell" }).question?.startsWith("Which closet"),
    true,
  )
  assertEquals(
    clarifyIssueLocation({ text: "The stairs light is out" }).question?.startsWith("Which stairs"),
    true,
  )
  assertEquals(
    clarifyIssueLocation({ text: "The kitchen sink is leaking" }).question,
    null,
  )
})

Deno.test("a confirmed hallway location is corrected in the summary and vendor offer", () => {
  const asked = applyQuestionPlan(applyDiagnosticAnswer({
    issue_type: "electrical",
    vendor_trade: "electrical",
    primary_category: "electrical",
    initial_message: "A new problem. The hallway fixture is out.",
    description: "A new problem. The hallway fixture is out.",
    diagnostic_question_type: "room_or_area",
    diagnostic_question: HALLWAY_QUESTION,
    location_question: HALLWAY_QUESTION,
    diagnostic_facts: { unit_entry: "Yes" },
    step: "room_or_area",
    preferred_contact_method: "text",
  }, "downstairs"))
  assertEquals(asked.diagnostic_facts?.unit_entry, "Yes")
  const downstairs = buildConfirmationSummary({ ...asked, step: "awaiting_confirm" })
  if (!downstairs.includes("The light in the downstairs hallway won't turn on.")) {
    throw new Error(downstairs)
  }
  assertEquals(/upstairs/i.test(downstairs), false)
  assertEquals(downstairs.includes("A new problem"), false)
  assertEquals(downstairs.includes("Staff or a vendor may enter if no one is home."), true)

  const corrected = applyQuestionPlan(applyDiagnosticAnswer({
    ...asked,
    diagnostic_question_type: "room_or_area",
    diagnostic_question: HALLWAY_QUESTION,
    location_question: HALLWAY_QUESTION,
    step: "room_or_area",
    asked_question_types: (asked.asked_question_types ?? []).filter((type) => type !== "room_or_area"),
  }, "upstairs hallway near the bedrooms"))
  const upstairs = buildConfirmationSummary({ ...corrected, step: "awaiting_confirm" })
  if (!upstairs.includes("The light in the upstairs hallway near the bedrooms won't turn on.")) {
    throw new Error(upstairs)
  }
  assertEquals(/downstairs/i.test(upstairs), false)
  const offer = composeVendorJobOfferIssue({
    description: corrected.description,
    issueHeadline: "Electrical issue",
    locationQuestion: corrected.location_question,
    locationAnswer: corrected.room_or_area,
    facts: corrected.diagnostic_facts,
  })
  assertEquals(
    offer,
    "The light in the upstairs hallway near the bedrooms won't turn on.",
  )
})

Deno.test("an older bathroom question does not take over a hallway repair", () => {
  const bathroomQuestion =
    "Which bathroom did you mean? You can say the bedroom bathroom, the hall bathroom, or another one."
  const reading = interpretConfirmedLocation({
    problem: "A new problem. The hallway fixture is out.",
    answer: "hallway",
    question: bathroomQuestion,
  })
  assertEquals(reading.location, null)
  assertEquals(reading.clarification, HALLWAY_QUESTION)
  const repaired = repairStaleLocationAsk({
    step: "room_or_area",
    issue_type: "electrical",
    vendor_trade: "electrical",
    initial_message: "A new problem. The hallway fixture is out.",
    description: "A new problem. The hallway fixture is out.\nTenant update: Yes",
    diagnostic_question_type: "room_or_area",
    diagnostic_question: bathroomQuestion,
    location_question: bathroomQuestion,
    room_or_area: "hallway",
    diagnostic_facts: { unit_entry: "Yes" },
    asked_question_types: ["unit_entry", "room_or_area"],
    preferred_contact_method: "text",
  })
  assertEquals(repaired.diagnostic_question, HALLWAY_QUESTION)
  assertEquals(repaired.room_or_area, undefined)
  assertEquals(repaired.diagnostic_facts?.unit_entry, "Yes")
  assertEquals(/bathroom/i.test(repaired.diagnostic_question ?? ""), false)
  const bathroom = interpretConfirmedLocation({
    problem: "The bathroom light won't turn on",
    answer: "Yes",
    question: "Which bathroom is it in?",
  })
  assertEquals(/which bathroom/i.test(bathroom.clarification ?? ""), true)
})

Deno.test("emergency guidance does not wait on a hallway question", () => {
  assertEquals(clarifyIssueLocation({ text: "I smell gas in the hallway" }).question, null)
  assertEquals(clarifyIssueLocation({ text: "I smell gas in the hallway" }).location, "hallway")
  const distress = determineNextMaintenanceQuestion({
    issue_type: "HVAC",
    vendor_trade: "hvac",
    primary_category: "hvac",
    initial_message: "It's 100 inside and my son feels dizzy. The hallway light is out.",
    description: "It's 100 inside and my son feels dizzy. The hallway light is out.",
    preferred_contact_method: "text",
  })
  const question = distress.shouldAsk ? distress.question : ""
  assertEquals(/which hallway/i.test(question), false)
})

Deno.test("a broad answer can be followed by a narrower question", () => {
  const planned = applyQuestionPlan(applyDiagnosticAnswer({
    issue_type: "plumbing",
    vendor_trade: "plumbing",
    primary_category: "plumbing",
    initial_message: "There is a leak",
    description: "There is a leak",
    diagnostic_question_type: "room_or_area",
    diagnostic_question: "Where in the home is this happening?",
    step: "diagnostic",
  }, "the bathroom"))
  assertEquals(planned.diagnostic_question, "Which bathroom is it in?")
})
