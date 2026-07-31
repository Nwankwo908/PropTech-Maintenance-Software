/// <reference lib="deno.ns" />
import {
  assertEquals,
  assertExists,
} from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  buildScheduleAnchor,
  buildSoftClarificationPrompt,
  buildSoftConfirmationPrompt,
  classifyArrivalWindow,
  extractNamedWeekdayIndex,
  parseAvailabilityChrono,
  parseAvailabilityRegex,
  parseAvailabilityResolved,
  parseAvailabilityToScheduledAt,
  resolveNamedWeekdayDate,
  resolveVendorAvailability,
  softAnchorArrivalWindow,
  toArrivalEntity,
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

Deno.test("bounded range resolves for tenant ask", async () => {
  const now = new Date("2026-07-20T17:47:00.000Z")
  const result = await resolveVendorAvailability("Tomorrow 9-12pm", {
    now,
    timeZone: TZ,
    allowLlm: false,
  })
  assertEquals(result.status, "resolved")
  if (result.status === "resolved") {
    assertEquals(classifyArrivalWindow(result.value, "Tomorrow 9-12pm"), "bounded")
    assertEquals(result.value.endAt != null, true)
  }
})

Deno.test("oversized range soft-anchors to a tighter window", async () => {
  const now = new Date("2026-07-20T17:47:00.000Z")
  const result = await resolveVendorAvailability("Tomorrow 9am-5pm", {
    now,
    timeZone: TZ,
    allowLlm: false,
  })
  assertEquals(result.status, "needs_confirmation")
  if (result.status === "needs_confirmation") {
    assertEquals(result.softPrompt.includes("tighter"), true)
    assertEquals(result.value.endAt != null, true)
  }
})

Deno.test("unbounded after-time asks for a specific window", async () => {
  const now = new Date("2026-07-20T17:47:00.000Z")
  const result = await resolveVendorAvailability("after 3pm", {
    now,
    timeZone: TZ,
    allowLlm: false,
  })
  assertEquals(result.status, "needs_clarification")
})

Deno.test("softAnchorArrivalWindow caps duration", () => {
  const anchored = softAnchorArrivalWindow(
    {
      scheduledAt: "2026-07-21T15:00:00.000Z",
      endAt: "2026-07-21T21:00:00.000Z",
      windowLabel: "Wed 11am-5pm",
      confidence: "high",
      source: "regex",
    },
    TZ,
  )
  assertEquals(anchored.windowLabel.includes("between"), true)
})

Deno.test("soft confirmation copy is forgiving", () => {
  assertEquals(
    buildVendorScheduleSoftConfirmSms("Tomorrow 9am"),
    "Got it — Tomorrow 9am. Reply YES to send that to the tenant, or send a different window.",
  )
  assertEquals(
    buildVendorScheduleClarifySms().includes("arrival window"),
    true,
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
  assertEquals(buildSoftClarificationPrompt().includes("arrival window"), true)
})

Deno.test("parseAvailabilityToScheduledAt re-export stays timezone aware", () => {
  const now = new Date("2026-07-20T17:47:00.000Z")
  const iso = parseAvailabilityToScheduledAt("Tomorrow 9am", now, TZ)
  assertEquals(iso, "2026-07-21T13:00:00.000Z")
})

Deno.test("named weekday abbrev never pins to a different today", () => {
  // Tuesday Jul 21, 2026 5pm ET
  const now = new Date("2026-07-21T21:00:00.000Z")
  const anchor = buildScheduleAnchor(now, TZ)
  assertEquals(extractNamedWeekdayIndex("Wed 9-12pm"), 3)
  const date = resolveNamedWeekdayDate(3, anchor)
  assertEquals(date.year, 2026)
  assertEquals(date.month, 7)
  assertEquals(date.day, 22)
})

Deno.test("Wed 9-12pm resolves WINDOW on next Wednesday (not today)", async () => {
  const now = new Date("2026-07-21T21:00:00.000Z") // Tuesday
  const result = await resolveVendorAvailability("Wed 9-12pm", {
    now,
    timeZone: TZ,
    allowLlm: false,
  })
  assertEquals(result.status, "resolved")
  if (result.status === "resolved") {
    assertEquals(result.value.scheduledAt, "2026-07-22T13:00:00.000Z")
    assertEquals(result.value.endAt, "2026-07-22T16:00:00.000Z")
    assertEquals(result.value.entity?.type, "WINDOW")
    assertEquals(result.value.entity?.date, "2026-07-22")
    assertEquals(result.value.entity?.start_time, "09:00")
    assertEquals(result.value.entity?.end_time, "12:00")
    assertEquals(
      result.value.entity?.display_text,
      "Wednesday, Jul 22 between 9:00 AM and 12:00 PM",
    )
  }
})

Deno.test("Wed at 12pm resolves EXACT confirmation copy", async () => {
  const now = new Date("2026-07-21T21:00:00.000Z") // Tuesday
  const result = await resolveVendorAvailability("Wed at 12pm", {
    now,
    timeZone: TZ,
    allowLlm: false,
  })
  assertEquals(result.status, "resolved")
  if (result.status === "resolved") {
    assertEquals(result.value.entity?.type, "EXACT")
    assertEquals(result.value.entity?.end_time, null)
    assertEquals(
      result.value.entity?.display_text,
      "Wednesday, Jul 22 at 12:00 PM",
    )
    assertEquals(
      buildSoftConfirmationPrompt(result.value, TZ).startsWith(
        "Got it — Wednesday, Jul 22 at 12:00 PM.",
      ),
      true,
    )
  }
})

Deno.test("WINDOW soft confirm uses between copy", () => {
  const scheduledAt = "2026-07-22T13:00:00.000Z"
  const endAt = "2026-07-22T16:00:00.000Z"
  const entity = toArrivalEntity(scheduledAt, endAt, TZ)
  assertEquals(entity.type, "WINDOW")
  assertEquals(
    buildSoftConfirmationPrompt(
      {
        scheduledAt,
        endAt,
        windowLabel: entity.display_text,
        confidence: "medium",
        source: "regex",
        entity,
      },
      TZ,
    ),
    "Got it — Wednesday, Jul 22 between 9:00 AM and 12:00 PM. Reply YES to send that to the tenant, or send a different window.",
  )
})

Deno.test("re-parse correction keeps WINDOW endAt", () => {
  const now = new Date("2026-07-21T21:00:00.000Z")
  const hit = parseAvailabilityResolved("Wed 9am-12pm", now, TZ)
  assertExists(hit)
  assertEquals(hit!.entity?.type, "WINDOW")
  assertEquals(hit!.endAt, "2026-07-22T16:00:00.000Z")
  assertEquals(hit!.scheduledAt, "2026-07-22T13:00:00.000Z")
})

Deno.test("regex Wed abbrev uses next Wednesday", () => {
  const now = new Date("2026-07-21T21:00:00.000Z")
  const anchor = buildScheduleAnchor(now, TZ)
  const hit = parseAvailabilityRegex("Wed 9-12pm", anchor)
  assertExists(hit)
  assertEquals(hit!.scheduledAt, "2026-07-22T13:00:00.000Z")
  assertEquals(hit!.endAt, "2026-07-22T16:00:00.000Z")
})
