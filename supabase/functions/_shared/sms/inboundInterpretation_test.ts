/// <reference lib="deno.ns" />
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  accessInstructionKind,
  extractWeekdayPreference,
  formatRentDueDayLabel,
  heuristicInterpretInbound,
  looksLikePhotoSkip,
  nextStepForVendorStatus,
  parseResidentCalendarDate,
  shouldHandleInterpretedIntent,
  shouldSkipInboundInterpretation,
  shouldUnpinMaintenanceForInterpretation,
  shouldRejectMaintenanceTemplateForInterpretation,
} from "./inboundInterpretation.ts"

Deno.test("STOP/START/HELP skip the interpreter (fast path)", () => {
  assertEquals(shouldSkipInboundInterpretation("STOP"), true)
  assertEquals(shouldSkipInboundInterpretation("stop"), true)
  assertEquals(shouldSkipInboundInterpretation("HELP"), true)
  assertEquals(shouldSkipInboundInterpretation("START"), true)
  assertEquals(shouldSkipInboundInterpretation("The heater stopped working."), false)
  assertEquals(heuristicInterpretInbound("STOP").source, "fast_path_skip")
  assertEquals(shouldHandleInterpretedIntent(heuristicInterpretInbound("STOP"), "STOP"), false)
})

Deno.test("Tamara: copy of my lease is lease_info, not a repair", () => {
  const interp = heuristicInterpretInbound("Can you send me a copy of my lease?")
  assertEquals(interp.intent, "lease_info")
  assertEquals(interp.addressesPending, false)
  assertEquals(interp.needsClarification, false)
  assertEquals(
    shouldHandleInterpretedIntent(interp, "Can you send me a copy of my lease?"),
    true,
  )
  assertEquals(
    shouldUnpinMaintenanceForInterpretation(
      interp,
      "Can you send me a copy of my lease?",
    ),
    true,
  )
})

Deno.test("additional new issue unpins a stuck maintenance intake", () => {
  const interp = heuristicInterpretInbound("Also, my AC isn't working.")
  interp.extractedSlots.contextual_action = "new_issue"
  assertEquals(interp.intent, "maintenance_new")
  assertEquals(
    shouldHandleInterpretedIntent(interp, "Also, my AC isn't working."),
    false,
  )
  assertEquals(
    shouldUnpinMaintenanceForInterpretation(interp, "Also, my AC isn't working."),
    true,
  )
  assertEquals(
    shouldRejectMaintenanceTemplateForInterpretation(interp, "Also, my AC isn't working."),
    false,
  )
})

Deno.test("Tamara: copy of lease during urgency does not answer urgency", () => {
  const interp = heuristicInterpretInbound("Can you send me a copy of my lease?", {
    intakeStep: "urgency",
    activeIntake: true,
  })
  assertEquals(interp.intent, "lease_info")
  assertEquals(interp.addressesPending, false)
  assertEquals(shouldHandleInterpretedIntent(interp, "Can you send me a copy of my lease?"), true)
})

Deno.test("Tamara: Neither / not what I'm asking for is other, not urgency", () => {
  const neither = heuristicInterpretInbound("Neither", {
    intakeStep: "urgency",
    activeIntake: true,
  })
  assertEquals(neither.addressesPending, false)
  assertEquals(neither.intent, "other")

  const notAsking = heuristicInterpretInbound("Not what I'm asking for", {
    intakeStep: "urgency",
    activeIntake: true,
  })
  assertEquals(notAsking.addressesPending, false)
  assertEquals(notAsking.intent, "other")
})

Deno.test("urgency keyword still addresses the pending intake step", () => {
  const interp = heuristicInterpretInbound("It's urgent", {
    intakeStep: "urgency",
    activeIntake: true,
  })
  assertEquals(interp.addressesPending, true)
  assertEquals(interp.pendingAnswer, "urgent")
  assertEquals(shouldHandleInterpretedIntent(interp, "It's urgent"), false)
})

Deno.test("repair text still routes to maintenance_new", () => {
  const interp = heuristicInterpretInbound("My kitchen sink is leaking")
  assertEquals(interp.intent, "maintenance_new")
  assertEquals(shouldHandleInterpretedIntent(interp, "My kitchen sink is leaking"), false)
})

Deno.test("gas smell stays a maintenance/safety path (interpreter does not steal it)", () => {
  const interp = heuristicInterpretInbound("I smell gas in the kitchen")
  assertEquals(interp.intent, "maintenance_new")
  assertEquals(shouldHandleInterpretedIntent(interp, "I smell gas in the kitchen"), false)
})

