import {
  assertEquals,
  assert,
} from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  AMBIGUOUS_MULTI_ZONE_US_STATES,
  DEFAULT_QUIET_HOURS_END,
  DEFAULT_QUIET_HOURS_START,
  DEFAULT_RESIDENT_TIME_ZONE,
  classifyPropertyTimezoneBackfillConfidence,
  formatQuietHoursConfirmSms,
  inferTimeZoneFromUsAddress,
  inferTimeZoneFromUsState,
  isWithinQuietHoursWindow,
  nextQuietHoursEndMs,
  parseQuietHoursSmsCommand,
  resolveQuietHoursWindow,
  resolveResidentSendTiming,
  shouldHoldResidentQuietHours,
} from "./residentSendTiming.ts"
import {
  decideShouldSendAutomatedMessage,
  isWithinResidentQuietHours,
} from "./shouldSendAutomatedMessage.ts"
import { rentReminderSlotForToday } from "./engine/rentCollectionPolicy.ts"

Deno.test("DEFAULT quiet hours constants are 21 and 8", () => {
  assertEquals(DEFAULT_QUIET_HOURS_START, 21)
  assertEquals(DEFAULT_QUIET_HOURS_END, 8)
})

Deno.test("resolveQuietHoursWindow uses defaults when resident null", () => {
  const w = resolveQuietHoursWindow(null)
  assertEquals(w.startHour, 21)
  assertEquals(w.endHour, 8)
  assertEquals(w.source, "default")
})

Deno.test("resolveQuietHoursWindow honors resident override ending at 6 AM", () => {
  const w = resolveQuietHoursWindow({
    quiet_hours_start: 22,
    quiet_hours_end: 6,
  })
  assertEquals(w.startHour, 22)
  assertEquals(w.endHour, 6)
  assertEquals(w.source, "resident_override")
})

Deno.test("timezone precedence: resident > property > default (never UTC)", () => {
  const resident = resolveResidentSendTiming({
    resident: { timezone: "America/Chicago" },
    propertyTimeZone: "America/Denver",
    logFallbacks: false,
  })
  assertEquals(resident.timeZone, "America/Chicago")
  assertEquals(resident.timeZoneTier, "resident_timezone")

  const property = resolveResidentSendTiming({
    resident: null,
    propertyTimeZone: "America/Denver",
    logFallbacks: false,
  })
  assertEquals(property.timeZone, "America/Denver")
  assertEquals(property.timeZoneTier, "property_timezone")

  const fallback = resolveResidentSendTiming({
    resident: { timezone: "UTC" },
    propertyTimeZone: null,
    logFallbacks: false,
  })
  assertEquals(fallback.timeZone, DEFAULT_RESIDENT_TIME_ZONE)
  assertEquals(fallback.timeZoneTier, "default_america_new_york")
  assert(fallback.timeZone !== "UTC")
})

Deno.test("three timezones: default quiet hours defer independently", () => {
  // Same UTC instant: 2026-09-28 07:10 UTC
  // ET 03:10 quiet, CT 02:10 quiet, PT 00:10 quiet
  const nowMs = Date.parse("2026-09-28T07:10:00.000Z")
  for (
    const tz of [
      "America/New_York",
      "America/Chicago",
      "America/Los_Angeles",
    ] as const
  ) {
    assertEquals(
      isWithinQuietHoursWindow(nowMs, tz, 21, 8),
      true,
      `${tz} should be in quiet hours`,
    )
  }

  // 12:10 UTC = 08:10 ET (outside), 07:10 CT (inside), 05:10 PT (inside)
  const later = Date.parse("2026-09-28T12:10:00.000Z")
  assertEquals(isWithinQuietHoursWindow(later, "America/New_York", 21, 8), false)
  assertEquals(isWithinQuietHoursWindow(later, "America/Chicago", 21, 8), true)
  assertEquals(
    isWithinQuietHoursWindow(later, "America/Los_Angeles", 21, 8),
    true,
  )

  // ET resident deferred until ~8 AM ET; CT still held — not a shared batch fire.
  const etEnd = nextQuietHoursEndMs(nowMs, "America/New_York", 8)
  assertEquals(isWithinQuietHoursWindow(etEnd, "America/New_York", 21, 8), false)
  assertEquals(isWithinQuietHoursWindow(etEnd, "America/Chicago", 21, 8), true)
})

Deno.test("custom quiet hours ending 6 AM gates that resident only", () => {
  // 2026-09-28 10:30 UTC = 06:30 ET — default (end 8) still quiet; override end 6 is open
  const nowMs = Date.parse("2026-09-28T10:30:00.000Z")
  const defaultWindow = resolveQuietHoursWindow(null)
  const custom = resolveQuietHoursWindow({
    quiet_hours_start: 21,
    quiet_hours_end: 6,
  })
  assertEquals(
    isWithinQuietHoursWindow(
      nowMs,
      "America/New_York",
      defaultWindow.startHour,
      defaultWindow.endHour,
    ),
    true,
  )
  assertEquals(
    isWithinQuietHoursWindow(
      nowMs,
      "America/New_York",
      custom.startHour,
      custom.endHour,
    ),
    false,
  )
})

