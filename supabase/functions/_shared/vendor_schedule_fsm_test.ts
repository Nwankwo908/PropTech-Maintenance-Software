/// <reference lib="deno.ns" />
import {
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  createIdleScheduleState,
  isScheduleExpired,
  isStaleInbound,
  normalizeSmsBody,
  reduceScheduleFsm,
  wouldLoopOutbound,
} from "./vendor_schedule_fsm.ts"
import {
  buildVendorAvailabilityAskSms,
  buildVendorScheduleSoftConfirmSms,
} from "./vendor_outreach_copy.ts"

Deno.test("FSM: JOB_ACCEPTED → awaiting_availability", () => {
  const t = reduceScheduleFsm(null, {
    type: "JOB_ACCEPTED",
    ticketId: "t1",
    at: "2026-07-20T20:00:00.000Z",
  })
  assertEquals(t.state.step, "awaiting_availability")
  assertEquals(t.state.ticketId, "t1")
  assertEquals(t.effect.kind, "ask_availability")
  assertEquals(t.state.revision > 0, true)
  assertEquals(typeof t.state.expiresAt, "string")
})

Deno.test("FSM: YES while awaiting_availability clarifies (no re-ask loop)", () => {
  const started = reduceScheduleFsm(null, {
    type: "JOB_ACCEPTED",
    ticketId: "t1",
    at: "2026-07-20T20:00:00.000Z",
  })
  const yes = reduceScheduleFsm(started.state, {
    type: "CONFIRM_YES",
    at: "2026-07-20T20:01:00.000Z",
    inboundSid: "SM1",
  })
  assertEquals(yes.effect.kind, "clarify")
  assertEquals(yes.suppressReply, false)
})

Deno.test("FSM: soft confirm then YES persists", () => {
  const started = reduceScheduleFsm(null, {
    type: "JOB_ACCEPTED",
    ticketId: "t1",
    at: "2026-07-20T20:00:00.000Z",
  })
  const proposed = reduceScheduleFsm(started.state, {
    type: "AVAILABILITY_TEXT",
    at: "2026-07-20T20:01:00.000Z",
    inboundSid: "SM2",
    windowText: "Tomorrow 9-12pm",
    scheduledAt: "2026-07-21T13:00:00.000Z",
    outcome: "needs_confirmation",
  })
  assertEquals(proposed.state.step, "awaiting_confirmation")
  assertEquals(proposed.effect.kind, "soft_confirm")

  const yes = reduceScheduleFsm(proposed.state, {
    type: "CONFIRM_YES",
    at: "2026-07-20T20:02:00.000Z",
    inboundSid: "SM3",
  })
  assertEquals(yes.effect.kind, "persist")
  if (yes.effect.kind === "persist") {
    assertEquals(yes.effect.windowText, "Tomorrow 9-12pm")
  }
})

Deno.test("FSM: SAVE_FAIL keeps pending for YES lock-in", () => {
  const started = reduceScheduleFsm(null, {
    type: "JOB_ACCEPTED",
    ticketId: "t1",
    at: "2026-07-20T20:00:00.000Z",
  })
  const fail = reduceScheduleFsm(started.state, {
    type: "SAVE_FAIL",
    at: "2026-07-20T20:01:00.000Z",
    windowText: "Tomorrow 9-12pm",
    scheduledAt: "2026-07-21T13:00:00.000Z",
  })
  assertEquals(fail.state.step, "awaiting_confirmation")
  assertEquals(fail.state.pendingWindowText, "Tomorrow 9-12pm")
  assertEquals(fail.effect.kind, "save_retry")

  const yes = reduceScheduleFsm(fail.state, {
    type: "CONFIRM_YES",
    at: "2026-07-20T20:02:00.000Z",
    inboundSid: "SM9",
  })
  assertEquals(yes.effect.kind, "persist")
})

Deno.test("FSM: duplicate SID and stale inbound suppress reply", () => {
  const started = reduceScheduleFsm(null, {
    type: "JOB_ACCEPTED",
    ticketId: "t1",
    at: "2026-07-20T20:00:00.000Z",
    inboundSid: "SM1",
  })
  const withInbound = reduceScheduleFsm(started.state, {
    type: "AVAILABILITY_TEXT",
    at: "2026-07-20T20:05:00.000Z",
    inboundSid: "SM2",
    windowText: "Tomorrow 9am",
    scheduledAt: "2026-07-21T13:00:00.000Z",
    outcome: "resolved",
  })
  const dup = reduceScheduleFsm(withInbound.state, {
    type: "CONFIRM_YES",
    at: "2026-07-20T20:06:00.000Z",
    inboundSid: "SM2",
  })
  assertEquals(dup.suppressReply, true)
  assertEquals(dup.effect.kind, "noop")

  const stale = reduceScheduleFsm(withInbound.state, {
    type: "AVAILABILITY_TEXT",
    at: "2026-07-20T20:04:00.000Z",
    inboundSid: "SM0",
    windowText: "Tomorrow 10am",
    scheduledAt: "2026-07-21T14:00:00.000Z",
    outcome: "resolved",
  })
  assertEquals(stale.suppressReply, true)
  assertEquals(isStaleInbound(withInbound.state, "2026-07-20T20:04:00.000Z"), true)
})

Deno.test("FSM: TTL expiry clears active scheduling", () => {
  const started = reduceScheduleFsm(null, {
    type: "JOB_ACCEPTED",
    ticketId: "t1",
    at: "2026-07-19T20:00:00.000Z",
  })
  const expiredState = {
    ...started.state,
    expiresAt: "2026-07-19T21:00:00.000Z",
  }
  assertEquals(isScheduleExpired(expiredState, new Date("2026-07-20T20:00:00.000Z")), true)
  const late = reduceScheduleFsm(expiredState, {
    type: "CONFIRM_YES",
    at: "2026-07-20T20:00:00.000Z",
    inboundSid: "SMx",
  })
  assertEquals(late.effect.kind, "expired")
  assertEquals(late.state.step, "idle")
})

Deno.test("circuit breaker detects repeated outbound", () => {
  let state = createIdleScheduleState("t1")
  const ask = buildVendorAvailabilityAskSms()
  state = {
    ...state,
    recentOutboundNorm: [normalizeSmsBody(ask), normalizeSmsBody(ask)],
  }
  assertEquals(wouldLoopOutbound(state, ask, 1), true)
  assertEquals(
    wouldLoopOutbound(state, buildVendorScheduleSoftConfirmSms("Tomorrow 9am"), 1),
    false,
  )
})

Deno.test("stale schedule ticket differs from current job", () => {
  const started = reduceScheduleFsm(null, {
    type: "JOB_ACCEPTED",
    ticketId: "old-ticket",
    at: "2026-07-20T20:00:00.000Z",
  })
  assertEquals(started.state.ticketId, "old-ticket")
  assertEquals(started.state.ticketId === "new-ticket", false)
})
