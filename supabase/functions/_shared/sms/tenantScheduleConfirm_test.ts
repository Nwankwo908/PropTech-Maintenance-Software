/// <reference lib="deno.ns" />
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  buildTenantScheduleAskSms,
  buildVendorWaitingOnTenantSms,
  parseTenantScheduleDecision,
} from "./tenantScheduleConfirm.ts"

Deno.test("parseTenantScheduleDecision accepts common YES forms", () => {
  assertEquals(parseTenantScheduleDecision("YES"), "accept")
  assertEquals(parseTenantScheduleDecision("yes!"), "accept")
  assertEquals(parseTenantScheduleDecision("that works"), "accept")
  assertEquals(parseTenantScheduleDecision("ok"), "accept")
})

Deno.test("parseTenantScheduleDecision accepts common NO forms", () => {
  assertEquals(parseTenantScheduleDecision("NO"), "decline")
  assertEquals(parseTenantScheduleDecision("doesn't work"), "decline")
  assertEquals(parseTenantScheduleDecision("different time"), "decline")
})

Deno.test("parseTenantScheduleDecision ignores unrelated text", () => {
  assertEquals(parseTenantScheduleDecision("tomorrow after 3"), null)
  assertEquals(parseTenantScheduleDecision(""), null)
})

Deno.test("tenant ask and vendor waiting copy stay plain-language", () => {
  const ask = buildTenantScheduleAskSms({
    residentName: "Jordan Lee",
    vendorName: "Flex Plumbing",
    windowText: "Wednesday after 3:00 PM",
  })
  assertEquals(ask.includes("Flex Plumbing"), true)
  assertEquals(ask.includes("arrival window"), true)
  assertEquals(ask.includes("Reply YES"), true)
  assertEquals(ask.includes("workflow"), false)

  const waiting = buildVendorWaitingOnTenantSms("Wednesday after 3:00 PM")
  assertEquals(waiting.includes("checking with the resident"), true)
})