Deno.test("heater stopped working is a new repair, not a cancel", () => {
  const interp = heuristicInterpretInbound("The heater stopped working.")
  assertEquals(interp.intent, "maintenance_new")
  assertEquals(shouldHandleInterpretedIntent(interp, "The heater stopped working."), false)
})

Deno.test("payment confirm replies are not handled as tenant intents", () => {
  assertEquals(shouldHandleInterpretedIntent(heuristicInterpretInbound("1"), "1"), false)
  assertEquals(shouldHandleInterpretedIntent(heuristicInterpretInbound("2"), "2"), false)
  assertEquals(shouldHandleInterpretedIntent(heuristicInterpretInbound("APPROVE"), "APPROVE"), false)
  assertEquals(shouldHandleInterpretedIntent(heuristicInterpretInbound("DECLINE"), "DECLINE"), false)
})

Deno.test("rent balance and repair status intents", () => {
  assertEquals(
    heuristicInterpretInbound("How much do I owe for rent?").intent,
    "rent_balance",
  )
  assertEquals(
    heuristicInterpretInbound("Any update on my work order?").intent,
    "maintenance_status",
  )
  assertEquals(
    heuristicInterpretInbound("When is my electrician coming ?").intent,
    "maintenance_status",
  )
  assertEquals(
    heuristicInterpretInbound("When is the electrician coming to fix the issue?").intent,
    "maintenance_status",
  )
  assertEquals(
    heuristicInterpretInbound("Do you know when the electrician is coming?").intent,
    "maintenance_status",
  )
  assertEquals(
    heuristicInterpretInbound("When's the electrician coming?").intent,
    "maintenance_status",
  )
  assertEquals(
    heuristicInterpretInbound("When will the electrician be here?").intent,
    "maintenance_status",
  )
  assertEquals(
    shouldHandleInterpretedIntent(
      heuristicInterpretInbound("When is the electrician coming to fix the issue?"),
      "When is the electrician coming to fix the issue?",
    ),
    true,
  )
  assertEquals(
    heuristicInterpretInbound("The sink is still leaking").intent,
    "maintenance_update",
  )
  assertEquals(
    heuristicInterpretInbound("Can we reschedule the appointment?").intent,
    "schedule_change",
  )
  assertEquals(
    heuristicInterpretInbound("The key is under the mat").intent,
    "access_instruction",
  )
})

Deno.test("leasing questions are lease_info, not a repair", () => {
  assertEquals(
    heuristicInterpretInbound("I'm interested in leasing").intent,
    "lease_info",
  )
  assertEquals(
    heuristicInterpretInbound("Can I get my rental agreement?").intent,
    "lease_info",
  )
  assertEquals(
    shouldHandleInterpretedIntent(
      heuristicInterpretInbound("I'm interested in leasing"),
      "I'm interested in leasing",
    ),
    true,
  )
})

Deno.test("lease renewal wording is not stolen as lease_info", () => {
  const body = "I want to renew my lease"
  const interp = heuristicInterpretInbound(body)
  assertEquals(interp.intent !== "lease_info", true)
  assertEquals(shouldHandleInterpretedIntent(interp, body), false)
})

Deno.test("YES on a pending work-order update confirm stays maintenance_update", () => {
  const pending = {
    awaitingTicketUpdateConfirm: true,
    activeIntake: false,
    draftTicketId: "ticket-1",
  }
  const yes = heuristicInterpretInbound("YES", pending)
  assertEquals(yes.intent, "maintenance_update")
  assertEquals(yes.pendingAnswer, "yes")
  assertEquals(shouldHandleInterpretedIntent(yes, "YES", pending), true)

  const no = heuristicInterpretInbound("NO", pending)
  assertEquals(no.intent, "maintenance_update")
  assertEquals(no.pendingAnswer, "no")
  assertEquals(shouldHandleInterpretedIntent(no, "NO", pending), true)
})

Deno.test("rent subtopics: due date, monthly rent, payment link, payment status", () => {
  assertEquals(
    heuristicInterpretInbound("When is my rent due?").extractedSlots.topic,
    "due_date",
  )
  assertEquals(
    heuristicInterpretInbound("How much is my rent?").extractedSlots.topic,
    "monthly_rent",
  )
  assertEquals(
    heuristicInterpretInbound("Can you send me the payment link?").extractedSlots.topic,
    "payment_link",
  )
  assertEquals(
    heuristicInterpretInbound("Did you get my rent payment?").extractedSlots.topic,
    "payment_status",
  )
  assertEquals(
    shouldHandleInterpretedIntent(
      heuristicInterpretInbound("When is my rent due?"),
      "When is my rent due?",
    ),
    true,
  )
})

