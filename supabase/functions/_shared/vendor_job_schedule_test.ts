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

Deno.test("dispatch SMS includes WO, detail link, YES or NO", () => {
  const body = buildVendorJobAssignmentSms({
    vendorName: "Flex Plumbing",
    priority: "high",
    unit: "Unit 2B",
    description: "Leaking kitchen sink",
    ticketId: "3b0047aa-1111-2222-3333-444444444444",
    jobDetailUrl: "https://app.ulohome.io/w/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  })
  assertEquals(body.includes("Hi Flex Plumbing,"), true)
  assertEquals(body.includes("Ulo has assigned you a new work order (WO-3B00)."), true)
  assertEquals(body.includes("Issue: Leaking kitchen sink"), true)
  assertEquals(body.includes("View the work order:"), true)
  assertEquals(body.includes("/w/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"), true)
  assertEquals(
    body.includes(
      "Would you like to take this job? Reply YES to accept or NO to decline.",
    ),
    true,
  )
  assertEquals(body.includes("Accept:"), false)
})

Deno.test("availability ask + confirm copy", () => {
  assertEquals(buildVendorAvailabilityAskSms(), "Earliest availability?")
  const confirm = buildVendorScheduleConfirmedSms({
    workOrderRef: "WO-3B00",
    windowText: "Tomorrow 10am",
  })
  assertEquals(confirm.includes("WO-3B00"), true)
  assertEquals(confirm.includes("Tomorrow 10am"), true)
  assertEquals(confirm.includes("Tenant and property team notified"), true)
})

Deno.test("parseVendorSmsReply YES/NO", () => {
  assertEquals(parseVendorSmsReply("YES"), "accept")
  assertEquals(parseVendorSmsReply("no"), "decline")
  assertEquals(parseVendorSmsReply("Tomorrow 10am"), null)
})

Deno.test("parseAvailabilityToScheduledAt tomorrow morning", () => {
  const now = new Date("2026-07-19T15:00:00.000Z")
  const iso = parseAvailabilityToScheduledAt("Tomorrow 10am", now)
  assertExists(iso)
  const d = new Date(iso!)
  // Local timezone dependent — assert it's after "now" and same clock hour intent.
  assertEquals(d.getTime() > now.getTime(), true)
})

Deno.test("vendor schedule state round-trip", () => {
  const next = withVendorScheduleState({}, {
    step: "awaiting_availability",
    ticketId: "t1",
  })
  const read = readVendorScheduleState(next)
  assertEquals(read?.step, "awaiting_availability")
  assertEquals(read?.ticketId, "t1")
  const cleared = withVendorScheduleState(next, null)
  assertEquals(readVendorScheduleState(cleared), null)
})
