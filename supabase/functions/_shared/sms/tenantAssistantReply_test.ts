/// <reference lib="deno.ns" />
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  buildEmergencySafetySms,
  buildEscalatedOtherSms,
  buildSameDayUrgencySms,
  buildSmallTalkDuringIntakeSms,
  buildSmallTalkSms,
  buildUnclearClarifySms,
  classifyAssistantOtherMessage,
  shouldEscalateAssistantOther,
} from "./tenantAssistantReply.ts"

Deno.test("Hello / thanks are small talk — never escalate", () => {
  assertEquals(classifyAssistantOtherMessage("Hello"), "small_talk")
  assertEquals(classifyAssistantOtherMessage("Hi"), "small_talk")
  assertEquals(classifyAssistantOtherMessage("Thanks!"), "small_talk")
  assertEquals(classifyAssistantOtherMessage("thank you so much"), "small_talk")
  assertEquals(shouldEscalateAssistantOther("small_talk"), false)
  assertEquals(
    buildSmallTalkSms("Kenniesa").includes("how can I help"),
    true,
  )
  assertEquals(
    buildSmallTalkSms("Kenniesa").includes("Ulo AI"),
    true,
  )
  assertEquals(
    buildSmallTalkSms("Kenniesa").toLowerCase().includes("passed"),
    false,
  )
})

Deno.test("Bare ok is unclear, not small talk", () => {
  assertEquals(classifyAssistantOtherMessage("ok"), "unclear")
  assertEquals(classifyAssistantOtherMessage("okay"), "unclear")
})

Deno.test("Small talk during intake re-asks the pending question", () => {
  const sms = buildSmallTalkDuringIntakeSms(
    "Alex",
    "Which room is this happening in? Kitchen, bathroom, basement, bedroom, or somewhere else?",
  )
  assertEquals(sms.includes("Ulo AI"), true)
  assertEquals(sms.includes("Which room"), true)
  assertEquals(sms.toLowerCase().includes("passed"), false)
})

Deno.test("Unclear messages ask a clarifying question without handoff copy", () => {
  assertEquals(classifyAssistantOtherMessage("Hmm"), "unclear")
  assertEquals(classifyAssistantOtherMessage("Need something"), "unclear")
  assertEquals(shouldEscalateAssistantOther("unclear"), false)
  const sms = buildUnclearClarifySms("Alex")
  assertEquals(sms.includes("What do you need"), true)
  assertEquals(sms.toLowerCase().includes("passed"), false)
})

Deno.test("Human request and complaint escalate", () => {
  assertEquals(
    classifyAssistantOtherMessage("Can I speak to a manager?"),
    "human_request",
  )
  assertEquals(
    classifyAssistantOtherMessage("I want to file a complaint"),
    "complaint_or_legal",
  )
  assertEquals(shouldEscalateAssistantOther("human_request"), true)
  assertEquals(shouldEscalateAssistantOther("complaint_or_legal"), true)
  assertEquals(
    buildEscalatedOtherSms("Alex", "human_request").includes("passed your message"),
    true,
  )
})

Deno.test("Emergency safety SMS mentions 911 and staff alert", () => {
  const leave = buildEmergencySafetySms({
    firstName: "Sam",
    leaveImmediately: true,
  })
  assertEquals(leave.includes("911"), true)
  assertEquals(leave.toLowerCase().includes("alerting the property team"), true)

  const urgent = buildEmergencySafetySms({
    firstName: "Sam",
    leaveImmediately: false,
    reason: "No heat in freezing conditions.",
  })
  assertEquals(urgent.includes("911"), true)
  assertEquals(urgent.includes("No heat"), true)
})

Deno.test("Same-day urgency SMS alerts the team without 911", () => {
  const sms = buildSameDayUrgencySms({
    firstName: "Adriana",
    reason: "An overflowing fixture needs same-day response.",
    handlingTip:
      "Until help arrives: if you can safely reach the shutoff valve, turn it off.",
  })
  assertEquals(sms.includes("911"), false)
  assertEquals(sms.toLowerCase().includes("same-day"), true)
  assertEquals(sms.toLowerCase().includes("alerted the property team"), true)
  assertEquals(sms.includes("overflowing fixture"), true)
  assertEquals(sms.toLowerCase().includes("shutoff"), true)
})