Deno.test("late rent is rent_late, not a repair", () => {
  const interp = heuristicInterpretInbound("I'm going to be late on rent")
  assertEquals(interp.intent, "rent_late")
  assertEquals(shouldHandleInterpretedIntent(interp, "I'm going to be late on rent"), true)
})

Deno.test("cancel repair intent and YES confirm", () => {
  const ask = heuristicInterpretInbound("Please cancel the work order")
  assertEquals(ask.intent, "maintenance_cancel")
  assertEquals(shouldHandleInterpretedIntent(ask, "Please cancel the work order"), true)

  const pending = {
    awaitingTicketCancelConfirm: true,
    activeIntake: false,
    draftTicketId: "ticket-1",
  }
  const yes = heuristicInterpretInbound("YES", pending)
  assertEquals(yes.intent, "maintenance_cancel")
  assertEquals(yes.pendingAnswer, "yes")
  assertEquals(shouldHandleInterpretedIntent(yes, "YES", pending), true)
})

Deno.test("natural cancel phrases stop the current request, including mid-intake", () => {
  const phrases = [
    "Cancel it",
    "Cancel the work order",
    "Never mind",
    "I don't need it",
    "I already fixed it",
    "It's working",
    "Forget it",
    "Never mind, I fixed it",
    "It's working now",
    "It's fine now",
  ]
  for (const phrase of phrases) {
    const interp = heuristicInterpretInbound(phrase)
    assertEquals(interp.intent, "maintenance_cancel", phrase)
    assertEquals(shouldHandleInterpretedIntent(interp, phrase), true, phrase)
  }

  const duringIntake = heuristicInterpretInbound("Never mind", {
    intakeStep: "urgency",
    activeIntake: true,
  })
  assertEquals(duringIntake.intent, "maintenance_cancel")
  assertEquals(duringIntake.addressesPending, false)
  assertEquals(
    shouldHandleInterpretedIntent(duringIntake, "Never mind", {
      intakeStep: "urgency",
      activeIntake: true,
    }),
    true,
  )

  assertEquals(
    heuristicInterpretInbound("Never mind, I meant the bathroom, not the kitchen.")
      .extractedSlots.kind,
    "correction",
  )

  // Bare "Cancel" is a carrier STOP keyword, not a work-order cancel.
  assertEquals(shouldSkipInboundInterpretation("Cancel"), true)
  assertEquals(heuristicInterpretInbound("Cancel").source, "fast_path_skip")
})

Deno.test("move-out date capture and YES confirm", () => {
  const ask = heuristicInterpretInbound("I'm moving out August 30")
  assertEquals(ask.intent, "move_out_intent")
  assertEquals(ask.extractedSlots.move_out_date?.endsWith("-08-30"), true)
  assertEquals(shouldHandleInterpretedIntent(ask, "I'm moving out August 30"), true)

  const pending = { awaitingMoveOutConfirm: true, activeIntake: false }
  const yes = heuristicInterpretInbound("YES", pending)
  assertEquals(yes.intent, "move_out_intent")
  assertEquals(yes.pendingAnswer, "yes")
  assertEquals(shouldHandleInterpretedIntent(yes, "YES", pending), true)
})

Deno.test("follow-up phrases do not start a new repair workflow", () => {
  assertEquals(heuristicInterpretInbound("It's getting worse.").intent, "maintenance_update")
  assertEquals(heuristicInterpretInbound("Tomorrow doesn't work.").intent, "schedule_change")
  assertEquals(heuristicInterpretInbound("They never showed up.").extractedSlots.kind, "no_show")
  assertEquals(heuristicInterpretInbound("It broke again.").extractedSlots.kind, "reopen")
  assertEquals(heuristicInterpretInbound("Here's a better picture.").extractedSlots.kind, "photo")
  assertEquals(heuristicInterpretInbound("Never mind, I fixed it.").intent, "maintenance_cancel")
  assertEquals(heuristicInterpretInbound("Can they come after 5?").intent, "schedule_change")
  assertEquals(
    heuristicInterpretInbound("I meant the bathroom, not the kitchen.").extractedSlots.kind,
    "correction",
  )
})

Deno.test("reopen vs worse vs ordinary update", () => {
  assertEquals(
    heuristicInterpretInbound("The leak wasn't fixed").extractedSlots.kind,
    "reopen",
  )
  assertEquals(
    heuristicInterpretInbound("It's getting worse").extractedSlots.kind,
    "worse",
  )
  assertEquals(
    heuristicInterpretInbound("The sink is still leaking").extractedSlots.kind,
    "update",
  )
})

