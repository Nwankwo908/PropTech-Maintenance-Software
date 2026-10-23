/// <reference lib="deno.ns" />
import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts"
import { canVendorSmsAcceptStatus } from "../vendor_workflow.ts"
import { resolveVendorAvailability } from "../vendor_availability_parse.ts"
import {
  createIdleScheduleState,
  extendScheduleTtlForActivity,
  isScheduleExpired,
  reduceScheduleFsm,
  SCHEDULE_TTL_MS,
} from "../vendor_schedule_fsm.ts"
import {
  buildVendorAvailabilityAskSms,
  buildVendorSmsReplyPrompt,
} from "../vendor_outreach_copy.ts"
import {
  buildEstimateDecisionStatusSms,
  resolveEstimateScheduleKickoff,
} from "./workOrderAdminStatusSms.ts"
import { planAcceptedVendorIdleTurn } from "./acceptedVendorSchedule.ts"

const TICKET = "fd7b0000-0000-4000-8000-000000000001"
const ASKED_AT = "2026-10-21T18:00:00.000Z"
const NOW = new Date("2026-10-22T18:00:00.000Z")

Deno.test("accepted vendor + idle FSM + Yes restarts scheduling", () => {
  const plan = planAcceptedVendorIdleTurn({
    inScheduleFlow: false,
    parsedAction: "accept",
    vendorWorkStatus: "accepted",
    visitLocked: false,
    availabilityResolved: false,
  })
  assertEquals(plan.kind, "restart_availability")

  const reduced = reduceScheduleFsm(createIdleScheduleState(TICKET), {
    type: "JOB_ACCEPTED",
    ticketId: TICKET,
    at: ASKED_AT,
  })
  assertEquals(reduced.state.step, "awaiting_availability")
  assertEquals(reduced.effect.kind, "ask_availability")

  const ask = buildVendorAvailabilityAskSms("WO-FD7B")
  const acceptPrompt = buildVendorSmsReplyPrompt("WO-FD7B")
  assertStringIncludes(ask, "day and arrival window")
  assertEquals(ask.includes("Would you like to take this job"), false)
  assertStringIncludes(acceptPrompt, "Would you like to take this job")
  assertEquals(ask.includes(acceptPrompt), false)
})

Deno.test("accepted vendor + idle FSM seeds a parsed arrival window", async () => {
  const body = "We could do 9 - 11am ETA for tomorrow"
  const resolved = await resolveVendorAvailability(body, {
    allowLlm: false,
    now: NOW,
    timeZone: "America/New_York",
  })
  assertEquals(resolved.status, "resolved")
  if (resolved.status !== "resolved") return

  const plan = planAcceptedVendorIdleTurn({
    inScheduleFlow: false,
    parsedAction: null,
    vendorWorkStatus: "accepted",
    visitLocked: false,
    availabilityResolved: true,
  })
  assertEquals(plan.kind, "seed_window")

  const reduced = reduceScheduleFsm(createIdleScheduleState(TICKET), {
    type: "AVAILABILITY_TEXT",
    at: NOW.toISOString(),
    windowText: resolved.value.windowLabel,
    scheduledAt: resolved.value.scheduledAt,
    endAt: resolved.value.endAt,
    outcome: "resolved",
  })
  assertEquals(reduced.state.step, "awaiting_tenant_confirmation")
  assertEquals(reduced.effect.kind, "ask_tenant")
  if (reduced.effect.kind === "ask_tenant") {
    assertStringIncludes(reduced.effect.windowText, "9:00 AM")
    assertStringIncludes(reduced.effect.windowText, "11:00 AM")
  }
  const acceptPrompt = buildVendorSmsReplyPrompt("WO-FD7B")
  assertEquals(
    (reduced.effect.kind === "ask_tenant" ? reduced.effect.windowText : "").includes(
      "Would you like to take this job",
    ),
    false,
  )
  assertStringIncludes(acceptPrompt, "Would you like to take this job")
})

