import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import { shouldYieldPendingAskToRepair } from "./pendingAskRepairReport.ts"
import { tryHandleStaffReplyInbound } from "./staffReplyPending.ts"
import { tryHandleTenantScheduleConfirmInbound } from "./tenantScheduleConfirm.ts"

for (const body of [
  "Hi, separate issue: the bathroom ceiling light stopped working.",
  "My kitchen sink is leaking underneath.",
  "New separate repair: the bedroom closet door is off its track.",
  "The upstairs bathroom bathtub drains slowly. There is no overflow.",
  "The kitchen cabinet door has a loose hinge.",
  "There is no heat in my apartment.",
  "Yes, thanks, but my bathroom light stopped working.",
  "I smell gas in the kitchen.",
]) {
  Deno.test(`pending ask yields to repair report: ${body}`, () => {
    assertEquals(shouldYieldPendingAskToRepair(body), true)
  })
  Deno.test(`repair breakout has no specialist reads or effects: ${body}`, async () => {
    // An empty client throws if either specialist tries privileged I/O.
    const params = { landlordId: "sim-account", conversationId: "sim-thread", messageId: "sim-message", body, identityType: "resident" }
    assertEquals(await tryHandleStaffReplyInbound({} as never, params), { handled: false })
    assertEquals(await tryHandleTenantScheduleConfirmInbound({} as never, params), { handled: false })
  })
}

for (const body of [
  "Yes that works", "Sounds good", "Yes thanks", "No, Thursday 2–4pm", "Tomorrow after 3",
  "Here is the photo", "It's broken", "The sink is still leaking", "The same leak is under the sink",
  "The sink is not leaking", "The sink isn't leaking", "The sink is no longer dripping",
  "When will the plumber fix the sink?", "How much is my rent?", "NO", "STOP", "HELP",
]) {
  Deno.test(`pending ask keeps genuine answer/update: ${body}`, () => {
    assertEquals(shouldYieldPendingAskToRepair(body), false)
  })
}
