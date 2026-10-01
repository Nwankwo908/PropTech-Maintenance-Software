/**
 * Deno tests: recurring pest intake confirmation + follow-up shape.
 */
import {
  assertEquals,
  assertMatch,
} from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  applyQuestionPlan,
  determineNextMaintenanceQuestion,
} from "./determineNextMaintenanceQuestion.ts"
import {
  applyRecurringIssueSignal,
  buildConfirmationSummary,
  headlineUpdateLine,
  issueSummaryBullet,
  type SmsIntakeState,
} from "./residentIntakeTypes.ts"

const BYRON_DESC =
  "Hi and thank you I was trying to see if an exterminator can come out to spray the property\nTenant update: Repeatedly this isn't the first time someone came out before."

Deno.test("Byron: issueSummaryBullet does not echo raw greeting / Tenant update", () => {
  const state: SmsIntakeState = {
    issue_type: "pest",
    vendor_trade: "pest_control",
    primary_category: "pest",
    initial_message:
      "Hi and thank you I was trying to see if an exterminator can come out to spray the property",
    description: BYRON_DESC,
  }
  const headline = issueSummaryBullet(state)
  assertMatch(headline, /pest/i)
  assertEquals(/hi and thank you/i.test(headline), false)
  assertEquals(/tenant update/i.test(headline), false)
})

Deno.test("Byron: confirmation claims prior visit only when a prior ticket is known", () => {
  const state = applyRecurringIssueSignal({
    issue_type: "pest",
    vendor_trade: "pest_control",
    primary_category: "pest",
    initial_message:
      "Hi and thank you I was trying to see if an exterminator can come out to spray the property",
    description: BYRON_DESC,
    acknowledged_headline: "Hi and thank you I was trying to see if an exterminator can come out to spray the property",
    prior_related_ticket_id: "prior-ticket-1",
  })
  assertEquals(state.resident_reported_recurring, true)
  const headline = issueSummaryBullet(state)
  const line = headlineUpdateLine(state.acknowledged_headline, headline, {
    recurring: true,
    priorVisitKnown: true,
  })
  assertMatch(line ?? "", /Got it —/i)
  assertMatch(line ?? "", /come up .* before/i)
  assertEquals(/I've updated this to/i.test(line ?? ""), false)
  assertEquals(/Tenant update/i.test(line ?? ""), false)
  assertEquals(/Hi and thank you/i.test(line ?? ""), false)
})

Deno.test("Byron: same-spot follow-up requires a real prior ticket", () => {
  const withoutPrior = applyQuestionPlan({
    issue_type: "pest",
    vendor_trade: "pest_control",
    primary_category: "pest",
    initial_message:
      "Hi and thank you I was trying to see if an exterminator can come out to spray the property",
    description: BYRON_DESC,
    resident_reported_recurring: true,
  })
  assertEquals(withoutPrior.diagnostic_question_type, "pest_location")
  assertMatch(
    withoutPrior.diagnostic_question ?? "",
    /Where are you seeing them most/i,
  )
  assertEquals(
    /same spot as last time|someone'?s been out before/i.test(
      withoutPrior.diagnostic_question ?? "",
    ),
    false,
  )

  const planned = applyQuestionPlan({
    issue_type: "pest",
    vendor_trade: "pest_control",
    primary_category: "pest",
    initial_message:
      "Hi and thank you I was trying to see if an exterminator can come out to spray the property",
    description: BYRON_DESC,
    resident_reported_recurring: true,
    prior_related_ticket_id: "prior-ticket-1",
  })
  assertEquals(planned.resident_reported_recurring, true)
  assertEquals(planned.step, "diagnostic")
  assertEquals(planned.diagnostic_question_type, "pest_location")
  assertMatch(
    planned.diagnostic_question ?? "",
    /same spot as last time|same issue coming back|prior pest visit/i,
  )
})

Deno.test("Byron: prior ticket id shapes the follow-up", () => {
  const next = determineNextMaintenanceQuestion({
    issue_type: "pest",
    vendor_trade: "pest_control",
    primary_category: "pest",
    initial_message: "Need an exterminator again",
    description: "Need an exterminator again — someone came out before",
    resident_reported_recurring: true,
    prior_related_ticket_id: "prior-ticket-1",
    asked_question_types: ["pest_frequency"],
  })
  assertEquals(next.shouldAsk, true)
  if (next.shouldAsk) {
    assertEquals(next.questionType, "pest_location")
    assertMatch(next.question, /prior pest visit/i)
  }
})

Deno.test("Byron: pre-submit confirmation omits fake Availability and raw first message", () => {
  const first =
    "Hi and thank you I was trying to see if an exterminator can come out to spray the property"
  const sms = buildConfirmationSummary({
    issue_type: "pest",
    vendor_trade: "pest_control",
    primary_category: "pest",
    initial_message: first,
    description:
      `${first}\nTenant update: Repeatedly this isn't the first time someone came out before.`,
    // Stale / mistaken extract from the opening ask — must not render.
    preferred_visit_windows: first,
    resident_reported_recurring: true,
    prior_related_ticket_id: "prior-ticket-1",
    diagnostic_facts: {
      pest_frequency: "Repeatedly this isn't the first time someone came out before",
      unit_entry: "yes",
    },
    photo_urls: ["https://example.com/p.jpg"],
    preferred_contact_method: "text",
  })

  assertEquals(/Availability:/i.test(sms), false, "no availability line")
  assertEquals(sms.includes(first), false, "raw first message never appears")
  assertEquals(/Tenant update:/i.test(sms), false, "no Tenant update scaffolding")
  assertEquals(/[“"].*[”"]/u.test(sms), false, "issue line is not quoted")
  assertMatch(sms, /pest control/i, "classified issue")
  assertMatch(sms, /exterminator/i, "exterminator in title phrase")
  assertMatch(sms, /Recurring issue — .+ has come up before/i, "recurring fact")
  assertEquals(/Repeatedly this isn't the first time/i.test(sms), false, "no raw recurring quote")
  assertMatch(sms, /Until help arrives/i, "safety tip")
  assertMatch(sms, /OK to enter if not home/i, "entry mapped")
  assertMatch(sms, /Photo attached/i, "photo")

  const issueIdx = sms.search(/pest control/i)
  const tipIdx = sms.search(/Until help arrives/i)
  const recurIdx = sms.search(/Recurring issue/i)
  assertEquals(issueIdx >= 0 && tipIdx > issueIdx, true, "tip after issue")
  assertEquals(recurIdx > tipIdx, true, "bullets after tip")
})

Deno.test(
  "concatenated description with tunneling + fake availability: pre-submit still omits availability",
  () => {
    const first =
      "Hi and thank you I was trying to see if an exterminator can come out to spray the property"
    const description = [
      first,
      "Tenant update: Repeatedly this isn't the first time someone came out before.",
      "Tenant update: There is tunneling near the foundation by the back porch",
      `Resident availability: ${first}`,
    ].join("\n")
    const sms = buildConfirmationSummary({
      issue_type: "pest",
      vendor_trade: "pest_control",
      primary_category: "pest",
      initial_message: first,
      description,
      preferred_visit_windows: first,
      resident_reported_recurring: true,
      diagnostic_facts: { unit_entry: "yes" },
    })
    assertEquals(/Availability:/i.test(sms), false, "no fake availability")
    assertEquals(sms.includes(first), false, "raw greeting never appears")
    assertMatch(sms, /pest control/i)
  },
)
