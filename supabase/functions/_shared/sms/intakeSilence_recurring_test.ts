/**
 * Mark Henry mice report regression:
 * - "I've seen one repeatedly" must not trigger prior-visit / "same spot" framing
 *   without a real prior ticket.
 * - unit_entry accepts NOT SURE and silence policy can resolve.
 */
import {
  assertEquals,
  assertMatch,
} from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  applyDiagnosticAnswer,
  applyQuestionPlan,
  determineNextMaintenanceQuestion,
  isUnitEntryNotSure,
} from "./determineNextMaintenanceQuestion.ts"
import {
  applyRecurringIssueSignal,
  buildConfirmationSummary,
  headlineUpdateLine,
  issueSummaryBullet,
  type SmsIntakeState,
} from "./residentIntakeTypes.ts"
import {
  INTAKE_SILENCE_NUDGE_MS,
  INTAKE_SILENCE_RESOLVE_MS,
  classifyIntakeSilenceFollowUp,
} from "../../../../shared/ops/intakeSilenceFollowUp.ts"

const MARK_FREQ =
  "I've seen one repeatedly it was seen this morning running around the living room"

Deno.test("Mark Henry: repeatedly does not ask same-spot-as-last-time without prior ticket", () => {
  let state: SmsIntakeState = applyRecurringIssueSignal({
    issue_type: "pest",
    vendor_trade: "pest_control",
    primary_category: "pest",
    initial_message: "I've seen mice in my apartment",
    description:
      `I've seen mice in my apartment\nTenant update: ${MARK_FREQ}`,
    asked_question_types: ["pest_frequency"],
    diagnostic_facts: { pest_frequency: MARK_FREQ },
  })
  assertEquals(state.resident_reported_recurring, true)
  assertEquals(state.prior_related_ticket_id, undefined)

  const planned = applyQuestionPlan(state)
  assertEquals(planned.diagnostic_question_type, "pest_location")
  assertMatch(
    planned.diagnostic_question ?? "",
    /Where are you seeing them most/i,
  )
  assertEquals(
    /same spot as last time|someone'?s been out before|come up before/i.test(
      planned.diagnostic_question ?? "",
    ),
    false,
  )

  const headline = issueSummaryBullet(planned)
  const line = headlineUpdateLine(null, headline, {
    recurring: Boolean(planned.prior_related_ticket_id),
    priorVisitKnown: Boolean(planned.prior_related_ticket_id),
  })
  // First headline may still show "Got it — …" without prior-visit clause.
  assertEquals(/come up before/i.test(line ?? ""), false)
})

Deno.test("Mark Henry: prior ticket enables prior-visit location framing", () => {
  const next = determineNextMaintenanceQuestion({
    issue_type: "pest",
    vendor_trade: "pest_control",
    primary_category: "pest",
    initial_message: "I've seen mice in my apartment",
    description: `I've seen mice\nTenant update: ${MARK_FREQ}`,
    resident_reported_recurring: true,
    prior_related_ticket_id: "prior-pest-1",
    asked_question_types: ["pest_frequency"],
  })
  assertEquals(next.shouldAsk, true)
  if (next.shouldAsk) {
    assertEquals(next.questionType, "pest_location")
    assertMatch(next.question, /prior pest visit|same spot as last time/i)
  }
})

Deno.test("unit_entry NOT SURE unblocks intake", () => {
  assertEquals(isUnitEntryNotSure("not sure"), true)
  assertEquals(isUnitEntryNotSure("NOT SURE yet"), true)
  assertEquals(isUnitEntryNotSure("yes"), false)

  const answered = applyDiagnosticAnswer(
    {
      issue_type: "pest",
      vendor_trade: "pest_control",
      primary_category: "pest",
      step: "diagnostic",
      diagnostic_question_type: "unit_entry",
      diagnostic_question:
        "If you're not home, may staff or a vendor enter the unit to make the repair? Reply YES, NO, or NOT SURE.",
      asked_question_types: ["pest_frequency", "pest_location", "photo"],
      diagnostic_facts: {
        pest_frequency: MARK_FREQ,
        pest_location: "living room",
      },
      initial_message: "I've seen mice in my apartment",
      description:
        `I've seen mice in my apartment\nTenant update: ${MARK_FREQ}\nTenant update: living room`,
      room_or_area: "living room",
      photo_urls: [],
    },
    "not sure",
  )
  assertEquals(answered.diagnostic_facts?.unit_entry, "not_sure")
  const planned = applyQuestionPlan(answered)
  assertEquals(planned.step, "awaiting_confirm")
  const sms = buildConfirmationSummary(planned)
  assertMatch(sms, /Entry if not home: unconfirmed/i)
})

Deno.test("Mark Henry silence: one nudge then resolve, never repeat nudge", () => {
  const askedAt = "2026-09-29T20:37:24.000Z"
  const askedMs = Date.parse(askedAt)
  const snap = {
    conversationId: "4403fcad-a562-476b-8d0e-ecbdb50e9b3c",
    landlordId: "de300000-0000-4000-8000-000000000003",
    step: "diagnostic",
    diagnosticQuestionType: "unit_entry",
    diagnosticQuestion:
      "If you're not home, may staff or a vendor enter the unit to make the repair? Reply YES or NO.",
    openQuestionAskedAt: askedAt,
    silenceNudgeSentAt: null as string | null,
    silenceResolvedAt: null as string | null,
    draftTicketId: "f4129744-8af1-43bb-8763-606dd89a65b7",
    description: "I've seen mice in my apartment",
    issueHeadline: "Pest issue",
    issueType: "pest",
    vendorTrade: "pest_control",
    urgency: "low",
    urgencyAlertTier: null as null,
  }

  const nudge = classifyIntakeSilenceFollowUp(
    snap,
    askedMs + INTAKE_SILENCE_NUDGE_MS + 1,
  )
  assertEquals(nudge.action, "nudge")

  const waiting = classifyIntakeSilenceFollowUp(
    {
      ...snap,
      silenceNudgeSentAt: new Date(askedMs + INTAKE_SILENCE_NUDGE_MS).toISOString(),
    },
    askedMs + INTAKE_SILENCE_NUDGE_MS + 2 * 60 * 60 * 1000,
  )
  assertEquals(waiting.action, "skip")

  const resolve = classifyIntakeSilenceFollowUp(
    {
      ...snap,
      silenceNudgeSentAt: new Date(askedMs + INTAKE_SILENCE_NUDGE_MS).toISOString(),
    },
    askedMs + INTAKE_SILENCE_RESOLVE_MS + 1,
  )
  assertEquals(resolve.action, "resolve_unit_entry_unconfirmed")
})
