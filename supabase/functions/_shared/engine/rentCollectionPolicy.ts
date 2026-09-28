/** Pure rent reminder cadence policy — no I/O. */

export const DEFAULT_RENT_REMINDER_CADENCE = "5, 3, 1 days before"
export const DEFAULT_RENT_REMINDER_TIME_ZONE = "America/New_York"

/** Parse landlord cadence labels like "5, 3, 1 days before" → [5, 3, 1]. */
export function parseRentReminderCadenceDays(
  cadence: string | null | undefined,
): number[] {
  const raw = cadence?.trim() || DEFAULT_RENT_REMINDER_CADENCE
  const nums = [...raw.matchAll(/\d+/g)]
    .map((match) => Number.parseInt(match[0], 10))
    .filter((n) => Number.isFinite(n) && n > 0 && n <= 31)
  const unique = [...new Set(nums)]
  unique.sort((a, b) => b - a)
  return unique.length ? unique : [1]
}

export type CalendarDateParts = {
  year: number
  /** 1–12 */
  month: number
  day: number
}

/** Calendar Y/M/D in an IANA timezone (falls back to the Date's local zone). */
export function calendarDatePartsInTimeZone(
  date: Date,
  timeZone?: string | null,
): CalendarDateParts {
  const tz = timeZone?.trim()
  if (!tz) {
    return {
      year: date.getFullYear(),
      month: date.getMonth() + 1,
      day: date.getDate(),
    }
  }
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date)
    const year = Number(parts.find((p) => p.type === "year")?.value)
    const month = Number(parts.find((p) => p.type === "month")?.value)
    const day = Number(parts.find((p) => p.type === "day")?.value)
    if (
      Number.isFinite(year) &&
      Number.isFinite(month) &&
      Number.isFinite(day)
    ) {
      return { year, month, day }
    }
  } catch {
    // Invalid IANA zone — fall through to local.
  }
  return {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
  }
}

function clampRentDueDay(rentDueDay: number): number {
  return Math.min(Math.max(Math.trunc(rentDueDay), 1), 28)
}

function daysBetweenCalendarDates(
  from: CalendarDateParts,
  to: CalendarDateParts,
): number {
  // Noon UTC avoids DST edge cases when differencing civil dates.
  const start = Date.UTC(from.year, from.month - 1, from.day, 12)
  const end = Date.UTC(to.year, to.month - 1, to.day, 12)
  return Math.round((end - start) / 86400000)
}

/** This calendar month's rent due Y/M/D (may already be past if today > due day). */
export function rentDueDatePartsForMonth(
  rentDueDay: number,
  date = new Date(),
  timeZone?: string | null,
): CalendarDateParts {
  const today = calendarDatePartsInTimeZone(date, timeZone)
  return {
    year: today.year,
    month: today.month,
    day: clampRentDueDay(rentDueDay),
  }
}

/**
 * Next upcoming rent due date in the landlord timezone.
 * When today's day-of-month is past the due day, rolls to next month
 * (e.g. Sep 26 + due day 1 → Oct 1, not Sep 1).
 */
export function nextRentDueDateParts(
  rentDueDay: number,
  date = new Date(),
  timeZone?: string | null,
): CalendarDateParts {
  const today = calendarDatePartsInTimeZone(date, timeZone)
  const day = clampRentDueDay(rentDueDay)
  if (today.day <= day) {
    return { year: today.year, month: today.month, day }
  }
  let month = today.month + 1
  let year = today.year
  if (month > 12) {
    month = 1
    year += 1
  }
  return { year, month, day }
}

export function rentDueDateForMonth(
  rentDueDay: number,
  date = new Date(),
  timeZone?: string | null,
): Date {
  const parts = rentDueDatePartsForMonth(rentDueDay, date, timeZone)
  return new Date(parts.year, parts.month - 1, parts.day)
}

/** Whole days until this month's due date (0 = due today, negative = past due). */
export function daysUntilRentDue(
  rentDueDay: number,
  date = new Date(),
  timeZone?: string | null,
): number {
  const today = calendarDatePartsInTimeZone(date, timeZone)
  const due = rentDueDatePartsForMonth(rentDueDay, date, timeZone)
  return daysBetweenCalendarDates(today, due)
}

