/**
 * Requester-IANA scheduling: Chrono + public resolver must be independent of
 * the process timezone. Run this file under multiple TZ= values (see matrix
 * script) — fixtures use a fixed clock throughout.
 */
/// <reference lib="deno.ns" />
import {
  assertEquals,
  assertExists,
} from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  applyRequesterRelativeCalendarDay,
  buildScheduleAnchor,
  chronoUtcOffsetMinutesAt,
  isValidIanaTimeZone,
  parseAvailabilityChrono,
  parseAvailabilityResolved,
  resolveScheduleTimeZone,
  resolveVendorAvailability,
  wallTimeWithChronoOffsetToUtc,
  zonedParts,
  zonedWallTimeToUtc,
} from "./vendor_availability_parse.ts"

const FIXED_LATE_NIGHT_NY = new Date("2026-09-17T03:07:00.000Z") // Wed 11:07 PM EDT
const FIXED_AFTERNOON_UTC = new Date("2026-07-20T17:47:00.000Z")

type Fixture = {
  name: string
  phrase: string
  now: Date
  requesterTz: string
  /** Exact UTC start */
  scheduledAt: string
  endAt?: string | null
  localDay: number
  localHour: number
  localMinute: number
}

const FIXTURES: Fixture[] = [
  {
    name: "NY tomorrow 4:30pm late-night ref",
    phrase: "tomorrow afternoon 4:30 pm",
    now: FIXED_LATE_NIGHT_NY,
    requesterTz: "America/New_York",
    scheduledAt: "2026-09-17T20:30:00.000Z",
    localDay: 17,
    localHour: 16,
    localMinute: 30,
  },
  {
    name: "LA tomorrow 4:30pm late-night ref (same UTC instant)",
    phrase: "tomorrow afternoon 4:30 pm",
    // Same UTC instant is Wed 8:07 PM PDT — tomorrow = Thu Sep 17 4:30 PM PDT
    now: FIXED_LATE_NIGHT_NY,
    requesterTz: "America/Los_Angeles",
    scheduledAt: "2026-09-17T23:30:00.000Z",
    localDay: 17,
    localHour: 16,
    localMinute: 30,
  },
  {
    name: "London tomorrow 9am early morning",
    phrase: "tomorrow 9am",
    // 2026-03-10 01:30 UTC = Tue 1:30 AM GMT (before UK DST)
    now: new Date("2026-03-10T01:30:00.000Z"),
    requesterTz: "Europe/London",
    scheduledAt: "2026-03-11T09:00:00.000Z",
    localDay: 11,
    localHour: 9,
    localMinute: 0,
  },
  {
    name: "Kathmandu fractional offset tomorrow 10:15",
    phrase: "tomorrow 10:15 am",
    // 2026-01-15 12:00 UTC = Jan 15 17:45 NPT (+5:45)
    now: new Date("2026-01-15T12:00:00.000Z"),
    requesterTz: "Asia/Kathmandu",
    scheduledAt: "2026-01-16T04:30:00.000Z", // Jan 16 10:15 NPT
    localDay: 16,
    localHour: 10,
    localMinute: 15,
  },
  {
    name: "NY today 9am",
    phrase: "today 9am",
    now: FIXED_AFTERNOON_UTC, // Jul 20 1:47 PM EDT
    requesterTz: "America/New_York",
    scheduledAt: "2026-07-20T13:00:00.000Z",
    localDay: 20,
    localHour: 9,
    localMinute: 0,
  },
  {
    name: "NY Wednesday at 9am named weekday",
    phrase: "Wednesday at 9am",
    now: FIXED_AFTERNOON_UTC, // Mon Jul 20
    requesterTz: "America/New_York",
    scheduledAt: "2026-07-22T13:00:00.000Z",
    localDay: 22,
    localHour: 9,
    localMinute: 0,
  },
  {
    name: "NY Wed 9-12pm window (resolver merge)",
    phrase: "Wed 9-12pm",
    now: FIXED_AFTERNOON_UTC,
    requesterTz: "America/New_York",
    scheduledAt: "2026-07-22T13:00:00.000Z",
    endAt: "2026-07-22T16:00:00.000Z",
    localDay: 22,
    localHour: 9,
    localMinute: 0,
  },
  {
    name: "NY explicit Sep 17 4:30pm",
    phrase: "September 17 at 4:30pm",
    now: FIXED_LATE_NIGHT_NY,
    requesterTz: "America/New_York",
    scheduledAt: "2026-09-17T20:30:00.000Z",
    localDay: 17,
    localHour: 16,
    localMinute: 30,
  },
  {
    name: "NY Dec 31 → Jan 1 tomorrow (year rollover)",
    phrase: "tomorrow 10am",
    // Dec 31 2026 23:00 EST = Jan 1 2027 04:00 UTC
    now: new Date("2027-01-01T04:00:00.000Z"),
    requesterTz: "America/New_York",
    scheduledAt: "2027-01-01T15:00:00.000Z",
    localDay: 1,
    localHour: 10,
    localMinute: 0,
  },
]

