/// <reference lib="deno.ns" />
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  resolveContextualFollowUp,
  shouldKeepActivePendingContext,
  type OpenRequestSummary,
} from "./inboundContextualFollowUp.ts"
import { heuristicInterpretInbound } from "./inboundInterpretation.ts"
import { pendingIntakeQuestion } from "./residentIntake.ts"
import type { SmsIntakeState } from "./residentIntakeTypes.ts"
import { resolveMaintenanceWorkIntent } from "./resolveMaintenanceWorkIntent.ts"
import {
  buildSmallTalkDuringIntakeSms,
  buildSmallTalkSms,
  classifyAssistantOtherMessage,
  planAssistantOtherReply,
} from "./tenantAssistantReply.ts"

const OPEN_LEAK: OpenRequestSummary = {
  id: "t-leak",
  description: "Kitchen sink is leaking",
  vendor_work_status: "pending_accept",
  issue_category: "plumbing",
}

const PENDING_INTAKE: SmsIntakeState = {
  step: "room_or_area",
  issue_type: "plumbing",
  vendor_trade: "plumbing",
  initial_message: "My sink is leaking",
  description: "My sink is leaking",
}

const GREETINGS = ["Hello", "hi", "good morning", "thanks"] as const

function freshThreadDecision(body: string) {
  const heuristic = heuristicInterpretInbound(body, { activeIntake: false })
  const followUp = resolveContextualFollowUp({
    body,
    hasMedia: false,
    intent: heuristic.intent,
    openTickets: [],
    activeIntake: false,
  })
  const plan = planAssistantOtherReply({ body, activeIntake: false })
  return { heuristic, followUp, plan }
}

function pendingIntakeDecision(body: string) {
  const heuristic = heuristicInterpretInbound(body, {
    activeIntake: true,
    intakeStep: "room_or_area",
  })
  const keep = shouldKeepActivePendingContext({
    body,
    intent: heuristic.intent,
    openTickets: [],
    activeIntake: true,
  })
  const followUp = resolveContextualFollowUp({
    body,
    hasMedia: false,
    intent: heuristic.intent,
    openTickets: [],
    activeIntake: true,
  })
  const plan = planAssistantOtherReply({ body, activeIntake: true })
  const pendingQuestion = pendingIntakeQuestion(PENDING_INTAKE)
  const reply = buildSmallTalkDuringIntakeSms("Alex", pendingQuestion)
  return { heuristic, keep, followUp, plan, pendingQuestion, reply, intakeAfter: PENDING_INTAKE }
}

function openTicketDecision(body: string) {
  const heuristic = heuristicInterpretInbound(body, { activeIntake: false })
  const followUp = resolveContextualFollowUp({
    body,
    hasMedia: false,
    intent: heuristic.intent,
    openTickets: [OPEN_LEAK],
    activeIntake: false,
  })
  const plan = planAssistantOtherReply({ body, activeIntake: false })
  return { heuristic, followUp, plan }
}

