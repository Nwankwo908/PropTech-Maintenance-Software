import type { PropertyOperationsTimelineEvent } from '@/lib/propertyOperationsGraph'

export type ResidentCalendarEventKind = 'rent' | 'rent_reminder' | 'maintenance'

export type ResidentCalendarEvent = {
  id?: string
  date: string
  kind: ResidentCalendarEventKind
  label: string
  daysBeforeDue?: number
  clock?: { time: string; meridiem: string }
}

const VISIT_CONFIRMED_EVENT_TYPE = 'maintenance.schedule_confirmed'

const DEFAULT_REMINDER_DAYS = [5, 3, 1]

/** Parse landlord cadence labels like "5, 3, 1 days before" → [5, 3, 1]. */
export function parseRentReminderCadenceDays(cadence: string | null | undefined): number[] {
  const raw = cadence?.trim() ?? ''
  const nums = [...raw.matchAll(/\d+/g)]
    .map((match) => Number.parseInt(match[0], 10))
    .filter((n) => Number.isFinite(n) && n > 0 && n <= 31)
  const unique = [...new Set(nums)]
  unique.sort((a, b) => b - a)
  return unique.length ? unique : [...DEFAULT_REMINDER_DAYS]
}

export function parseIsoDateOnly(value: string | null | undefined): string | null {
  const raw = (value ?? '').trim()
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})/)
  if (!match) return null
  const iso = match[1]!
  const year = Number(iso.slice(0, 4))
  const month = Number(iso.slice(5, 7))
  const day = Number(iso.slice(8, 10))
  if (!Number.isFinite(year) || month < 1 || month > 12 || day < 1 || day > 31) return null
  const last = daysInMonth(year, month)
  if (day > last) return null
  return iso
}

export function toIsoDate(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

export function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate()
}

export function rentDueIsoForMonth(year: number, month: number, dueDay: number): string {
  const day = Math.min(Math.max(Math.trunc(dueDay), 1), daysInMonth(year, month))
  return toIsoDate(year, month, day)
}

function addMonths(year: number, month: number, delta: number): { year: number; month: number } {
  const index = year * 12 + (month - 1) + delta
  return { year: Math.floor(index / 12), month: (index % 12) + 1 }
}

function clampRentDueDay(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null
  const day = Math.trunc(value)
  if (day < 1 || day > 31) return null
  return day
}

/** Monthly rent due dates and reminder dates from cadence prefs, bounded by the lease. */
export function buildResidentCalendarEvents(input: {
  leaseStartDate?: string | null
  leaseEndDate?: string | null
  rentDueDay?: number | null
  rentReminderCadence?: string | null
}): ResidentCalendarEvent[] {
  const leaseStart = parseIsoDateOnly(input.leaseStartDate)
  const leaseEnd = parseIsoDateOnly(input.leaseEndDate)
  const rentDueDay = clampRentDueDay(input.rentDueDay) ?? 1
  const reminderDays = parseRentReminderCadenceDays(input.rentReminderCadence)
  const events: ResidentCalendarEvent[] = []

  if (rentDueDay != null) {
    const startParts = leaseStart
      ? { year: Number(leaseStart.slice(0, 4)), month: Number(leaseStart.slice(5, 7)) }
      : addMonths(new Date().getFullYear(), new Date().getMonth() + 1, -2)
    const endParts = leaseEnd
      ? { year: Number(leaseEnd.slice(0, 4)), month: Number(leaseEnd.slice(5, 7)) }
      : addMonths(startParts.year, startParts.month, 18)

    let cursor = startParts
    let months = 0
    while (
      months < 36 &&
      (cursor.year < endParts.year ||
        (cursor.year === endParts.year && cursor.month <= endParts.month))
    ) {
      const rentIso = rentDueIsoForMonth(cursor.year, cursor.month, rentDueDay)
      const afterStart = !leaseStart || rentIso >= leaseStart
      const beforeEnd = !leaseEnd || rentIso <= leaseEnd
      if (afterStart && beforeEnd) {
        events.push({ date: rentIso, kind: 'rent', label: 'Rent due' })
        for (const daysBefore of reminderDays) {
          const reminderIso = addDaysIso(rentIso, -daysBefore)
          const reminderBeforeEnd = !leaseEnd || reminderIso <= leaseEnd
          if (reminderBeforeEnd && reminderIso !== rentIso) {
            events.push({
              date: reminderIso,
              kind: 'rent_reminder',
              label:
                daysBefore === 1 ? 'Rent reminder · 1 day before' : `Rent reminder · ${daysBefore} days before`,
              daysBeforeDue: daysBefore,
            })
          }
        }
      }
      cursor = addMonths(cursor.year, cursor.month, 1)
      months += 1
    }
  }

  events.sort((a, b) => a.date.localeCompare(b.date) || a.kind.localeCompare(b.kind))
  return events
}

function calendarDateFromInstant(iso: string | null | undefined): string | null {
  const raw = (iso ?? '').trim()
  if (!raw) return null
  if (!raw.includes('T')) return parseIsoDateOnly(raw)
  const parsed = new Date(raw)
  if (!Number.isFinite(parsed.getTime())) return parseIsoDateOnly(raw)
  return toIsoDate(parsed.getFullYear(), parsed.getMonth() + 1, parsed.getDate())
}