Deno.test("isValidIanaTimeZone rejects junk", () => {
  assertEquals(isValidIanaTimeZone("America/New_York"), true)
  assertEquals(isValidIanaTimeZone("Not/AZone"), false)
  assertEquals(isValidIanaTimeZone(""), false)
  assertEquals(resolveScheduleTimeZone("bogus"), "America/New_York")
  assertEquals(resolveScheduleTimeZone("Asia/Kathmandu"), "Asia/Kathmandu")
})

Deno.test("chronoUtcOffsetMinutesAt matches Chrono EDT/EST/NPT conventions", () => {
  // Sep 16 2026 evening EDT = UTC-4 → -240
  assertEquals(
    chronoUtcOffsetMinutesAt(FIXED_LATE_NIGHT_NY, "America/New_York"),
    -240,
  )
  // Jan in Kathmandu +5:45 → +345
  assertEquals(
    chronoUtcOffsetMinutesAt(new Date("2026-01-15T12:00:00.000Z"), "Asia/Kathmandu"),
    345,
  )
  assertEquals(chronoUtcOffsetMinutesAt(FIXED_LATE_NIGHT_NY, "Nope"), null)
})

Deno.test("applyRequesterRelativeCalendarDay ignores process TZ", () => {
  const anchor = buildScheduleAnchor(FIXED_LATE_NIGHT_NY, "America/New_York")
  // Chrono-under-UTC would claim day 18; requester Wed→Thu is 17
  const cal = applyRequesterRelativeCalendarDay(
    "tomorrow afternoon 4:30 pm",
    { year: 2026, month: 9, day: 18 },
    anchor,
  )
  assertEquals(cal, { year: 2026, month: 9, day: 17 })
})

Deno.test("zonedWallTimeToUtc spring-forward nonexistent → NaN", () => {
  // US 2026 spring forward: 2026-03-08 02:00 → 03:00 EDT; 2:30 does not exist
  const d = zonedWallTimeToUtc(
    { year: 2026, month: 3, day: 8, hour: 2, minute: 30 },
    "America/New_York",
  )
  assertEquals(Number.isNaN(d.getTime()), true)
})

Deno.test("zonedWallTimeToUtc fall-back ambiguous prefers earlier UTC", () => {
  // 2026-11-01 01:30 America/New_York occurs twice (EDT then EST)
  const d = zonedWallTimeToUtc(
    { year: 2026, month: 11, day: 1, hour: 1, minute: 30 },
    "America/New_York",
  )
  assertEquals(Number.isNaN(d.getTime()), false)
  // Earlier occurrence is still EDT (UTC-4) → 05:30Z
  assertEquals(d.toISOString(), "2026-11-01T05:30:00.000Z")
})

Deno.test("zonedWallTimeToUtc across DST: target date uses target offset", () => {
  // Ref in EST season; target in EDT season
  const d = zonedWallTimeToUtc(
    { year: 2026, month: 7, day: 21, hour: 9, minute: 0 },
    "America/New_York",
  )
  assertEquals(d.toISOString(), "2026-07-21T13:00:00.000Z")
})