/** Whole days until the next upcoming rent due (never negative). */
export function daysUntilNextRentDue(
  rentDueDay: number,
  date = new Date(),
  timeZone?: string | null,
): number {
  const today = calendarDatePartsInTimeZone(date, timeZone)
  const due = nextRentDueDateParts(rentDueDay, date, timeZone)
  return daysBetweenCalendarDates(today, due)
}

/**
 * Which cadence slot applies today, if any.
 * Returns days before due (5, 2, 1) or 0 on the due date itself.
 * Pass `timeZone` so Edge (UTC) matches the landlord calendar day.
 * Uses the next upcoming due date so late-month "5 days before day 1" works.
 */
export function rentReminderSlotForToday(
  rentDueDay: number,
  cadenceDays: number[],
  date = new Date(),
  timeZone?: string | null,
): number | null {
  const daysUntil = daysUntilNextRentDue(rentDueDay, date, timeZone)
  if (daysUntil === 0) return 0
  if (daysUntil > 0 && cadenceDays.includes(daysUntil)) return daysUntil
  return null
}

export function shouldRunRentCollectionCron(
  rentDueDay: number,
  cadenceDays: number[],
  date = new Date(),
  timeZone?: string | null,
): boolean {
  return rentReminderSlotForToday(rentDueDay, cadenceDays, date, timeZone) !=
    null
}

/** Amount to put on a rent reminder: open balance, else contracted monthly rent. */
export function rentReminderAmountDue(balanceDue: number, monthlyRent: number): number {
  if (Number.isFinite(balanceDue) && balanceDue > 0) return balanceDue
  if (Number.isFinite(monthlyRent) && monthlyRent > 0) return monthlyRent
  return 0
}

/** Payments-off: ask the landlord on due day and each overdue day until answered. */
export function shouldAskLandlordRentReceiptToday(
  rentDueDay: number,
  date = new Date(),
  timeZone?: string | null,
): boolean {
  return daysUntilRentDue(rentDueDay, date, timeZone) <= 0
}

export function todayIsoInTimeZone(
  date = new Date(),
  timeZone?: string | null,
): string {
  const parts = calendarDatePartsInTimeZone(date, timeZone)
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${
    String(parts.day).padStart(2, "0")
  }`
}

function todayIsoFromDate(date: Date): string {
  return todayIsoInTimeZone(date, null)
}

/**
 * Payments-off: text the tenant only after the landlord marks unpaid/partial,
 * only while the grace window is still open, and at most once per calendar day.
 */
export function shouldSendOfflineTenantGraceReminder(params: {
  rentStatus: string | null | undefined
  runStatus: string | null | undefined
  amountDue: number
  dueAt: string | null | undefined
  reminderDates: string[] | null | undefined
  remindersStopped?: boolean
  now?: Date
  timeZone?: string | null
}): boolean {
  const status = (params.rentStatus ?? "").trim().toLowerCase()
  if (status === "paid") return false
  if (status !== "unpaid" && status !== "partial") return false
  if (params.remindersStopped) return false
  if ((params.runStatus ?? "").trim() !== "active") return false
  if (!(params.amountDue > 0)) return false
  const dueAt = params.dueAt?.trim()
  if (!dueAt) return false
  const now = params.now ?? new Date()
  if (new Date(dueAt).getTime() < now.getTime()) return false
  const today = todayIsoInTimeZone(now, params.timeZone)
  const sent = params.reminderDates ?? []
  return !sent.includes(today)
}

export type PreferredLanguageId = "en_us" | "es_us"

export function resolvePreferredLanguage(
  label: string | null | undefined,
): PreferredLanguageId {
  const normalized = label?.trim().toLowerCase() ?? ""
  if (normalized.startsWith("spanish")) return "es_us"
  return "en_us"
}

export function localeForPreferredLanguage(language: PreferredLanguageId): string {
  return language === "es_us" ? "es-US" : "en-US"
}