Deno.test("estimate 20h after the ask keeps the schedule thread alive at 24h", () => {
  const opened = reduceScheduleFsm(createIdleScheduleState(TICKET), {
    type: "JOB_ACCEPTED",
    ticketId: TICKET,
    at: ASKED_AT,
  }).state
  const estimateAt = new Date(Date.parse(ASKED_AT) + 20 * 60 * 60 * 1000).toISOString()
  const kept = extendScheduleTtlForActivity(opened, estimateAt)
  const checkAt = new Date(Date.parse(ASKED_AT) + SCHEDULE_TTL_MS + 60_000)

  assertEquals(isScheduleExpired(opened, checkAt), true)
  assertEquals(isScheduleExpired(kept, checkAt), false)

  const ttl = reduceScheduleFsm(kept, {
    type: "TTL_CHECK",
    at: checkAt.toISOString(),
    vendorAccepted: true,
    workOrderRef: "WO-FD7B",
  })
  assertEquals(ttl.effect.kind, "noop")
  assertEquals(ttl.state.step, "awaiting_availability")
})

Deno.test("accepted vendor timeout asks for a time, not another YES", () => {
  const opened = reduceScheduleFsm(createIdleScheduleState(TICKET), {
    type: "JOB_ACCEPTED",
    ticketId: TICKET,
    at: ASKED_AT,
  }).state
  const late = new Date(Date.parse(opened.expiresAt) + 60_000).toISOString()
  const accepted = reduceScheduleFsm(opened, {
    type: "TTL_CHECK",
    at: late,
    vendorAccepted: true,
    workOrderRef: "WO-FD7B",
  })
  assertEquals(accepted.effect.kind, "expired")
  if (accepted.effect.kind === "expired") {
    assertEquals(
      accepted.effect.prompt,
      "Still need a time for WO-FD7B. Reply with a day and arrival window (e.g. Wed 9am–12pm).",
    )
  }

  const pending = reduceScheduleFsm(opened, { type: "TTL_CHECK", at: late })
  assertEquals(pending.effect.kind, "expired")
  if (pending.effect.kind === "expired") {
    assertStringIncludes(pending.effect.prompt, "Reply YES if you still want the job")
  }
})

Deno.test("estimate approval confirms a saved vendor window", () => {
  const windowText = "Friday, Oct 23 between 9:00 AM and 11:00 AM"
  const kickoff = resolveEstimateScheduleKickoff({
    approved: true,
    vendorDecision: "accepted",
    scheduleStep: "idle",
    ticketId: TICKET,
    fsmPendingWindowText: windowText,
    fsmPendingScheduledAt: "2026-10-23T13:00:00.000Z",
  })
  assertEquals(kickoff.kind, "confirm_tenant")
  if (kickoff.kind !== "confirm_tenant") return

  const body = buildEstimateDecisionStatusSms({
    vendorName: "Ecosafe",
    workOrderRef: "WO-FD7B",
    approved: true,
    totalCost: 180,
    vendorDecision: "accepted",
    confirmingWindowText: kickoff.windowText,
    includeScheduleAsk: false,
  })
  if (!body) throw new Error("expected an approval SMS")
  assertStringIncludes(body, "We're confirming")
  assertStringIncludes(body, windowText)
  assertEquals(body.includes("earliest availability"), false)
  assertEquals(body.includes("Would you like to take this job"), false)

  const recent = resolveEstimateScheduleKickoff({
    approved: true,
    vendorDecision: "accepted",
    scheduleStep: "idle",
    ticketId: TICKET,
    recentInboundWindowText: windowText,
    recentInboundScheduledAt: "2026-10-23T13:00:00.000Z",
  })
  assertEquals(recent.kind, "confirm_tenant")

  const asked = resolveEstimateScheduleKickoff({
    approved: true,
    vendorDecision: "accepted",
    scheduleStep: "idle",
    ticketId: TICKET,
    lastAvailabilityAskAt: "2026-10-22T17:55:00.000Z",
    now: NOW,
  })
  assertEquals(asked.kind, "none")
})

Deno.test("pending vendor Yes still accepts and asks for availability", () => {
  const plan = planAcceptedVendorIdleTurn({
    inScheduleFlow: false,
    parsedAction: "accept",
    vendorWorkStatus: "pending_accept",
    visitLocked: false,
    availabilityResolved: false,
  })
  assertEquals(plan.kind, "passthrough")
  assertEquals(canVendorSmsAcceptStatus("pending_accept"), true)
  assertEquals(canVendorSmsAcceptStatus("accepted"), false)

  const reduced = reduceScheduleFsm(null, {
    type: "JOB_ACCEPTED",
    ticketId: TICKET,
    at: ASKED_AT,
  })
  assertEquals(reduced.state.step, "awaiting_availability")
  assertEquals(reduced.effect.kind, "ask_availability")
  assertStringIncludes(buildVendorAvailabilityAskSms("WO-FD7B"), "earliest availability")
})
