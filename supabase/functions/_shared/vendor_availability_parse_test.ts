/// <reference lib="deno.ns" />
import {
  assertEquals,
  assertExists,
} from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  buildScheduleAnchor,
  buildSoftClarificationPrompt,
  buildSoftConfirmationPrompt,
  parseAvailabilityChrono,
  parseAvailabilityRegex,
  parseAvailabilityToScheduledAt,
  resolveVendorAvailability,
  zonedWallTimeToUtc,
} from "./vendor_availability_parse.ts"
import {
  buildVendorScheduleClarifySms,
  buildVendorScheduleSaveRetrySms,
  buildVendorScheduleSoftConfirmSms,
} from "./vendor_outreach_copy.ts"

const TZ = "America/New_York"

Deno.test("buildScheduleAnchor includes dynamic today label", () => {
  // 2026-07-20 17:47 UTC = 1:47 PM Eastern (EDT)
  const now = new Date("2026-07-20T17:47:00.000Z")
  const anchor = buildScheduleAnchor(now, TZ)
  assertEquals(anchor.timeZone, TZ)
  assertEquals(anchor.todayLabel.includes("July"), true)
  assertEquals(anchor.todayLabel.includes("2026"), true)
  assertEquals(anchor.nowTimeLabel.includes("PM") || anchor.nowTimeLabel.includes("AM"), true)
})

Deno.test("zonedWallTimeToUtc maps Eastern 9am correctly", () => {
  // Jul 21 2026 9:00 AM EDT = 13:00 UTC
  const d = zonedWallTimeToUtc(
    { year: 2026, month: 7, day: 21, hour: 9, minute: 0 },
    TZ,
  )
  assertEquals(d.toISOString(), "2026-07-21T13:00:00.000Z")
})

Deno.test("regex parses Tomorrow 9am in Eastern", () => {
  const now = new Date("2026-07-20T17:47:00.000Z")
  const anchor = buildScheduleAnchor(now, TZ)
  const hit = parseAvailabilityRegex("Tomorrow 9am", anchor)
  assertExists(hit)
  assertEquals(hit!.scheduledAt, "2026-07-21T13:00:00.000Z")
  assertEquals(hit!.confidence, "high")
})

Deno.test("regex range 9-12pm uses 9am start", () => {
  const now = new Date("2026-07-20T17:47:00.000Z")
  const anchor = buildScheduleAnchor(now, TZ)
  const range = parseAvailabilityRegex("Tomorrow 9-12pm", anchor)
  const nine = parseAvailabilityRegex("Tomorrow 9am", anchor)
  assertExists(range)
  assertExists(nine)
  assertEquals(range!.scheduledAt, nine!.scheduledAt)
})

Deno.test("chrono parses Tomorrow 9am with timezone anchor", () => {
  const now = new Date("2026-07-20T17:47:00.000Z")
  const anchor = buildScheduleAnchor(now, TZ)
  const hit = parseAvailabilityChrono("Tomorrow 9am", anchor)
  assertExists(hit)
  assertEquals(hit!.scheduledAt, "2026-07-21T13:00:00.000Z")
})

Deno.test("resolve high-confidence locks without soft confirm", async () => {
  const now = new Date("2026-07-20T17:47:00.000Z")
  const result = await resolveVendorAvailability("Tomorrow 9am", {
    now,
    timeZone: TZ,
    allowLlm: false,
  })
  assertEquals(result.status, "resolved")
  if (result.status === "resolved") {
    assertEquals(result.value.scheduledAt, "2026-07-21T13:00:00.000Z")
  }
})

Deno.test("resolve vague text asks soft confirmation or clarification", async () => {
  const now = new Date("2026-07-20T17:47:00.000Z")
  const result = await resolveVendorAvailability("tomorrow morning", {
    now,
    timeZone: TZ,
    allowLlm: false,
  })
  assertEquals(
    result.status === "needs_confirmation" ||
      result.status === "needs_clarification",
    true,
  )
})

Deno.test("soft confirmation copy is forgiving", () => {
  assertEquals(
    buildVendorScheduleSoftConfirmSms("Tomorrow 9am"),
    "Got it — Tomorrow 9am. Reply YES to confirm, or send a different time.",
  )
  assertEquals(
    buildVendorScheduleClarifySms(),
    "Thanks — what day and time works best? For example: Tomorrow 9am.",
  )
  assertEquals(
    buildVendorScheduleSaveRetrySms("Tomorrow 9am"),
    "I have Tomorrow 9am — reply YES and I'll lock it in.",
  )
  assertEquals(
    buildSoftConfirmationPrompt({
      scheduledAt: "2026-07-21T13:00:00.000Z",
      endAt: null,
      windowLabel: "Tomorrow 9am",
      confidence: "medium",
      source: "chrono",
    }).includes("Reply YES"),
    true,
  )
  assertEquals(buildSoftClarificationPrompt().includes("day and time"), true)
})

Deno.test("parseAvailabilityToScheduledAt re-export stays timezone aware", () => {
  const now = new Date("2026-07-20T17:47:00.000Z")
  const iso = parseAvailabilityToScheduledAt("Tomorrow 9am", now, TZ)
  assertEquals(iso, "2026-07-21T13:00:00.000Z")
})
