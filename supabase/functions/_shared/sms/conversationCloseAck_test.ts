/// <reference lib="deno.ns" />
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  buildConversationCloseAckSms,
  hasOpenPendingAskForCloseAck,
  isConversationCloseAck,
  looksLikeInformationalOutbound,
} from "./conversationCloseAck.ts"
import { recognizeInboundIntentSync } from "./recognizeInboundIntent.ts"
import {
  resolveContextualFollowUp,
  shouldKeepActivePendingContext,
  type OpenRequestSummary,
} from "./inboundContextualFollowUp.ts"
import { heuristicInterpretInbound } from "./inboundInterpretation.ts"
import { isAffirmativeReply } from "./residentIntakeTypes.ts"
import { buildUnclearClarifySms } from "./tenantAssistantReply.ts"

const OPEN_LEAK: OpenRequestSummary = {
  id: "t-leak",
  description: "Kitchen sink is leaking",
  vendor_work_status: "pending_accept",
  issue_category: "plumbing",
}

const STATUS_UPDATE =
  "Vendor accepted the job. We'll text you when a visit time is set."

Deno.test("close ack matches whole-message phrases only", () => {
  for (const body of [
    "Ok thank you",
    "ok",
    "okay",
    "thanks",
    "thank you",
    "got it",
    "sounds good",
    "perfect",
    "great",
    "appreciate it",
    "OKAY!",
    "thx",
  ]) {
    assertEquals(isConversationCloseAck(body), true, body)
  }
})

Deno.test("close ack rejects phrase plus new content", () => {
  for (const body of [
    "Thanks, also one more thing — the sink is leaking",
    "ok, also my sink is leaking",
    "okay but the AC is broken",
    "got it and also the toilet",
  ]) {
    assertEquals(isConversationCloseAck(body), false, body)
  }
})

Deno.test("recognizer layer 2 treats close ack as small_talk", () => {
  const recognized = recognizeInboundIntentSync("Ok thank you")
  assertEquals(recognized.intent, "small_talk")
  assertEquals(recognized.layer, "small_talk")
  assertEquals(recognized.showMenu, false)
})

Deno.test("close ack after informational context routes switch_intent, not status follow-up", () => {
  const body = "Ok thank you"
  const heuristic = heuristicInterpretInbound(body, { activeIntake: false })
  const followUp = resolveContextualFollowUp({
    body,
    hasMedia: false,
    intent: heuristic.intent,
    openTickets: [OPEN_LEAK],
    activeIntake: false,
  })
  assertEquals(followUp.action, "switch_intent")
  assertEquals(looksLikeInformationalOutbound(STATUS_UPDATE), true)
  const reply = buildConversationCloseAckSms("Alex")
  assertEquals(reply.includes("You're welcome"), true)
  assertEquals(reply.includes("keep you posted"), true)
  assertEquals(reply.toLowerCase().includes("what do you need"), false)
  assertEquals(buildUnclearClarifySms("Alex").toLowerCase().includes("what do you need"), true)
})

Deno.test("bare ok with pending YES/NO confirm still addresses pending, not close", () => {
  const body = "ok"
  assertEquals(isAffirmativeReply(body), true)
  assertEquals(isConversationCloseAck(body), true)
  const heuristic = heuristicInterpretInbound(body, {
    activeIntake: false,
    awaitingTicketUpdateConfirm: true,
  })
  assertEquals(heuristic.addressesPending, true)
  assertEquals(heuristic.pendingAnswer, "yes")
  assertEquals(
    hasOpenPendingAskForCloseAck({
      activeIntake: false,
      awaitingTicketUpdateConfirm: true,
    }),
    true,
  )
})

Deno.test("close ack during active intake breaks out of step answer (pending ask wins)", () => {
  const body = "ok"
  const keep = shouldKeepActivePendingContext({
    body,
    intent: null,
    openTickets: [],
    activeIntake: true,
  })
  assertEquals(keep, false)
  assertEquals(
    hasOpenPendingAskForCloseAck({ activeIntake: true, intakeStep: "room_or_area" }),
    true,
  )
})

Deno.test("compound thanks + new issue is not close ack and routes as new request", () => {
  const body = "Thanks, also one more thing — bedroom outlet sparking"
  assertEquals(isConversationCloseAck(body), false)
  const heuristic = heuristicInterpretInbound(body, { activeIntake: false })
  assertEquals(heuristic.intent, "maintenance_new")
  const followUp = resolveContextualFollowUp({
    body,
    hasMedia: false,
    intent: heuristic.intent,
    openTickets: [],
    activeIntake: false,
  })
  assertEquals(followUp.action, "new_issue")
})

Deno.test("informational outbound detector rejects YES/NO asks", () => {
  assertEquals(
    looksLikeInformationalOutbound(
      "Reply YES to confirm Saturday 9am–12pm or NO if that does not work.",
    ),
    false,
  )
  assertEquals(
    looksLikeInformationalOutbound(
      "Happy to help. What do you need — a repair, something about rent or your lease, or something else?",
    ),
    false,
  )
  assertEquals(looksLikeInformationalOutbound(STATUS_UPDATE), true)
})