for (const greeting of GREETINGS) {
  Deno.test(`greeting "${greeting}" on fresh thread → small talk, no staff notify`, () => {
    const { followUp, plan } = freshThreadDecision(greeting)
    assertEquals(classifyAssistantOtherMessage(greeting), "small_talk")
    assertEquals(followUp.action, "switch_intent")
    assertEquals(plan.replyType, "sms_small_talk")
    assertEquals(plan.notifyStaff, false)
    assertEquals(plan.preserveIntake, true)
    const reply = buildSmallTalkSms("Alex")
    assertEquals(reply.includes("Hi Alex,"), true)
    assertEquals(reply.includes("Ulo AI"), true)
    assertEquals(reply.toLowerCase().includes("passed"), false)
  })

  Deno.test(`greeting "${greeting}" during pending intake → breakout, re-ask, preserve state`, () => {
    const { keep, followUp, plan, pendingQuestion, reply, intakeAfter } =
      pendingIntakeDecision(greeting)
    assertEquals(classifyAssistantOtherMessage(greeting), "small_talk")
    assertEquals(keep, false)
    assertEquals(followUp.action, "switch_intent")
    assertEquals(followUp.action === "continue_intake", false)
    assertEquals(plan.replyType, "sms_small_talk")
    assertEquals(plan.notifyStaff, false)
    assertEquals(plan.preserveIntake, true)
    assertEquals(intakeAfter.step, "room_or_area")
    assertEquals(intakeAfter.issue_type, "plumbing")
    assertEquals(reply.includes("Hi Alex,"), true)
    assertEquals(reply.includes("Ulo AI"), true)
    assertEquals(reply.includes(pendingQuestion), true)
    assertEquals(/which room/i.test(reply), true)
    assertEquals(reply.toLowerCase().includes("passed"), false)
  })

  Deno.test(`greeting "${greeting}" with open ticket → small talk, not ticket follow-up`, () => {
    const { followUp, plan } = openTicketDecision(greeting)
    assertEquals(classifyAssistantOtherMessage(greeting), "small_talk")
    assertEquals(followUp.action, "switch_intent")
    assertEquals(plan.replyType, "sms_small_talk")
    assertEquals(plan.notifyStaff, false)
    assertEquals(plan.preserveIntake, true)
  })
}

Deno.test("fresh thread: ok / ? / are you a bot → clarify, no staff notify", () => {
  for (const body of ["ok", "?", "are you a bot"]) {
    const plan = planAssistantOtherReply({ body, activeIntake: false })
    assertEquals(plan.kind, "unclear", body)
    assertEquals(plan.replyType, "sms_clarify", body)
    assertEquals(plan.notifyStaff, false, body)
  }
})

Deno.test("fresh thread: my sink is leaking → new maintenance issue", () => {
  const body = "my sink is leaking"
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
  assertEquals(classifyAssistantOtherMessage(body) === "small_talk", false)
})

Deno.test("fresh thread: any update? → not small talk; clarify without staff notify", () => {
  const body = "any update?"
  assertEquals(classifyAssistantOtherMessage(body) === "small_talk", false)
  const followUp = resolveContextualFollowUp({
    body,
    hasMedia: false,
    intent: null,
    openTickets: [],
    activeIntake: false,
  })
  // Bare "any update?" without open-ticket context is not a repair greeting.
  assertEquals(followUp.action, "switch_intent")
  const plan = planAssistantOtherReply({ body, activeIntake: false })
  assertEquals(plan.kind, "unclear")
  assertEquals(plan.replyType, "sms_clarify")
  assertEquals(plan.notifyStaff, false)
})

Deno.test("open ticket: any update on my repair? → status follow-up", () => {
  const body = "any update on my repair?"
  const followUp = resolveContextualFollowUp({
    body,
    hasMedia: false,
    intent: null,
    openTickets: [OPEN_LEAK],
    activeIntake: false,
  })
  assertEquals(followUp.action, "follow_up")
  if (followUp.action === "follow_up") {
    assertEquals(followUp.intent, "maintenance_status")
  }
})

Deno.test("fresh thread: I smell gas → NEW_ISSUE / emergency-shaped maintenance", () => {
  const body = "I smell gas"
  const resolved = resolveMaintenanceWorkIntent({
    body,
    heuristicIntent: null,
    openTickets: [],
  })
  assertEquals(resolved, "NEW_ISSUE")
  const followUp = resolveContextualFollowUp({
    body,
    hasMedia: false,
    intent: "maintenance_new",
    openTickets: [],
    activeIntake: false,
  })
  assertEquals(followUp.action, "new_issue")
  assertEquals(classifyAssistantOtherMessage(body) === "small_talk", false)
})

Deno.test("fresh thread: can someone call me → escalate plan with staff notify", () => {
  const body = "can someone call me"
  const plan = planAssistantOtherReply({ body, activeIntake: false })
  assertEquals(plan.kind, "human_request")
  assertEquals(plan.replyType, "sms_routed_to_landlord")
  assertEquals(plan.notifyStaff, true)
  assertEquals(plan.preserveIntake, false)
})
