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

Deno.test("dispatch SMS includes WO + YES/NO; link is post-schedule", () => {
  const body = buildVendorJobAssignmentSms({
    vendorName: "Flex Plumbing",
    priority: "high",
    unit: "Unit 2B",
    description: "Leaking kitchen sink",
    ticketId: "3b0047aa-1111-2222-3333-444444444444",
    jobDetailUrl: "https://www.ulohome.io/w/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  })
  assertEquals(body.includes("Hi Flex Plumbing,"), true)
  assertEquals(body.includes("Ulo has assigned you a new work order (WO-3B00)."), true)
  assertEquals(body.includes("Issue: Leaking kitchen sink"), true)
  assertEquals(
    body.includes(
      "Would you like to take this job? Reply YES to accept or NO to decline.",
    ),
    true,
  )
  assertEquals(body.includes("View the work order:"), false)
  assertEquals(body.includes("/w/"), false)
  assertEquals(body.includes("Accept:"), false)

  const linkSms = buildVendorJobDetailLinkSms(
    "https://www.ulohome.io/w/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  )
  assertEquals(linkSms, [
    "Open the work order and submit your estimate when you can:",
    "https://www.ulohome.io/w/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  ].join("\n"))
})

Deno.test("availability ask + confirm copy completes with next step", () => {
  assertEquals(buildVendorAvailabilityAskSms(), "Earliest availability?")
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
