import { useMemo, useState } from 'react'
import calendarIcon from '@/assets/calendar/calendar.svg'
import chevronDownIcon from '@/assets/calendar/chevron-down.svg'
import chevronLeftIcon from '@/assets/calendar/chevron-left.svg'
import chevronRightIcon from '@/assets/calendar/chevron-right.svg'
import { useLandlordWorkspace } from '@/context/LandlordWorkspaceContext'
import { DEFAULT_RENT_REMINDER_CADENCE, normalizeRentDueDaySetting } from '@/lib/organizationSettings'
import type { PropertyOperationsTimelineEvent } from '@/lib/propertyOperationsGraph'
import {
  addCalendarMonths,
  addDaysIso,
  buildResidentCalendarEvents,
  buildTenantOnboardingCalendarEvents,
  calendarEventsFromOperationsGraph,
  datesInRange,
  mergeResidentCalendarEvents,
  RESIDENT_CALENDAR_PAGE_SIZE,
  stripStartIncludingRentReminders,
  todayIsoDate,
  toIsoDate,
  type ResidentCalendarEvent,
  type ResidentCalendarEventKind,
} from '@/lib/residentLeaseCalendar'

const WEEKDAY_LABELS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']
const RAIL_PX = 220

function weekdayIndex(iso: string): number {
  const year = Number(iso.slice(0, 4))
  const month = Number(iso.slice(5, 7))
  const day = Number(iso.slice(8, 10))
  return new Date(year, month - 1, day).getDay()
}

function dayNumber(iso: string): number {
  return Number(iso.slice(8, 10))
}

