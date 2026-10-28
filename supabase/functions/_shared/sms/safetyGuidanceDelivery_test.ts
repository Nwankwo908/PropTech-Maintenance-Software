import { assertEquals, assertMatch } from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  LIFE_SAFETY_GUIDANCE,
  undeliveredGuidance,
} from "../../../../shared/maintenance/safetyGuidanceDelivery.ts"
import { buildConfirmationSummary } from "./residentIntakeTypes.ts"
import { buildRequestSubmittedSms } from "./multiIssueIntake.ts"

const ELECTRICAL_TIP =
  "Until help arrives: don't touch the outlet, panel, or any wet area near the problem. Flip the breaker off only if you can do so safely."
const SPARK_TIP =
  "Until help arrives: leave that area and don't touch the outlet, panel, or anything wet nearby. We'll get an electrician out as quickly as we can."

const deliveredSummary = {
  direction: "outbound",
  providerStatus: "delivered",
  body: [
    "Got it. Here's the request:",
    "",
    "The light in the bedroom bathroom won't turn on.",
    "",
    ELECTRICAL_TIP,
  ].join("\n"),
}

Deno.test("a delivered summary is not repeated on the next text", () => {
  assertEquals(undeliveredGuidance([ELECTRICAL_TIP], [deliveredSummary]), [])
})

Deno.test("repeated summaries stay quiet after one delivery", () => {
  assertEquals(undeliveredGuidance([ELECTRICAL_TIP], [
    { direction: "outbound", providerStatus: "failed", body: ELECTRICAL_TIP },
    { direction: "outbound", providerStatus: "sent", body: ELECTRICAL_TIP },
    deliveredSummary,
  ]), [])
})

Deno.test("a failed or unconfirmed send still carries the guidance", () => {
  assertEquals(
    undeliveredGuidance([ELECTRICAL_TIP], [{
      direction: "outbound",
      providerStatus: "failed",
      body: ELECTRICAL_TIP,
    }]),
    [ELECTRICAL_TIP],
  )
  assertEquals(
    undeliveredGuidance([ELECTRICAL_TIP], [{
      direction: "outbound",
      providerStatus: "undelivered",
      body: ELECTRICAL_TIP,
    }]),
    [ELECTRICAL_TIP],
  )
  assertEquals(
    undeliveredGuidance([ELECTRICAL_TIP], [{
      direction: "outbound",
      providerStatus: "sent",
      body: ELECTRICAL_TIP,
    }]),
    [ELECTRICAL_TIP],
  )
  assertEquals(
    undeliveredGuidance([ELECTRICAL_TIP], [{
      direction: "inbound",
      providerStatus: "delivered",
      body: ELECTRICAL_TIP,
    }]),
    [ELECTRICAL_TIP],
  )
})

Deno.test("a change in risk still sends the new guidance", () => {
  assertEquals(
    undeliveredGuidance([SPARK_TIP], [deliveredSummary]),
    [SPARK_TIP],
  )
})

Deno.test("undelivered emergency guidance is kept and a delivered one is not", () => {
  assertEquals(undeliveredGuidance([LIFE_SAFETY_GUIDANCE], []), [LIFE_SAFETY_GUIDANCE])
  assertEquals(undeliveredGuidance([LIFE_SAFETY_GUIDANCE], [{
    direction: "outbound",
    providerStatus: "delivered",
    body: `Hi Sam,\n\n${LIFE_SAFETY_GUIDANCE}`,
  }]), [])
  assertEquals(undeliveredGuidance([LIFE_SAFETY_GUIDANCE], [{
    direction: "outbound",
    providerStatus: "failed",
    body: LIFE_SAFETY_GUIDANCE,
  }]), [LIFE_SAFETY_GUIDANCE])
})

Deno.test("a reprinted summary can leave out guidance that already arrived", () => {
  const state = {
    step: "awaiting_confirm" as const,
    initial_message: "The bathroom light won't turn on",
    issue_type: "electrical",
    vendor_trade: "electrical",
    primary_category: "electrical",
    room_or_area: "Bedroom",
    location_question: "Which bathroom is it in?",
    diagnostic_facts: {
      electrical_scope: "Only in that room",
      unit_entry: "Yes",
    },
  }
  const reprinted = buildConfirmationSummary(state, { handlingTip: null })
  assertEquals(/Until help arrives/i.test(reprinted), false)
  assertMatch(reprinted, /The light in the bedroom bathroom won't turn on/)
  const first = buildConfirmationSummary(state)
  assertMatch(first, /Until help arrives/i)
})

Deno.test("the submit confirmation names the bathroom light and the existing ref", () => {
  const sms = buildRequestSubmittedSms(
    "eb1d7cfc-3d70-4f57-bd59-680bdb997120",
    false,
    null,
    {
      categoryLabel: "electrical",
      sourceText: "The bathroom light won't turn on\nTenant update: Only in that room",
      requestRef: "EB1D7CFC",
      handlingTip: null,
    },
  )
  assertEquals(
    sms,
    "Thanks! We've received your bathroom light request. We'll text you here with updates.\n\nRef: EB1D7CFC",
  )
})
