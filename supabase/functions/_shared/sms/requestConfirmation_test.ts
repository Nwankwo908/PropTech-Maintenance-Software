/// <reference lib="deno.ns" />
import { assertEquals, assertMatch } from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  interpretConfirmedLocation,
  recoverLocationQuestion,
} from "../../../../shared/maintenance/requestConfirmation.ts"
import {
  buildConfirmationSummary,
  confirmationClarification,
} from "./residentIntakeTypes.ts"

const LIGHT = {
  issue_type: "electrical" as const,
  vendor_trade: "electrical" as const,
  primary_category: "electrical" as const,
  initial_message: "The bathroom light won't turn on",
  description:
    "The bathroom light won't turn on\nTenant update: Only in that room\nTenant update: Yes",
  room_or_area: "Bedroom",
  location_question: "Which bathroom is it in?",
  diagnostic_facts: {
    electrical_scope: "Only in that room",
    unit_entry: "Yes",
  },
  preferred_contact_method: "text" as const,
}

Deno.test("bedroom answer to which bathroom names the bedroom bathroom", () => {
  const sms = buildConfirmationSummary(LIGHT)
  assertMatch(sms, /The light in the bedroom bathroom won't turn on\./)
  assertMatch(sms, /The issue is limited to that room\./)
  assertMatch(sms, /Staff or a vendor may enter if no one is home\./)
  assertEquals(/Electrical issue/i.test(sms), false)
  assertEquals(/Location: Bedroom/i.test(sms), false)
  assertEquals(confirmationClarification(LIGHT), null)
})

Deno.test("a clear location stays in the problem sentence", () => {
  const sms = buildConfirmationSummary({
    issue_type: "plumbing",
    vendor_trade: "plumbing",
    primary_category: "plumbing",
    initial_message: "The kitchen sink is leaking",
    description: "The kitchen sink is leaking",
    room_or_area: "kitchen",
    preferred_contact_method: "text",
  })
  assertMatch(sms, /The kitchen sink is leaking\./)
  assertEquals(/Plumbing issue/i.test(sms), false)
  assertEquals(/Location:/i.test(sms), false)
})

Deno.test("an ambiguous bathroom answer asks instead of guessing", () => {
  const state = {
    ...LIGHT,
    room_or_area: "over there",
    diagnostic_facts: {},
  }
  const question = confirmationClarification(state)
  assertMatch(question ?? "", /which bathroom did you mean/i)
  const sms = buildConfirmationSummary(state)
  assertMatch(sms, /Which bathroom did you mean\?/)
  assertEquals(/The light in the bedroom bathroom/i.test(sms), false)
  assertEquals(/over there/i.test(sms), false)
})

Deno.test("a corrected bathroom replaces the earlier answer", () => {
  const sms = buildConfirmationSummary({
    ...LIGHT,
    room_or_area: "hall bathroom",
    diagnostic_facts: { unit_entry: "Yes" },
  })
  assertMatch(sms, /The light in the hall bathroom won't turn on\./)
  assertEquals(/bedroom bathroom/i.test(sms), false)
})

Deno.test("a missing location is left out", () => {
  const sms = buildConfirmationSummary({
    issue_type: "HVAC",
    vendor_trade: "hvac",
    primary_category: "hvac",
    initial_message: "The AC isn't working.",
    description: "The AC isn't working.",
    preferred_contact_method: "text",
  })
  assertMatch(sms, /The AC isn't working\./)
  assertEquals(/Location:/i.test(sms), false)
  assertEquals(/\bin the\b/i.test(sms), false)
})

Deno.test("multiple open requests each keep their own problem and place", () => {
  const sms = buildConfirmationSummary({
    issue_type: "plumbing",
    vendor_trade: "plumbing",
    initial_message: "The sink is leaking and there are bees",
    description: "The sink is leaking and there are bees",
    pending_issues: [
      {
        summary: "The kitchen sink is leaking",
        description: "The kitchen sink is leaking",
        vendor_trade: "plumbing",
        issue_type: "plumbing",
        room_or_area: "kitchen",
      },
      {
        summary: "There are bees in the upstairs window",
        description: "There are bees in the upstairs window",
        vendor_trade: "pest_control",
        issue_type: "pest",
        room_or_area: "upstairs window",
      },
    ],
    preferred_contact_method: "text",
  })
  assertMatch(sms, /1\. The kitchen sink is leaking/)
  assertMatch(sms, /2\. There are bees in the upstairs window/)
  assertEquals(/Electrical issue|Plumbing issue/i.test(sms), false)
})

Deno.test("a gas emergency summary names the smell and keeps safety handling", () => {
  const sms = buildConfirmationSummary({
    vendor_trade: "other",
    primary_category: "general",
    initial_message: "I smell gas in the kitchen",
    description: "I smell gas in the kitchen",
    urgency: "emergency",
    preferred_contact_method: "text",
  })
  assertMatch(sms, /There is a gas smell in the kitchen\./)
  assertEquals(/thermostat|shutoff|GFCI|reset/i.test(sms), false)
})

Deno.test("the saved bathroom question can be read back from the thread", () => {
  const question = recoverLocationQuestion([
    { direction: "inbound", body: "The bathroom light won't turn on" },
    { direction: "outbound", body: "Which bathroom is it in?" },
    { direction: "inbound", body: "Bedroom" },
    { direction: "outbound", body: "Is power out only in that room, or in other parts of the home too?" },
  ])
  assertEquals(question, "Which bathroom is it in?")
  assertEquals(
    interpretConfirmedLocation({
      problem: "The bathroom light won't turn on",
      answer: "Bedroom",
      question,
    }).location,
    "bedroom bathroom",
  )
})
