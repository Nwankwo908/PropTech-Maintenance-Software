/// <reference lib="deno.ns" />
import {
  assertEquals,
  assertExists,
} from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  parseAvailabilityToScheduledAt,
  readVendorScheduleState,
  withVendorScheduleState,
} from "./vendor_job_schedule.ts"
import {
  buildVendorAvailabilityAskSms,
  buildVendorJobAssignmentSms,
  buildVendorJobDetailLinkSms,
  buildVendorScheduleConfirmedSms,
  formatWorkOrderRef,
} from "./vendor_outreach_copy.ts"
import { parseVendorSmsReply } from "./vendor_workflow.ts"

Deno.test("formatWorkOrderRef uses first 4 hex of ticket id", () => {
  assertEquals(
    formatWorkOrderRef("3b0047aa-1111-2222-3333-444444444444"),
    "WO-3B00",
  )
})

Deno.test("dispatch SMS includes WO + YES/NO and unique job link", () => {
  const body = buildVendorJobAssignmentSms({
    vendorName: "flex plumbing",
    priority: "high",
    unit: "2B",
    description: "Leaking kitchen sink",
    issueHeadline: "Leaking kitchen sink",
    location: "14 Maple Ave · Unit 2B",
    entryOkIfAbsent: true,
    ticketId: "3b0047aa-1111-2222-3333-444444444444",
    jobDetailUrl: "https://www.ulohome.io/w/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  })
  assertEquals(
    body,
    [
      "Hi Flex Plumbing — new job WO-3B00",
      "Address: 14 Maple Ave",
      "Unit: Unit 2B",
      "Issue: Leaking kitchen sink",
      "Entry OK if resident out: Yes",
      "",
      "Would you like to take this job? Reply YES WO-3B00 to accept or NO WO-3B00 to decline.",
      "",
      "Details: https://www.ulohome.io/w/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    ].join("\n"),
  )
  assertEquals(body.includes("Accept:"), false)
  assertEquals(body.includes("View this job:"), false)

  const linkSms = buildVendorJobDetailLinkSms(
    "https://www.ulohome.io/w/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  )
  assertEquals(linkSms, [
    "Open the work order and submit your estimate when you can:",
    "https://www.ulohome.io/w/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  ].join("\n"))
})

Deno.test("dispatch SMS uses clean headline, not intake Q&A in description", () => {
  const stuffed =
    "Shower won't shut off Tenant update: No Affected area: bathroom. Entry if not home: No."
  const body = buildVendorJobAssignmentSms({
    vendorName: "Flex Plumbing",
    priority: "normal",
    unit: "1",
    description: stuffed,
    issueHeadline: "Shower won't shut off",
    location: "563 Springdale Circle",
    entryOkIfAbsent: false,
    ticketId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    jobDetailUrl: "https://www.ulohome.io/w/tok",
  })

  const issueLine = body.split("\n").find((l) => l.startsWith("Issue:")) ?? ""
  assertEquals(issueLine, "Issue: Shower won't shut off")
  assertEquals(/Tenant update/i.test(issueLine), false)
  assertEquals(/Affected area/i.test(issueLine), false)
  assertEquals(/Entry if not home/i.test(issueLine), false)
  assertEquals(body.includes(stuffed), false)
  assertEquals(body.includes("Entry OK if resident out: No"), true)
  assertEquals(body.includes("Address: 563 Springdale Circle"), true)
  assertEquals(body.includes("Unit: Unit 1"), true)
  // Accept/decline after the decision facts, details last.
  const yesIdx = body.indexOf("Reply YES")
  const detailsIdx = body.indexOf("Details:")
  const entryIdx = body.indexOf("Entry OK if resident out:")
  assertEquals(entryIdx >= 0 && entryIdx < yesIdx, true)
  assertEquals(yesIdx >= 0 && yesIdx < detailsIdx, true)
})

Deno.test("availability ask + confirm copy completes with next step", () => {
  const ask = buildVendorAvailabilityAskSms()
  assertEquals(ask.includes("earliest availability"), true)
  assertEquals(ask.includes("arrival window"), true)
  const confirm = buildVendorScheduleConfirmedSms({
    workOrderRef: "WO-3B00",
    windowText: "Tomorrow 10am",
    jobDetailUrl: "https://www.ulohome.io/w/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  })
  assertEquals(confirm.includes("WO-3B00"), true)
  assertEquals(confirm.includes("Tomorrow 10am"), true)
  assertEquals(confirm.includes("submit your estimate"), true)
  assertEquals(confirm.includes("/w/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"), true)
})

Deno.test("parseVendorSmsReply YES/NO", () => {
  assertEquals(parseVendorSmsReply("YES"), "accept")
  assertEquals(parseVendorSmsReply("no"), "decline")
  assertEquals(parseVendorSmsReply("Tomorrow 10am"), null)
})

Deno.test("parseAvailabilityToScheduledAt tomorrow morning Eastern", () => {
  const now = new Date("2026-07-20T17:00:00.000Z")
  const iso = parseAvailabilityToScheduledAt(
    "Tomorrow 10am",
    now,
    "America/New_York",
  )
  assertExists(iso)
  assertEquals(iso, "2026-07-21T14:00:00.000Z")
})

Deno.test("parseAvailabilityToScheduledAt range uses start time", () => {
  const now = new Date("2026-07-20T17:00:00.000Z")
  const range = parseAvailabilityToScheduledAt(
    "Tomorrow 9-12pm",
    now,
    "America/New_York",
  )
  const nineAm = parseAvailabilityToScheduledAt(
    "Tomorrow 9am",
    now,
    "America/New_York",
  )
  assertExists(range)
  assertExists(nineAm)
  assertEquals(range, nineAm)
})

Deno.test("vendor schedule state round-trip", () => {
  const next = withVendorScheduleState({}, {
    step: "awaiting_availability",
    ticketId: "t1",
  })
  const read = readVendorScheduleState(next)
  assertEquals(read?.step, "awaiting_availability")
  assertEquals(read?.ticketId, "t1")
  assertEquals(typeof read?.expiresAt, "string")
  const cleared = withVendorScheduleState(next, null)
  assertEquals(readVendorScheduleState(cleared), null)
})
