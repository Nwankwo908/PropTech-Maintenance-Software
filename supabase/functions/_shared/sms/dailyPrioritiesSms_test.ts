/// <reference lib="deno.ns" />
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  canAttemptDailyPrioritiesReply,
  canHandleDailyPrioritiesAsk,
  dailyPrioritiesRoleFromIdentity,
} from "./dailyPrioritiesSms.ts"

Deno.test("dailyPrioritiesRoleFromIdentity fail-closes unknown senders", () => {
  assertEquals(dailyPrioritiesRoleFromIdentity("landlord").role, "landlord")
  assertEquals(dailyPrioritiesRoleFromIdentity("resident").role, "tenant")
  assertEquals(dailyPrioritiesRoleFromIdentity("vendor").role, "unresolved")
  assertEquals(dailyPrioritiesRoleFromIdentity(null).role, "unresolved")
})

Deno.test("canHandleDailyPrioritiesAsk requires landlord/resident + phrasing", () => {
  assertEquals(
    canHandleDailyPrioritiesAsk({
      body: "What should I prioritize today?",
      identityType: "landlord",
    }),
    true,
  )
  assertEquals(
    canHandleDailyPrioritiesAsk({
      body: "What's urgent?",
      identityType: "resident",
    }),
    true,
  )
  assertEquals(
    canHandleDailyPrioritiesAsk({
      body: "What should I prioritize today?",
      identityType: "vendor",
    }),
    false,
  )
  assertEquals(
    canHandleDailyPrioritiesAsk({
      body: "YES",
      identityType: "landlord",
    }),
    false,
  )
})

Deno.test("canAttemptDailyPrioritiesReply matches list tokens only", () => {
  assertEquals(canAttemptDailyPrioritiesReply("1"), true)
  assertEquals(canAttemptDailyPrioritiesReply("102 YES"), true)
  assertEquals(canAttemptDailyPrioritiesReply("YES"), false)
  assertEquals(canAttemptDailyPrioritiesReply("assign vendor"), false)
})