export function localClockFromInstant(
  iso: string | null | undefined,
): { time: string; meridiem: string } | null {
  const raw = (iso ?? '').trim()
  if (!raw.includes('T')) return null
  const parsed = new Date(raw)
  if (!Number.isFinite(parsed.getTime())) return null
  const hour = parsed.getHours()
  const minute = parsed.getMinutes()
  const meridiem = hour >= 12 ? 'PM' : 'AM'
  const hour12 = hour % 12 === 0 ? 12 : hour % 12
  return { time: `${hour12}:${String(minute).padStart(2, '0')}`, meridiem }
}

function daysBetweenIso(from: string, to: string): number {
  const start = new Date(`${from}T12:00:00`)
  const end = new Date(`${to}T12:00:00`)
  return Math.round((end.getTime() - start.getTime()) / 86_400_000)
}

/** Visit-confirmed rows from the operations graph. Rent due / reminders come from the lease. */
export function calendarEventsFromOperationsGraph(
  events: PropertyOperationsTimelineEvent[],
): ResidentCalendarEvent[] {
  const cards: ResidentCalendarEvent[] = []

  for (const event of events) {
    if (event.eventType !== VISIT_CONFIRMED_EVENT_TYPE) continue
    const date =
      calendarDateFromInstant(event.scheduledAt) ?? calendarDateFromInstant(event.createdAt)
    if (!date) continue
    const clock =
      localClockFromInstant(event.scheduledAt) ?? localClockFromInstant(event.createdAt) ?? undefined
    cards.push({
      id: event.id,
      date,
      kind: 'maintenance',
      label: 'Visit confirmed',
      clock,
    })
  }

  cards.sort((a, b) => a.date.localeCompare(b.date) || a.label.localeCompare(b.label))
  return cards
}

export function mergeResidentCalendarEvents(
  leaseEvents: ResidentCalendarEvent[],
  operationsEvents: ResidentCalendarEvent[],
): ResidentCalendarEvent[] {
  const merged = [...leaseEvents, ...operationsEvents]
  merged.sort((a, b) => a.date.localeCompare(b.date) || a.kind.localeCompare(b.kind) || a.label.localeCompare(b.label))
  return merged
}

/** Prefer today, a recent visit, then the next rent/reminder card. */
export function nearestCalendarFocusDate(
  events: ResidentCalendarEvent[],
  today: string,
): string {
  if (events.length === 0) return today
  if (events.some((event) => event.date === today)) return today

  const recentVisit = [...events]
    .filter((event) => event.date < today && event.kind === 'maintenance')
    .sort((a, b) => b.date.localeCompare(a.date))[0]
  if (recentVisit && daysBetweenIso(recentVisit.date, today) <= 14) {
    return recentVisit.date
  }

  const upcoming = events.find((event) => event.date >= today)
  if (upcoming) return upcoming.date
  return events[events.length - 1]!.date
}

export function eventsOnDate(
  events: ResidentCalendarEvent[],
  date: string,
): ResidentCalendarEvent[] {
  return events.filter((event) => event.date === date)
}

export type CalendarDayCell = {
  date: string
  day: number
  inMonth: boolean
  isToday: boolean
}

export function buildMonthGrid(year: number, month: number, todayIso: string): CalendarDayCell[] {
  const firstWeekday = new Date(year, month - 1, 1).getDay()
  const count = daysInMonth(year, month)
  const prev = addMonths(year, month, -1)
  const prevCount = daysInMonth(prev.year, prev.month)
  const cells: CalendarDayCell[] = []

  for (let i = 0; i < firstWeekday; i += 1) {
    const day = prevCount - firstWeekday + i + 1
    cells.push({
      date: toIsoDate(prev.year, prev.month, day),
      day,
      inMonth: false,
      isToday: false,
    })
  }

  for (let day = 1; day <= count; day += 1) {
    const date = toIsoDate(year, month, day)
    cells.push({
      date,
      day,
      inMonth: true,
      isToday: date === todayIso,
    })
  }

  const next = addMonths(year, month, 1)
  while (cells.length % 7 !== 0) {
    const day = cells.length - firstWeekday - count + 1
    cells.push({
      date: toIsoDate(next.year, next.month, day),
      day,
      inMonth: false,
      isToday: false,
    })
  }

  return cells
}

export function todayIsoDate(now = new Date()): string {
  return toIsoDate(now.getFullYear(), now.getMonth() + 1, now.getDate())
}

export function addDaysIso(iso: string, days: number): string {
  const parsed = parseIsoDateOnly(iso)
  if (!parsed) return iso
  const year = Number(parsed.slice(0, 4))
  const month = Number(parsed.slice(5, 7))
  const day = Number(parsed.slice(8, 10))
  const date = new Date(year, month - 1, day + days)
  return toIsoDate(date.getFullYear(), date.getMonth() + 1, date.getDate())
}

export function startOfWeekSunday(iso: string): string {
  const parsed = parseIsoDateOnly(iso) ?? todayIsoDate()
  const year = Number(parsed.slice(0, 4))
  const month = Number(parsed.slice(5, 7))
  const day = Number(parsed.slice(8, 10))
  const weekday = new Date(year, month - 1, day).getDay()
  return addDaysIso(parsed, -weekday)
}

export function datesInWeek(weekStartIso: string): string[] {
  return Array.from({ length: 7 }, (_, index) => addDaysIso(weekStartIso, index))
}

export function addCalendarMonths(
  year: number,
  month: number,
  delta: number,
): { year: number; month: number } {
  return addMonths(year, month, delta)
}