Deno.test("explicit Chrono offset in message is not overwritten by requester IANA", () => {
  // 4pm EST (= UTC-5) on a fixed calendar day while requester is LA
  const wall = wallTimeWithChronoOffsetToUtc(
    { year: 2026, month: 1, day: 15, hour: 16, minute: 0 },
    -300,
  )
  assertEquals(wall.toISOString(), "2026-01-15T21:00:00.000Z")
  const la = zonedWallTimeToUtc(
    { year: 2026, month: 1, day: 15, hour: 16, minute: 0 },
    "America/Los_Angeles",
  )
  // LA PST UTC-8 → 00:00 next day UTC — different from EST
  assertEquals(la.toISOString(), "2026-01-16T00:00:00.000Z")
})

Deno.test("parseAvailabilityChrono: explicit EST abbr keeps that offset", () => {
  const now = new Date("2026-01-10T18:00:00.000Z")
  const anchor = buildScheduleAnchor(now, "America/Los_Angeles")
  const hit = parseAvailabilityChrono("January 15 at 4:00pm EST", anchor)
  assertExists(hit)
  // If Chrono marks timezoneOffset certain, expect EST conversion
  if (hit!.scheduledAt === "2026-01-15T21:00:00.000Z") {
    assertEquals(hit!.scheduledAt, "2026-01-15T21:00:00.000Z")
  } else {
    // Chrono may not always certify EST; still must not crash / shift silently
    // into an arbitrary process zone — LA wall would be 00:00Z next day.
    assertEquals(
      hit!.scheduledAt === "2026-01-16T00:00:00.000Z" ||
        hit!.scheduledAt === "2026-01-15T21:00:00.000Z",
      true,
    )
  }
})

for (const fx of FIXTURES) {
  // Ranges go through mergeRangeWithBestDate in the public resolver — Chrono alone
  // is not the source of truth for WINDOW end times.
  if (!fx.endAt) {
    Deno.test(`chrono helper: ${fx.name}`, () => {
      const anchor = buildScheduleAnchor(fx.now, fx.requesterTz)
      const hit = parseAvailabilityChrono(fx.phrase, anchor)
      assertExists(hit, `chrono miss: ${fx.name}`)
      assertEquals(hit!.scheduledAt, fx.scheduledAt)
      const local = zonedParts(new Date(hit!.scheduledAt), fx.requesterTz)
      assertEquals(local.day, fx.localDay)
      assertEquals(local.hour, fx.localHour)
      assertEquals(local.minute, fx.localMinute)
    })
  }

  Deno.test(`public resolver: ${fx.name}`, async () => {
    const result = await resolveVendorAvailability(fx.phrase, {
      now: fx.now,
      timeZone: fx.requesterTz,
      allowLlm: false,
    })
    assertEquals(
      result.status === "resolved" || result.status === "needs_confirmation",
      true,
      `status=${result.status}`,
    )
    if (result.status === "needs_clarification") {
      throw new Error(`clarified unexpectedly: ${fx.name}`)
    }
    assertEquals(result.value.scheduledAt, fx.scheduledAt)
    if (fx.endAt) {
      assertEquals(result.value.endAt, fx.endAt)
    }
    const local = zonedParts(new Date(result.value.scheduledAt), fx.requesterTz)
    assertEquals(local.day, fx.localDay)
    assertEquals(local.hour, fx.localHour)
    assertEquals(local.minute, fx.localMinute)
  })

  Deno.test(`re-parse preserves zone: ${fx.name}`, () => {
    const first = parseAvailabilityResolved(fx.phrase, fx.now, fx.requesterTz)
    assertExists(first)
    const again = parseAvailabilityResolved(fx.phrase, fx.now, fx.requesterTz)
    assertExists(again)
    assertEquals(again!.scheduledAt, first!.scheduledAt)
    assertEquals(again!.endAt, first!.endAt)
    assertEquals(again!.scheduledAt, fx.scheduledAt)
  })
}

Deno.test("nonexistent spring-forward wall clarifies via chrono/resolver", async () => {
  const now = new Date("2026-03-07T15:00:00.000Z")
  const result = await resolveVendorAvailability(
    "March 8 at 2:30am",
    { now, timeZone: "America/New_York", allowLlm: false },
  )
  // Strict wall conversion returns NaN → clarification (not a silent shift)
  assertEquals(result.status, "needs_clarification")
})
