/// <reference lib="deno.ns" />
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  calendarDatePartsInTimeZone,
  effectiveRentDueDay,
  isRentCollectionPaused,
  parseRentReminderCadenceDays,
  rentReminderAmountDue,
  rentReminderSlotForToday,
  resolvePreferredLanguage,
  shouldAskLandlordRentReceiptToday,
  shouldSendOfflineTenantGraceReminder,
  shouldRunRentCollectionCron,
} from "./rentCollectionPolicy.ts"
import { buildRentCollectionPrompt } from "./rentCollectionOutreachCopy.ts"

Deno.test("parseRentReminderCadenceDays sorts descending", () => {
  assertEquals(parseRentReminderCadenceDays("5, 3, 1 days before"), [5, 3, 1])
  assertEquals(parseRentReminderCadenceDays("3, 1 days before"), [3, 1])
  assertEquals(parseRentReminderCadenceDays("2, 5, 1 day before"), [5, 2, 1])
})

Deno.test("effectiveRentDueDay prefers resident profile over portfolio default", () => {
  assertEquals(effectiveRentDueDay(15, 1), 15)
  assertEquals(effectiveRentDueDay(null, 5), 5)
  assertEquals(effectiveRentDueDay(undefined, 5), 5)
  assertEquals(effectiveRentDueDay(0, 5), 5)
  assertEquals(effectiveRentDueDay(32, 5), 5)
  assertEquals(effectiveRentDueDay(-1, 5), 5)
  assertEquals(effectiveRentDueDay(1, 10), 1)
  assertEquals(effectiveRentDueDay(31, 1), 31)
  assertEquals(effectiveRentDueDay(null, 0), 1)
})

Deno.test("isRentCollectionPaused is only true when explicitly enabled", () => {
  assertEquals(isRentCollectionPaused(true), true)
  assertEquals(isRentCollectionPaused(false), false)
  assertEquals(isRentCollectionPaused(null), false)
  assertEquals(isRentCollectionPaused(undefined), false)
})

Deno.test("resident due day shifts reminder slot vs portfolio default", () => {
  const cadence = [5, 3, 1]
  // Aug 5 local: portfolio due day 10 → 5 days before; resident due day 15 → not a slot.
  const day = new Date(2026, 7, 5)
  const portfolio = 10
  const resident = effectiveRentDueDay(15, portfolio)
  assertEquals(rentReminderSlotForToday(portfolio, cadence, day), 5)
  assertEquals(rentReminderSlotForToday(resident, cadence, day), null)
  // Aug 10: resident due day 15 → 5 days before.
  assertEquals(
    rentReminderSlotForToday(resident, cadence, new Date(2026, 7, 10)),
    5,
  )
})

Deno.test("rentReminderSlotForToday uses landlord timezone across UTC midnight", () => {
  // Sep 26 9pm Eastern = Sep 27 01:00 UTC. Cadence day is still Sep 26 in ET.
  // Due day 1 → next due Oct 1 → 5 days before.
  const instant = new Date("2026-09-27T01:00:00.000Z")
  const cadence = [5, 3, 1]
  assertEquals(
    rentReminderSlotForToday(1, cadence, instant, "America/New_York"),
    5,
  )
  assertEquals(
    rentReminderSlotForToday(1, cadence, instant, "UTC"),
    null,
  )
  assertEquals(
    shouldRunRentCollectionCron(1, cadence, instant, "America/New_York"),
    true,
  )
  assertEquals(
    shouldRunRentCollectionCron(1, cadence, instant, "UTC"),
    false,
  )
})

Deno.test("rentReminderSlotForToday rolls to next month after due day", () => {
  const cadence = [5, 3, 1]
  // Sep 26 local + due day 1 → Oct 1 is 5 days away.
  assertEquals(
    rentReminderSlotForToday(1, cadence, new Date(2026, 8, 26)),
    5,
  )
  // Sep 28 local + due day 1 → Oct 1 is 3 days away.
  assertEquals(
    rentReminderSlotForToday(1, cadence, new Date(2026, 8, 28)),
    3,
  )
  // After this month's due day, overdue receipt still uses this-month days.
  assertEquals(
    shouldAskLandlordRentReceiptToday(1, new Date(2026, 8, 26)),
    true,
  )
  assertEquals(
    shouldAskLandlordRentReceiptToday(1, new Date(2026, 8, 1)),
    true,
  )
  assertEquals(
    shouldAskLandlordRentReceiptToday(10, new Date(2026, 8, 5)),
    false,
  )
})

Deno.test("calendarDatePartsInTimeZone reads Eastern civil date", () => {
  const instant = new Date("2026-09-27T01:00:00.000Z")
  assertEquals(calendarDatePartsInTimeZone(instant, "America/New_York"), {
    year: 2026,
    month: 9,
    day: 26,
  })
  assertEquals(calendarDatePartsInTimeZone(instant, "UTC"), {
    year: 2026,
    month: 9,
    day: 27,
  })
})