Deno.test("reminder holds during quiet hours; emergency bypasses; reminder never bypasses", () => {
  const nowMs = Date.parse("2026-09-28T07:10:00.000Z")
  const quietHours = resolveQuietHoursWindow(null)
  assertEquals(
    shouldHoldResidentQuietHours({
      nowMs,
      timeZone: "America/New_York",
      quietHours,
      isReminder: true,
      bypass: "emergency_habitability",
    }),
    true,
  )
  assertEquals(
    shouldHoldResidentQuietHours({
      nowMs,
      timeZone: "America/New_York",
      quietHours,
      isReminder: false,
      bypass: "emergency_habitability",
    }),
    false,
  )

  const decision = decideShouldSendAutomatedMessage({
    messageType: "rent_reminder",
    audience: "resident",
    timeZone: "America/New_York",
    quietHours,
    bypassQuietHours: "emergency_habitability",
    nowMs,
    recentAutomatedToRecipient: 0,
  })
  assertEquals(decision.action, "hold_quiet_hours")

  const emergency = decideShouldSendAutomatedMessage({
    messageType: "other",
    audience: "resident",
    timeZone: "America/New_York",
    quietHours,
    bypassQuietHours: "emergency_habitability",
    nowMs,
    recentAutomatedToRecipient: 0,
  })
  assertEquals(emergency.action, "send")
})

Deno.test("deferred overnight: hold then send exactly once after quiet hours end", () => {
  const tz = "America/New_York"
  const quietHours = resolveQuietHoursWindow(null)
  const during = Date.parse("2026-09-28T07:10:00.000Z") // 3:10 AM ET
  const hold = decideShouldSendAutomatedMessage({
    messageType: "rent_reminder",
    audience: "resident",
    timeZone: tz,
    quietHours,
    nowMs: during,
    recentAutomatedToRecipient: 0,
  })
  assertEquals(hold.action, "hold_quiet_hours")
  assert(hold.action === "hold_quiet_hours" && hold.deferUntilIso)

  const afterQuiet = Date.parse(hold.deferUntilIso!)
  const send = decideShouldSendAutomatedMessage({
    messageType: "rent_reminder",
    audience: "resident",
    timeZone: tz,
    quietHours,
    nowMs: afterQuiet,
    recentAutomatedToRecipient: 0,
  })
  assertEquals(send.action, "send")

  // Idempotency: once "sent" cooldown suppresses a duplicate same-ticket retry.
  const again = decideShouldSendAutomatedMessage({
    messageType: "rent_reminder",
    audience: "resident",
    timeZone: tz,
    quietHours,
    nowMs: afterQuiet + 60_000,
    recentAutomatedToRecipient: 1,
    ticketId: "ticket-1",
  })
  assertEquals(again.action, "suppress")
})

Deno.test("DST spring forward: local quiet window shifts with zone rules", () => {
  // US DST spring 2026: Sun Mar 8 02:00 → 03:00 America/New_York
  // Sat Mar 7 2026 06:00 UTC = Fri Mar 6 01:00 EST — quiet
  const beforeDst = Date.parse("2026-03-07T06:00:00.000Z")
  assertEquals(isWithinResidentQuietHours(beforeDst, "America/New_York"), true)

  // Mon Mar 9 2026 12:00 UTC = Mon Mar 9 08:00 EDT — quiet hours just ended
  const afterDstMorning = Date.parse("2026-03-09T12:00:00.000Z")
  assertEquals(
    isWithinResidentQuietHours(afterDstMorning, "America/New_York"),
    false,
  )

  // Mon Mar 9 2026 11:00 UTC = Mon Mar 9 07:00 EDT — still quiet (DST hour shifted)
  const afterDstStillQuiet = Date.parse("2026-03-09T11:00:00.000Z")
  assertEquals(
    isWithinResidentQuietHours(afterDstStillQuiet, "America/New_York"),
    true,
  )
})

Deno.test("parse QUIET SMS commands", () => {
  assertEquals(parseQuietHoursSmsCommand("QUIET 10PM-7AM"), {
    kind: "set",
    startHour: 22,
    endHour: 7,
  })
  assertEquals(parseQuietHoursSmsCommand("quiet 22-6"), {
    kind: "set",
    startHour: 22,
    endHour: 6,
  })
  assertEquals(parseQuietHoursSmsCommand("QUIET OFF"), { kind: "clear" })
  assertEquals(parseQuietHoursSmsCommand("hello") == null, true)
  assert(formatQuietHoursConfirmSms({ startHour: 22, endHour: 7 }).includes("10 PM"))
})

