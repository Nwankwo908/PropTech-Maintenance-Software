/** Pure rent reminder cadence policy — no I/O. */

export const DEFAULT_RENT_REMINDER_CADENCE = "5, 3, 1 days before"

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

export function rentDueDateForMonth(rentDueDay: number, date = new Date()): Date {
  const clampedDay = Math.min(Math.max(rentDueDay, 1), 28)
  return new Date(date.getFullYear(), date.getMonth(), clampedDay)
}

/** Whole days from today until rent due date (0 = due today, negative = past due). */
export function daysUntilRentDue(rentDueDay: number, date = new Date()): number {
  const due = rentDueDateForMonth(rentDueDay, date)
  const today = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const dueMidnight = new Date(due.getFullYear(), due.getMonth(), due.getDate())
  return Math.round((dueMidnight.getTime() - today.getTime()) / 86400000)
}

/**
 * Which cadence slot applies today, if any.
 * Returns days before due (5, 2, 1) or 0 on the due date itself.
 */
export function rentReminderSlotForToday(
  rentDueDay: number,
  cadenceDays: number[],
  date = new Date(),
): number | null {
  const daysUntil = daysUntilRentDue(rentDueDay, date)
  if (daysUntil === 0) return 0
  if (daysUntil > 0 && cadenceDays.includes(daysUntil)) return daysUntil
  return null
}

export function shouldRunRentCollectionCron(
  rentDueDay: number,
  cadenceDays: number[],
  date = new Date(),
): boolean {
  return rentReminderSlotForToday(rentDueDay, cadenceDays, date) != null
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