function monthValue(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`
}

function monthLabel(year: number, month: number): string {
  return new Date(year, month - 1, 1)
    .toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    .toUpperCase()
}

const EVENT_CHIP: Record<ResidentCalendarEventKind, { fill: string; text: string }> = {
  rent: { fill: 'bg-[#e0f2fe]', text: 'text-[#0369a1]' },
  rent_reminder: { fill: 'bg-[#f0f9ff]', text: 'text-[#0284c7]' },
  maintenance: { fill: 'bg-[#ffe4e6]', text: 'text-[#be123c]' },
  onboarding_reminder: { fill: 'bg-[#fef9c3]', text: 'text-[#92400e]' },
}

function eventChipLabel(event: ResidentCalendarEvent): string {
  if (event.kind === 'rent') return 'Rent due'
  if (event.kind === 'rent_reminder') return 'Rent reminder'
  if (event.kind === 'onboarding_reminder') return 'Onboarding Follow up'
  return event.label
}

function headerKindForDay(
  events: ResidentCalendarEvent[],
): ResidentCalendarEventKind | null {
  if (events.some((event) => event.kind === 'rent')) return 'rent'
  if (events.some((event) => event.kind === 'maintenance')) return 'maintenance'
  if (events.some((event) => event.kind === 'onboarding_reminder')) return 'onboarding_reminder'
  if (events.some((event) => event.kind === 'rent_reminder')) return 'rent_reminder'
  return null
}

function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase()
}

function Icon({ src, size, alt = '' }: { src: string; size: number; alt?: string }) {
  return (
    <span className="relative block shrink-0" style={{ width: size, height: size }}>
      <img
        alt={alt}
        src={src}
        className="absolute inset-0 block max-w-none"
        style={{ width: size, height: size }}
      />
    </span>
  )
}

export function ResidentLeaseCalendar({
  leaseStartDate,
  leaseEndDate,
  rentDueDay,
  rowTitle,
  rowSubtitle,
  operationsEvents = [],
  visitEvents = [],
  onboarding = null,
}: {
  leaseStartDate: string | null
  leaseEndDate: string | null
  rentDueDay: number | null
  rowTitle?: string
  rowSubtitle?: string
  operationsEvents?: PropertyOperationsTimelineEvent[]
  visitEvents?: ResidentCalendarEvent[]
  onboarding?: {
    residentId: string
    activationStatus?: string | null
    smsConsentStatus?: string | null
    activationAttemptCount?: number | null
    activationSmsSentAt?: string | null
    lastActivationAttemptAt?: string | null
    firstActivationAttemptAt?: string | null
  } | null
}) {
  const { organization } = useLandlordWorkspace()
  const today = todayIsoDate()
  const [windowStart, setWindowStart] = useState<string | null>(null)
  const rentReminderCadence = organization?.rentReminderCadence || DEFAULT_RENT_REMINDER_CADENCE
  const orgRentDueDay = Number.parseInt(
    normalizeRentDueDaySetting(organization?.rentDueDay),
    10,
  )
  const resolvedRentDueDay =
    rentDueDay ?? (Number.isFinite(orgRentDueDay) ? orgRentDueDay : null)

  const allEvents = useMemo(
    () =>
      mergeResidentCalendarEvents(
        mergeResidentCalendarEvents(
          buildResidentCalendarEvents({
            leaseStartDate,
            leaseEndDate,
            rentDueDay: resolvedRentDueDay,
            rentReminderCadence,
          }),
          onboarding
            ? buildTenantOnboardingCalendarEvents(onboarding)
            : [],
        ),
        mergeResidentCalendarEvents(
          calendarEventsFromOperationsGraph(operationsEvents),
          visitEvents,
        ),
      ),
    [
      leaseStartDate,
      leaseEndDate,
      resolvedRentDueDay,
      rentReminderCadence,
      operationsEvents,
      visitEvents,
      onboarding,
    ],
  )

  const defaultStart = useMemo(
    () => stripStartIncludingRentReminders(allEvents, today, rentReminderCadence),
    [allEvents, rentReminderCadence, today],
  )
  const startIso = windowStart ?? defaultStart
  const visibleDates = useMemo(
    () => datesInRange(startIso, addDaysIso(startIso, RESIDENT_CALENDAR_PAGE_SIZE - 1)),
    [startIso],
  )
  const focusYear = Number(startIso.slice(0, 4))
  const focusMonth = Number(startIso.slice(5, 7))

  const eventsByDate = useMemo(() => {
    const map = new Map<string, ResidentCalendarEvent[]>()
    for (const event of allEvents) {
      const list = map.get(event.date) ?? []
      list.push(event)
      map.set(event.date, list)
    }
    return map
  }, [allEvents])

  const monthOptions = useMemo(() => {
    const thisMonth = { year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) }
    const leaseStartIso = (leaseStartDate ?? '').trim().slice(0, 10)
    const leaseEndIso = (leaseEndDate ?? '').trim().slice(0, 10)
    const leaseStartMonth = /^\d{4}-\d{2}-\d{2}$/.test(leaseStartIso)
      ? { year: Number(leaseStartIso.slice(0, 4)), month: Number(leaseStartIso.slice(5, 7)) }
      : null
    const yearAgo = addCalendarMonths(thisMonth.year, thisMonth.month, -12)
    const from =
      leaseStartMonth &&
      leaseStartMonth.year * 12 + leaseStartMonth.month < yearAgo.year * 12 + yearAgo.month
        ? leaseStartMonth
        : yearAgo
    const until = /^\d{4}-\d{2}-\d{2}$/.test(leaseEndIso)
      ? { year: Number(leaseEndIso.slice(0, 4)), month: Number(leaseEndIso.slice(5, 7)) }
      : addCalendarMonths(thisMonth.year, thisMonth.month, 18)
    const span = until.year * 12 + until.month - (from.year * 12 + from.month)
    const count = Math.min(72, Math.max(1, span + 1))
    return Array.from({ length: count }, (_, index) => {
      const next = addCalendarMonths(from.year, from.month, index)
      return {
        value: monthValue(next.year, next.month),
        label: monthLabel(next.year, next.month),
      }
    })
  }, [leaseEndDate, leaseStartDate, today])

  const title = rowTitle?.trim() || 'Lease'
  const subtitle = rowSubtitle?.trim() || ''

  function shiftPage(delta: number) {
    const next = addDaysIso(startIso, delta * RESIDENT_CALENDAR_PAGE_SIZE)
    const leaseEndIso = (leaseEndDate ?? '').trim().slice(0, 10)
    if (delta > 0 && /^\d{4}-\d{2}-\d{2}$/.test(leaseEndIso) && next > leaseEndIso) {
      setWindowStart(addDaysIso(leaseEndIso, 1 - RESIDENT_CALENDAR_PAGE_SIZE))
      return
    }
    setWindowStart(next)
  }

  function goToday() {
    setWindowStart(today)
  }

  function onMonthChange(value: string) {
    const [yearRaw, monthRaw] = value.split('-')
    const year = Number(yearRaw)
    const month = Number(monthRaw)
    if (!Number.isFinite(year) || month < 1 || month > 12) return
    setWindowStart(toIsoDate(year, month, 1))
  }

  return (
    <section className="mt-4 overflow-hidden rounded-[10px] border border-[#e5e7eb] bg-white shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)]">
      <h2 className="sr-only">Lease calendar</h2>
      <div className="flex min-w-0">
        <div className="w-[220px] shrink-0 border-r border-[#ececec]" style={{ width: RAIL_PX }}>
          <div className="flex h-[72px] items-center gap-2 border-b border-[#ececec] px-3">
            <label className="relative min-w-0 flex-1">
              <span className="sr-only">Month</span>
              <select
                value={monthValue(focusYear, focusMonth)}
                onChange={(event) => onMonthChange(event.target.value)}
                className="h-9 w-full cursor-pointer appearance-none bg-transparent pr-6 text-[13px] font-semibold tracking-[0.04em] text-[#8b7cf7] outline-none"
              >
                {monthOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <span className="pointer-events-none absolute right-0 top-1/2 -translate-y-1/2">
                <Icon src={chevronDownIcon} size={16} />
              </span>
            </label>
            <button
              type="button"
              onClick={goToday}
              aria-label="Go to today"
              className="sa-press inline-flex size-10 shrink-0 items-center justify-center rounded-[10px] border border-[#e5e7eb] bg-white"
            >
              <Icon src={calendarIcon} size={20} />
            </button>
          </div>
          <div className="flex h-[88px] items-center gap-3 bg-[#f4f2ff] px-3">
            <span className="inline-flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-[8px] bg-white text-[13px] font-semibold text-[#6a7282]">
              {initialsFromName(title)}
            </span>
            <div className="min-w-0">
              <p className="truncate text-[14px] font-semibold leading-5 text-[#0a0a0a]">{title}</p>
              {subtitle ? (
                <p className="truncate text-[12px] leading-4 text-[#6a7282]">{subtitle}</p>
              ) : null}
            </div>
          </div>
        </div>

        <button
          type="button"
          aria-label="Previous days"
          onClick={() => shiftPage(-1)}
          className="sa-press flex w-9 shrink-0 items-center justify-center border-r border-[#ececec] bg-white text-[#18181b] hover:bg-[#fafafa]"
        >
          <Icon src={chevronLeftIcon} size={20} />
        </button>

        <div className="min-w-0 flex-1 overflow-hidden">
            <div className="flex h-[72px] border-b border-[#ececec]">
              {visibleDates.map((iso) => {
                const isToday = iso === today
                const dayEvents = eventsByDate.get(iso) ?? []
                const kind = headerKindForDay(dayEvents)
                return (
                  <div
                    key={iso}
                    className="flex h-[72px] min-w-0 flex-1 flex-col items-center justify-center gap-1 border-r border-[#f3f4f6] last:border-r-0"
                  >
                    <p className="text-[10px] font-semibold leading-3 tracking-[0.04em] text-[#c4c4cc]">
                      {WEEKDAY_LABELS[weekdayIndex(iso)]}
                    </p>
                    {isToday || kind ? (
                      <span
                        className={[
                          'inline-flex size-8 items-center justify-center rounded-full text-[15px] font-semibold leading-none text-white',
                          isToday
                            ? 'bg-[#52525b]'
                            : kind === 'onboarding_reminder'
                              ? 'bg-[#d97706]'
                              : kind === 'maintenance'
                                ? 'bg-[#f43f5e]'
                                : 'bg-[#0ea5e9]',
                        ].join(' ')}
                      >
                        {dayNumber(iso)}
                      </span>
                    ) : (
                      <span className="inline-flex size-8 items-center justify-center text-[15px] font-medium leading-none text-[#a1a1aa]">
                        {dayNumber(iso)}
                      </span>
                    )}
                  </div>
                )
              })}
            </div>

            <div className="relative flex min-h-[88px] items-stretch">
              {visibleDates.map((iso) => {
                const dayEvents = eventsByDate.get(iso) ?? []
                return (
                  <div
                    key={iso}
                    className="relative z-10 flex min-h-[88px] min-w-0 flex-1 flex-col items-stretch justify-start gap-1 px-1 py-1.5 border-r border-[#f3f4f6] last:border-r-0"
                  >
                    {dayEvents.slice(0, 3).map((event) => {
                      const style = EVENT_CHIP[event.kind]
                      return (
                        <span
                          key={event.id ?? `${event.kind}-${event.date}-${event.daysBeforeDue ?? ''}-${event.label}`}
                          title={event.label}
                          className={`block w-full truncate rounded-[4px] px-1 py-1 text-center text-[10px] font-semibold leading-3 ${style.fill} ${style.text}`}
                        >
                          {eventChipLabel(event)}
                        </span>
                      )
                    })}
                  </div>
                )
              })}
            </div>
        </div>

        <button
          type="button"
          aria-label="Next days"
          onClick={() => shiftPage(1)}
          className="sa-press flex w-9 shrink-0 items-center justify-center border-l border-[#ececec] bg-white text-[#18181b] hover:bg-[#fafafa]"
        >
          <Icon src={chevronRightIcon} size={20} />
        </button>
      </div>
    </section>
  )
}
