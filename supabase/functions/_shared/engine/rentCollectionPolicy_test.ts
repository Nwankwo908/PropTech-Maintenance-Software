import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  parseRentReminderCadenceDays,
  rentReminderSlotForToday,
  resolvePreferredLanguage,
  shouldRunRentCollectionCron,
} from "./rentCollectionPolicy.ts"
import { buildRentCollectionPrompt } from "./rentCollectionOutreachCopy.ts"

Deno.test("parseRentReminderCadenceDays sorts descending", () => {
  assertEquals(parseRentReminderCadenceDays("5, 3, 1 days before"), [5, 3, 1])
  assertEquals(parseRentReminderCadenceDays("3, 1 days before"), [3, 1])
  assertEquals(parseRentReminderCadenceDays("2, 5, 1 day before"), [5, 2, 1])
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

Deno.test("shouldRunRentCollectionCron is true on cadence days", () => {
  assertEquals(
    shouldRunRentCollectionCron(10, [5, 2, 1], new Date(2026, 7, 5)),
    true,
  )
  assertEquals(
    shouldRunRentCollectionCron(10, [5, 2, 1], new Date(2026, 7, 6)),
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