Deno.test("schedule change extracts weekday preference", () => {
  const interp = heuristicInterpretInbound("Can we reschedule to Thursday?")
  assertEquals(interp.intent, "schedule_change")
  assertEquals(interp.extractedSlots.preferred_day, "Thursday")
  assertEquals(extractWeekdayPreference("Can we reschedule to Thursday?"), "Thursday")
})

Deno.test("access allow vs restrict", () => {
  const allow = heuristicInterpretInbound("You can let the plumber in, I won't be home")
  assertEquals(allow.intent, "access_instruction")
  assertEquals(allow.extractedSlots.access_kind, "allow")
  assertEquals(accessInstructionKind("I won't be home, vendor can enter"), "allow")

  const restrict = heuristicInterpretInbound("Don't enter unless I'm home")
  assertEquals(restrict.intent, "access_instruction")
  assertEquals(restrict.extractedSlots.access_kind, "restrict")
  assertEquals(accessInstructionKind("Don't enter unless I'm home"), "restrict")
})

Deno.test("parseResidentCalendarDate handles named and numeric dates", () => {
  assertEquals(parseResidentCalendarDate("August 30, 2027"), "2027-08-30")
  assertEquals(parseResidentCalendarDate("8/30/2027"), "2027-08-30")
  assertEquals(parseResidentCalendarDate("2027-08-30"), "2027-08-30")
})

Deno.test("formatRentDueDayLabel and next-step copy", () => {
  const label = formatRentDueDayLabel(1, new Date("2026-08-15T12:00:00"))
  assertEquals(label, "September 1, 2026")
  assertEquals(
    nextStepForVendorStatus("pending_accept", false),
    "Next: waiting for the vendor to accept. We'll follow up if they don't.",
  )
  assertEquals(
    nextStepForVendorStatus("accepted", true),
    "Next: no action needed unless that time doesn't work.",
  )
})

Deno.test("photo-only MMS answers an active photo step and does not start a follow-up", () => {
  const pending = {
    intakeStep: "photo" as const,
    activeIntake: true,
    draftTicketId: "f671-draft",
    hasMedia: true,
  }
  const interp = heuristicInterpretInbound("", pending)
  assertEquals(interp.addressesPending, true)
  assertEquals(interp.pendingAnswer, "photo")
  assertEquals(shouldHandleInterpretedIntent(interp, "", pending), false)
  assertEquals(looksLikePhotoSkip("SKIP"), true)
  assertEquals(looksLikePhotoSkip(""), false)
})

Deno.test("SKIP answers the photo step", () => {
  const pending = { intakeStep: "photo" as const, activeIntake: true, hasMedia: false }
  const interp = heuristicInterpretInbound("SKIP", pending)
  assertEquals(interp.addressesPending, true)
  assertEquals(interp.pendingAnswer, "skip")
  assertEquals(shouldHandleInterpretedIntent(interp, "SKIP", pending), false)
})

Deno.test("summary YES stays on intake so the request can submit", () => {
  const pending = { intakeStep: "awaiting_confirm" as const, activeIntake: true }
  const interp = heuristicInterpretInbound("YES", pending)
  assertEquals(interp.addressesPending, true)
  assertEquals(interp.pendingAnswer, "yes")
  assertEquals(shouldHandleInterpretedIntent(interp, "YES", pending), false)
})

Deno.test("urgency answer continues intake; lease question does not", () => {
  const pending = { intakeStep: "urgency" as const, activeIntake: true }
  const urgency = heuristicInterpretInbound("emergency", pending)
  assertEquals(urgency.addressesPending, true)
  assertEquals(shouldHandleInterpretedIntent(urgency, "emergency", pending), false)

  const lease = heuristicInterpretInbound("When does my lease expire?", pending)
  assertEquals(lease.intent, "lease_info")
  assertEquals(lease.addressesPending, false)
  assertEquals(shouldHandleInterpretedIntent(lease, "When does my lease expire?", pending), true)
})

Deno.test("photo follow-up without an active photo step is not a pending answer", () => {
  const interp = heuristicInterpretInbound("Here's a better picture.")
  assertEquals(interp.addressesPending, false)
  assertEquals(interp.extractedSlots.kind, "photo")
  assertEquals(
    shouldHandleInterpretedIntent(interp, "Here's a better picture."),
    true,
  )
})