Deno.test("rentReminderSlotForToday matches cadence and due date", () => {
  const rentDueDay = 10
  const cadence = [5, 2, 1]
  assertEquals(
    rentReminderSlotForToday(rentDueDay, cadence, new Date(2026, 7, 5)),
    5,
  )
  assertEquals(
    rentReminderSlotForToday(rentDueDay, cadence, new Date(2026, 7, 8)),
    2,
  )
  assertEquals(
    rentReminderSlotForToday(rentDueDay, cadence, new Date(2026, 7, 9)),
    1,
  )
  assertEquals(
    rentReminderSlotForToday(rentDueDay, cadence, new Date(2026, 7, 10)),
    0,
  )
  assertEquals(
    rentReminderSlotForToday(rentDueDay, cadence, new Date(2026, 7, 4)),
    null,
  )
})

Deno.test("shouldSendOfflineTenantGraceReminder waits for landlord unpaid/partial", () => {
  const dueAt = new Date(Date.now() + 86400000).toISOString()
  assertEquals(
    shouldSendOfflineTenantGraceReminder({
      rentStatus: null,
      runStatus: "active",
      amountDue: 2400,
      dueAt,
      reminderDates: [],
    }),
    false,
  )
  assertEquals(
    shouldSendOfflineTenantGraceReminder({
      rentStatus: "unpaid",
      runStatus: "active",
      amountDue: 2400,
      dueAt,
      reminderDates: [],
    }),
    true,
  )
  assertEquals(
    shouldSendOfflineTenantGraceReminder({
      rentStatus: "partial",
      runStatus: "active",
      amountDue: 1200,
      dueAt,
      reminderDates: [],
    }),
    true,
  )
  assertEquals(
    shouldSendOfflineTenantGraceReminder({
      rentStatus: "paid",
      runStatus: "active",
      amountDue: 2400,
      dueAt,
      reminderDates: [],
    }),
    false,
  )
  assertEquals(
    shouldSendOfflineTenantGraceReminder({
      rentStatus: "unpaid",
      runStatus: "active",
      amountDue: 2400,
      dueAt,
      reminderDates: [],
      remindersStopped: true,
    }),
    false,
  )
  const today = new Date()
  const y = today.getFullYear()
  const m = String(today.getMonth() + 1).padStart(2, "0")
  const d = String(today.getDate()).padStart(2, "0")
  assertEquals(
    shouldSendOfflineTenantGraceReminder({
      rentStatus: "unpaid",
      runStatus: "active",
      amountDue: 2400,
      dueAt,
      reminderDates: [`${y}-${m}-${d}`],
    }),
    false,
  )
  assertEquals(
    shouldSendOfflineTenantGraceReminder({
      rentStatus: "unpaid",
      runStatus: "active",
      amountDue: 2400,
      dueAt: new Date(Date.now() - 1000).toISOString(),
      reminderDates: [],
    }),
    false,
  )
})

Deno.test("shouldRunRentCollectionCron is true on cadence days and due date", () => {
  const cadence = [5, 3, 1]
  assertEquals(
    shouldRunRentCollectionCron(10, cadence, new Date(2026, 7, 5)),
    true,
  )
  assertEquals(
    shouldRunRentCollectionCron(10, cadence, new Date(2026, 7, 7)),
    true,
  )
  assertEquals(
    shouldRunRentCollectionCron(10, cadence, new Date(2026, 7, 9)),
    true,
  )
  assertEquals(
    shouldRunRentCollectionCron(10, cadence, new Date(2026, 7, 10)),
    true,
  )
  assertEquals(
    shouldRunRentCollectionCron(10, cadence, new Date(2026, 7, 6)),
    false,
  )
})

Deno.test("rentReminderAmountDue prefers open balance then monthly rent", () => {
  assertEquals(rentReminderAmountDue(1850, 1600), 1850)
  assertEquals(rentReminderAmountDue(0, 1600), 1600)
  assertEquals(rentReminderAmountDue(0, 0), 0)
})

Deno.test("shouldAskLandlordRentReceiptToday is true on/after due date", () => {
  assertEquals(
    shouldAskLandlordRentReceiptToday(10, new Date(2026, 7, 10)),
    true,
  )
  assertEquals(
    shouldAskLandlordRentReceiptToday(10, new Date(2026, 7, 12)),
    true,
  )
  assertEquals(
    shouldAskLandlordRentReceiptToday(10, new Date(2026, 7, 5)),
    false,
  )
})

Deno.test("resolvePreferredLanguage maps Spanish setting", () => {
  assertEquals(resolvePreferredLanguage("Spanish (US)"), "es_us")
  assertEquals(resolvePreferredLanguage("English (US)"), "en_us")
})

Deno.test("buildRentCollectionPrompt uses Spanish copy", () => {
  const body = buildRentCollectionPrompt({
    amountDue: 1200,
    rentDueDate: "2026-08-10",
    daysBeforeDue: 1,
    language: "es_us",
  })
  assertEquals(body.includes("Hola, somos el equipo"), true)
  assertEquals(body.includes("PAGADO"), true)
})
