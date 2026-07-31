import { assertEquals, assertMatch } from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  buildLandlordRescheduleEmail,
  buildLandlordRescheduleSms,
  buildResidentRescheduleNotifySms,
  buildVendorRescheduleClarifySms,
  buildVendorRescheduleConfirmSms,
  detectVendorRescheduleIntent,
  filterJobsByExistingTimeHint,
  formatRescheduleTimeLabel,
  humanizeTrade,
  type RescheduleJob,
} from "./vendorRescheduleSms.ts"
import { parseTenantScheduleDecision } from "./tenantScheduleConfirm.ts"

const JOB_A: RescheduleJob = {
  ticketId: "3b0047aa-1111-2222-3333-444444444444",
  workOrderRef: "WO-3B00",
  unit: "3B",
  building: "123 Main",
  issueCategory: "plumbing",
  description: "Leaking faucet",
  scheduledAt: "2026-07-25T14:00:00.000Z", // 10:00 AM EDT
  scheduledWindowText: "10:00 AM",
  vendorWorkStatus: "accepted",
  buildingName: "123 Main",
}

const JOB_B: RescheduleJob = {
  ticketId: "5a0021aa-1111-2222-3333-444444444444",
  workOrderRef: "WO-5A00",
  unit: "5A",
  building: "123 Main",
  issueCategory: "plumbing",
  description: "Clogged drain",
  scheduledAt: "2026-07-25T15:30:00.000Z", // 11:30 AM EDT
  scheduledWindowText: "11:30 AM",
  vendorWorkStatus: "accepted",
  buildingName: "123 Main",
}

Deno.test("detectVendorRescheduleIntent — common phrases", () => {
  const samples = [
    "Need to push the 10am at 123 Main, Apt 3B to 2pm today. Running behind on a previous job.",
    "Can we reschedule to tomorrow?",
    "Running late — move the appointment to 3pm",
    "I won't make the 10:00 appointment",
    "Need to move it to later today",
    "Change the time to 4pm please",
  ]
  for (const s of samples) {
    const d = detectVendorRescheduleIntent(s)
    assertEquals(d.isReschedule, true, s)
    assertEquals(d.confidence > 0.5, true, s)
  }
  assertEquals(detectVendorRescheduleIntent("YES WO-3B00").isReschedule, false)
  assertEquals(detectVendorRescheduleIntent("Wed 9am–12pm").isReschedule, false)
})

Deno.test("detectVendorRescheduleIntent extracts reason", () => {
  const d = detectVendorRescheduleIntent(
    "Push the 10am to 2pm. Running behind on a previous job.",
  )
  assertEquals(d.isReschedule, true)
  assertMatch(d.reason ?? "", /running behind/i)
})

Deno.test("filterJobsByExistingTimeHint narrows by prior clock", () => {
  const filtered = filterJobsByExistingTimeHint(
    "Need to push the 10am at 123 Main to 2pm today",
    [JOB_A, JOB_B],
    "America/New_York",
  )
  assertEquals(filtered.length, 1)
  assertEquals(filtered[0].ticketId, JOB_A.ticketId)
})

Deno.test("buildVendorRescheduleClarifySms lists options", () => {
  const body = buildVendorRescheduleClarifySms([JOB_A, JOB_B])
  assertMatch(body, /more than one active job/)
  assertMatch(body, /1\. WO-3B00/)
  assertMatch(body, /2\. WO-5A00/)
  assertMatch(body, /Reply with 1, 2, or the work-order number/)
})

Deno.test("vendor / resident / landlord copy", () => {
  assertEquals(
    buildVendorRescheduleConfirmSms({
      workOrderRef: "WO-3B00",
      newTimeLabel: "2:00 PM today",
      residentNotified: true,
    }),
    "Got it. I've rescheduled work order WO-3B00 to 2:00 PM today. The resident and property team will be notified.",
  )
  assertMatch(
    buildVendorRescheduleConfirmSms({
      workOrderRef: "WO-3B00",
      newTimeLabel: "2:00 PM today",
      residentNotified: false,
    }),
    /couldn't reach the resident/i,
  )
  assertMatch(
    buildResidentRescheduleNotifySms({
      unitLabel: "Apt 3B",
      tradeLabel: "plumber",
      newTimeLabel: "2:00 PM today",
    }),
    /Reply CONFIRM/,
  )
  assertMatch(
    buildLandlordRescheduleSms({
      workOrderRef: "WO-3B00",
      newTimeLabel: "2:00 PM today",
    }),
    /rescheduled to 2:00 PM today by the vendor/,
  )
  const email = buildLandlordRescheduleEmail({
    workOrderRef: "WO-3B00",
    vendorName: "Flex Plumbing",
    propertyName: "123 Main",
    unitLabel: "Apt 3B",
    previousTimeLabel: "10:00 AM",
    newTimeLabel: "2:00 PM today",
    reason: "Running behind on a previous job.",
  })
  assertMatch(email.subject, /WO-3B00/)
  assertMatch(email.text, /Previous time: 10:00 AM/)
  assertMatch(email.text, /Running behind/)
})

Deno.test("humanizeTrade + formatRescheduleTimeLabel", () => {
  assertEquals(humanizeTrade("plumbing"), "plumber")
  const label = formatRescheduleTimeLabel(
    "2026-07-25T18:00:00.000Z",
    "",
    "America/New_York",
  )
  assertMatch(label, /2:00\s*PM/i)
})

Deno.test("resident CONFIRM / decline / counter-propose parsing", () => {
  assertEquals(parseTenantScheduleDecision("CONFIRM"), "accept")
  assertEquals(parseTenantScheduleDecision("That works"), "accept")
  assertEquals(parseTenantScheduleDecision("No"), "decline")
  assertEquals(
    parseTenantScheduleDecision("That time doesn't work"),
    "decline",
  )
  assertEquals(
    parseTenantScheduleDecision("Can they come tomorrow?"),
    "counter_propose",
  )
  assertEquals(parseTenantScheduleDecision("I won't be home"), "decline")
})
