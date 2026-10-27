/// <reference lib="deno.ns" />
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  acceptLocationReply,
  clarifyIssueLocation,
} from "../../../../shared/maintenance/locationClarification.ts"
import {
  applyDiagnosticAnswer,
  applyQuestionPlan,
  determineNextMaintenanceQuestion,
} from "./determineNextMaintenanceQuestion.ts"
import { buildConfirmationSummary } from "./residentIntakeTypes.ts"

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
