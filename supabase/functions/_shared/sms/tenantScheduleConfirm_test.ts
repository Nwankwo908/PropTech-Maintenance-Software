/// <reference lib="deno.ns" />
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  buildScheduleConfirmClarifySms,
  buildTenantScheduleAskSms,
  buildTenantScheduleDeclinedSms,
  buildVendorTenantNeedsDifferentTimeSms,
  buildVendorWaitingOnTenantSms,
  extractTenantSchedulePreferredWindow,
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

Deno.test("parseTenantScheduleDecision treats No + time as counter-propose", () => {
  assertEquals(parseTenantScheduleDecision("No Wed 2pm"), "counter_propose")
  assertEquals(parseTenantScheduleDecision("No, Wed 2–4pm"), "counter_propose")
  assertEquals(
    parseTenantScheduleDecision("No that doesn't work, tomorrow after 3"),
    "counter_propose",
  )
  assertEquals(
    parseTenantScheduleDecision("Can they come Wed 2pm?"),
    "counter_propose",
  )
})

Deno.test("parseTenantScheduleDecision ignores unrelated text", () => {
  assertEquals(parseTenantScheduleDecision("tomorrow after 3"), null)
  assertEquals(parseTenantScheduleDecision("No water pressure"), null)
  assertEquals(parseTenantScheduleDecision(""), null)
})

Deno.test("parseTenantScheduleDecision tolerates short YES/NO typos", () => {
  assertEquals(parseTenantScheduleDecision("YSE"), null) // distance 2 on YES — too loose; rejected
  assertEquals(parseTenantScheduleDecision("YE"), "accept") // distance 1 → YES
  assertEquals(parseTenantScheduleDecision("CONFIM"), "accept") // CONFIRM typo ≤2
  assertEquals(parseTenantScheduleDecision("DECLIEN"), "decline")
})

Deno.test("buildScheduleConfirmClarifySms references the pending window", () => {
  const body = buildScheduleConfirmClarifySms({
    windowText: "Wed 9am–12pm",
    workOrderRef: "WO-B347",
  })
  assertEquals(body.includes("Wed 9am–12pm"), true)
  assertEquals(body.includes("WO-B347"), true)
  assertEquals(body.includes("YES or NO"), true)
  assertEquals(body.includes("How can we help with your maintenance"), false)
})

Deno.test("extractTenantSchedulePreferredWindow strips decline lead-in", () => {
  assertEquals(extractTenantSchedulePreferredWindow("No Wed 2pm"), "Wed 2pm")
  assertEquals(
    extractTenantSchedulePreferredWindow("No, tomorrow after 3"),
    "tomorrow after 3",
  )
  assertEquals(extractTenantSchedulePreferredWindow("NO"), null)
})

Deno.test("vendor decline SMS includes resident preferred window", () => {
  const withPref = buildVendorTenantNeedsDifferentTimeSms("Wed 2pm")
  assertEquals(withPref.includes("They suggested: Wed 2pm"), true)
  assertEquals(withPref.includes("confirm that one or offer another"), true)

  const bare = buildVendorTenantNeedsDifferentTimeSms()
  assertEquals(bare.includes("They suggested"), false)
  assertEquals(bare.includes("What's another day"), true)

  const tenantAck = buildTenantScheduleDeclinedSms("Wed 2pm")
  assertEquals(tenantAck.includes("Wed 2pm"), true)
  assertEquals(tenantAck.includes("share"), true)
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
  assertEquals(ask.includes("NO with another day/time"), true)
  assertEquals(ask.includes("workflow"), false)

  const waiting = buildVendorWaitingOnTenantSms("Wednesday after 3:00 PM")
  assertEquals(waiting.includes("checking with the resident"), true)
})