/**
 * Incident regression (2026-09-28 ~07:10 UTC):
 * Landlord time_zone = America/Los_Angeles, property/resident in America/New_York.
 * Rent cron still may use landlords.time_zone for cadence/due-date, but quiet hours
 * must evaluate against resolved resident send TZ (resident → property → default),
 * NOT landlords.time_zone. At 07:10 UTC ≈ 03:10 ET the reminder is deferred.
 */
Deno.test(
  "incident: LA landlord + NY property — rent reminder at 07:10 UTC deferred on property TZ",
  () => {
    const landlordTimeZone = "America/Los_Angeles"
    const propertyTimeZone = "America/New_York"
    const incidentNowMs = Date.parse("2026-09-28T07:10:00.000Z")

    // Quiet-hours resolution ignores landlord TZ — property wins when resident has none.
    const timing = resolveResidentSendTiming({
      resident: null,
      propertyTimeZone,
      logFallbacks: false,
    })
    assertEquals(timing.timeZone, "America/New_York")
    assertEquals(timing.timeZoneTier, "property_timezone")
    assert(timing.timeZone !== landlordTimeZone)

    // Cadence/due-date logic may still key off landlord TZ independently.
    const cadenceDays = [5, 3, 1]
    const landlordSlot = rentReminderSlotForToday(
      1,
      cadenceDays,
      new Date(incidentNowMs),
      landlordTimeZone,
    )
    // Oct 1 due → Sep 28 is 3 days before in both LA and NY calendars.
    assertEquals(landlordSlot, 3)

    const quietHours = resolveQuietHoursWindow(null)
    // ~3:10 AM ET → inside default 21–08 quiet hours.
    assertEquals(
      isWithinQuietHoursWindow(
        incidentNowMs,
        timing.timeZone,
        quietHours.startHour,
        quietHours.endHour,
      ),
      true,
    )

    const decision = decideShouldSendAutomatedMessage({
      messageType: "rent_reminder",
      audience: "resident",
      timeZone: timing.timeZone, // must be property-resolved, not landlordTimeZone
      quietHours,
      nowMs: incidentNowMs,
      recentAutomatedToRecipient: 0,
    })
    assertEquals(decision.action, "hold_quiet_hours")

    // If quiet hours wrongly used landlord LA at this instant it would also hold
    // (midnight PT). Prove divergence later the same morning: 14:10 UTC =
    // 10:10 AM ET (send) vs 7:10 AM PT (still quiet on landlord clock).
    const divergeMs = Date.parse("2026-09-28T14:10:00.000Z")
    const onProperty = decideShouldSendAutomatedMessage({
      messageType: "rent_reminder",
      audience: "resident",
      timeZone: timing.timeZone,
      quietHours,
      nowMs: divergeMs,
      recentAutomatedToRecipient: 0,
    })
    const onLandlord = decideShouldSendAutomatedMessage({
      messageType: "rent_reminder",
      audience: "resident",
      timeZone: landlordTimeZone,
      quietHours,
      nowMs: divergeMs,
      recentAutomatedToRecipient: 0,
    })
    assertEquals(onProperty.action, "send")
    assertEquals(onLandlord.action, "hold_quiet_hours")
  },
)

Deno.test("backfill confidence: high vs ambiguous multi-zone vs missing", () => {
  assertEquals(classifyPropertyTimezoneBackfillConfidence("NY"), "high_confidence")
  assertEquals(classifyPropertyTimezoneBackfillConfidence("Maryland"), "high_confidence")
  assertEquals(inferTimeZoneFromUsState("NY"), "America/New_York")
  // State-only OR stays manual; ZIP resolves Portland-metro to Pacific.
  assertEquals(classifyPropertyTimezoneBackfillConfidence("OR"), "manual_review")
  assertEquals(inferTimeZoneFromUsState("OR"), null)
  assertEquals(
    classifyPropertyTimezoneBackfillConfidence("OR", "97209"),
    "high_confidence",
  )
  assertEquals(
    inferTimeZoneFromUsAddress({ state: "OR", zip: "97209" }),
    "America/Los_Angeles",
  )
  assertEquals(
    inferTimeZoneFromUsAddress({ state: "OR", zip: "97914" }),
    "America/Denver",
  )
  // FL without ZIP = manual; Palm Springs 33461 = Eastern via ZIP majority.
  assertEquals(classifyPropertyTimezoneBackfillConfidence("FL"), "manual_review")
  assertEquals(
    classifyPropertyTimezoneBackfillConfidence("FL", "33461"),
    "high_confidence",
  )
  assertEquals(
    inferTimeZoneFromUsAddress({ state: "FL", zip: "33461" }),
    "America/New_York",
  )
  assertEquals(
    inferTimeZoneFromUsAddress({ state: "FL", zip: "32501" }),
    "America/Chicago",
  )
  assertEquals(classifyPropertyTimezoneBackfillConfidence(""), "missing")
  assertEquals(classifyPropertyTimezoneBackfillConfidence("ZZ"), "malformed")
  assert(AMBIGUOUS_MULTI_ZONE_US_STATES.has("TX"))
})
