import { useMemo, useState } from 'react'
import chevronLeftIcon from '@/assets/calendar/chevron-left.svg'
import chevronRightIcon from '@/assets/calendar/chevron-right.svg'
import eventCameraIcon from '@/assets/calendar/event-camera.svg'
import searchIcon from '@/assets/calendar/search.svg'
import { useLandlordWorkspace } from '@/context/LandlordWorkspaceContext'
import { DEFAULT_RENT_REMINDER_CADENCE } from '@/lib/organizationSettings'
import type { PropertyOperationsTimelineEvent } from '@/lib/propertyOperationsGraph'
import {
  addCalendarMonths,
  addDaysIso,
  buildMonthGrid,
  buildResidentCalendarEvents,
  calendarEventsFromOperationsGraph,
  datesInWeek,
  mergeResidentCalendarEvents,
  nearestCalendarFocusDate,
  startOfWeekSunday,
  todayIsoDate,
  toIsoDate,
  type ResidentCalendarEvent,
  type ResidentCalendarEventKind,
} from '@/lib/residentLeaseCalendar'

type CalendarView = 'day' | 'week' | 'month' | 'year'

const WEEKDAY_LABELS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']
const START_HOUR = 7
const END_HOUR = 17
const HOURS = Array.from({ length: END_HOUR - START_HOUR + 1 }, (_, index) => START_HOUR + index)

const EVENT_STYLE: Record<
  ResidentCalendarEventKind,
  { bar: string; fill: string; text: string }
> = {
  rent: {
    bar: 'bg-[#0ea5e9]',
    fill: 'bg-[rgba(14,165,233,0.1)]',
    text: 'text-[#0369a1]',
  },
  rent_reminder: {
    bar: 'bg-[#0ea5e9]',
    fill: 'bg-[rgba(14,165,233,0.1)]',
    text: 'text-[#0369a1]',
  },
  maintenance: {
    bar: 'bg-[#f43f5e]',
    fill: 'bg-[rgba(244,63,94,0.1)]',
    text: 'text-[#be123c]',
  },
}

function hourLabel(hour: number): string {
  if (hour === 0) return '12 AM'
  if (hour === 12) return '12 PM'
  if (hour < 12) return `${hour} AM`
  return `${hour - 12} PM`
}

function eventClockParts(event: ResidentCalendarEvent): { time: string; meridiem: string } {
  if (event.clock) return event.clock
  if (event.kind === 'rent_reminder') return { time: '10:00', meridiem: 'AM' }
  if (event.kind === 'rent') return { time: '9:00', meridiem: 'AM' }
  return { time: '11:00', meridiem: 'AM' }
}

function eventStartHourMinute(event: ResidentCalendarEvent): { hour: number; minute: number } {
  const clock = eventClockParts(event)
  const [hourRaw, minuteRaw] = clock.time.split(':')
  let hour = Number(hourRaw)
  const minute = Number(minuteRaw) || 0
  if (!Number.isFinite(hour)) hour = START_HOUR
  if (clock.meridiem === 'PM' && hour !== 12) hour += 12
  if (clock.meridiem === 'AM' && hour === 12) hour = 0
  return { hour, minute: Number.isFinite(minute) ? minute : 0 }
}

function eventKey(event: ResidentCalendarEvent): string {
  return `${event.id ?? ''}-${event.date}-${event.kind}-${event.label}-${event.daysBeforeDue ?? ''}`
}

function timezoneCaption(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZoneName: 'short' }).formatToParts(now)
  const short = parts.find((part) => part.type === 'timeZoneName')?.value ?? 'Local'
  const offsetHours = -now.getTimezoneOffset() / 60
  const gmt = `GMT${offsetHours >= 0 ? '+' : ''}${offsetHours}`
  return `${short} ${gmt}`
}

function dayNumber(iso: string): number {
  return Number(iso.slice(8, 10))
}

function weekdayIndex(iso: string): number {
  const year = Number(iso.slice(0, 4))
  const month = Number(iso.slice(5, 7))
  const day = Number(iso.slice(8, 10))
  return new Date(year, month - 1, day).getDay()
}

function monthTitle(year: number, month: number): string {
  return new Date(year, month - 1, 1).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  })
}

function NavIcon({ src, alt }: { src: string; alt: string }) {
  return (
    <span className="relative block size-5 shrink-0">
      <img alt={alt} src={src} className="absolute inset-0 block size-5 max-w-none" />
    </span>
  )
}

function EventCard({ event }: { event: ResidentCalendarEvent }) {
  const style = EVENT_STYLE[event.kind]
  const clock = eventClockParts(event)
  const showCamera = event.kind === 'rent' || event.kind === 'rent_reminder'
  return (
    <div className={`flex h-[68px] items-start overflow-hidden rounded-[4px] ${style.fill}`}>
      <div className={`h-full w-[3px] shrink-0 ${style.bar}`} />
      <div className="flex h-[68px] min-w-px flex-1 flex-col items-start p-1.5">
        <div className={`flex items-center gap-1 ${style.text}`}>
          <span className="text-[12px] font-medium leading-4">{clock.time}</span>
          <span className="text-[12px] font-medium leading-4">{clock.meridiem}</span>
          {showCamera ? (
            <span className="flex shrink-0 items-start rounded-full bg-[#0369a1] p-0.5">
              <span className="relative block size-2">
                <img alt="" src={eventCameraIcon} className="absolute inset-0 block size-2 max-w-none" />
              </span>
            </span>
          ) : null}
        </div>
        <p className={`w-full text-[12px] font-semibold leading-4 ${style.text}`}>{event.label}</p>
      </div>
    </div>
  )
}

function DayHeader({
  iso,
  today,
  weekend,
}: {
  iso: string
  today: boolean
  weekend: boolean
}) {
  return (
    <div
      className={[
        'relative flex min-w-0 flex-1 flex-col items-start px-2 pb-4 pt-1',
        today ? 'bg-[#eff6ff]' : weekend ? 'bg-[#fafafa]' : 'bg-white',
        'shadow-[inset_-1px_-1px_0_0_#e0e0e0]',
      ].join(' ')}
    >
      <p className="w-full text-[10px] font-bold leading-3 text-[#71717a]">{WEEKDAY_LABELS[weekdayIndex(iso)]}</p>
      <p className="w-full text-[22px] font-medium leading-8 text-black">{dayNumber(iso)}</p>
    </div>
  )
}

function HourGrid({
  days,
  todayIso,
  eventsByDate,
}: {
  days: string[]
  todayIso: string
  eventsByDate: Map<string, ResidentCalendarEvent[]>
}) {
  const tz = timezoneCaption()
  return (
    <div className="min-w-0 overflow-x-auto">
      <div className="flex min-w-[720px] flex-col">
        <div className="flex items-start gap-3 pl-12">
          <div className="flex min-w-0 flex-1">
            {days.map((iso) => (
              <DayHeader
                key={iso}
                iso={iso}
                today={iso === todayIso}
                weekend={weekdayIndex(iso) === 0 || weekdayIndex(iso) === 6}
              />
            ))}
          </div>
          <div className="w-9 shrink-0 pt-1 text-[10px] font-medium leading-3 text-[#71717a]">{tz}</div>
        </div>

        <div className="relative">
          {HOURS.map((hour) => (
            <div key={hour} className="flex items-start gap-3">
              <div className="-mt-2 w-9 shrink-0 text-right text-[12px] font-medium leading-4 text-[#71717a]">
                {hourLabel(hour)}
              </div>
              <div className="flex min-w-0 flex-1">
                {days.map((iso) => {
                  const weekend = weekdayIndex(iso) === 0 || weekdayIndex(iso) === 6
                  const today = iso === todayIso
                  const hourEvents = (eventsByDate.get(iso) ?? []).filter((event) => {
                    const start = eventStartHourMinute(event)
                    const slotHour = Math.min(END_HOUR, Math.max(START_HOUR, start.hour))
                    return slotHour === hour
                  })
                  return (
                    <div
                      key={`${iso}-${hour}`}
                      className={[
                        'relative h-[72px] min-w-0 flex-1 overflow-visible shadow-[inset_-1px_-1px_0_0_#e0e0e0]',
                        today ? 'bg-[#eff6ff]' : weekend ? 'bg-[#fafafa]' : 'bg-white',
                      ].join(' ')}
                    >
                      <div className="h-9 shadow-[inset_0_-1px_0_0_#f7f7f7]" />
                      {hourEvents.map((event) => {
                        const { minute } = eventStartHourMinute(event)
                        return (
                          <div
                            key={eventKey(event)}
                            className="absolute inset-x-0.5 z-10"
                            style={{ top: `${Math.round((minute / 60) * 72)}px` }}
                          >
                            <EventCard event={event} />
                          </div>
                        )
                      })}
                    </div>
                  )
                })}
              </div>
              <div className="-mt-2 w-9 shrink-0 text-[12px] font-medium leading-4 text-[#71717a]">
                {hourLabel(hour)}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export function ResidentLeaseCalendar({
  leaseStartDate,
  leaseEndDate,
  rentDueDay,
  operationsEvents = [],
  visitEvents = [],
}: {
  leaseStartDate: string | null
  leaseEndDate: string | null
  rentDueDay: number | null
  operationsEvents?: PropertyOperationsTimelineEvent[]
  visitEvents?: ResidentCalendarEvent[]
}) {
  const { organization } = useLandlordWorkspace()
  const today = todayIsoDate()
  const [view, setView] = useState<CalendarView>('week')
  const [focusOverride, setFocusOverride] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const rentReminderCadence = organization?.rentReminderCadence || DEFAULT_RENT_REMINDER_CADENCE

  const allEvents = useMemo(
    () =>
      mergeResidentCalendarEvents(
        buildResidentCalendarEvents({
          leaseStartDate,
          leaseEndDate,
          rentDueDay,
          rentReminderCadence,
        }),
        mergeResidentCalendarEvents(
          calendarEventsFromOperationsGraph(operationsEvents),
          visitEvents,
        ),
      ),
    [leaseStartDate, leaseEndDate, rentDueDay, rentReminderCadence, operationsEvents, visitEvents],
  )

  const events = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return allEvents
    return allEvents.filter((event) => event.label.toLowerCase().includes(needle))
  }, [allEvents, query])

  const autoFocus = useMemo(
    () => nearestCalendarFocusDate(allEvents, today),
    [allEvents, today],
  )
  const focusDate = focusOverride ?? autoFocus

  const eventsByDate = useMemo(() => {
    const map = new Map<string, ResidentCalendarEvent[]>()
    for (const event of events) {
      const list = map.get(event.date) ?? []
      list.push(event)
      map.set(event.date, list)
    }
    return map
  }, [events])

  const focusYear = Number(focusDate.slice(0, 4))
  const focusMonth = Number(focusDate.slice(5, 7))
  const weekStart = startOfWeekSunday(focusDate)
  const weekDays = datesInWeek(weekStart)
  const monthCells = useMemo(
    () => buildMonthGrid(focusYear, focusMonth, today),
    [focusYear, focusMonth, today],
  )

  function goToday() {
    setFocusOverride(today)
  }

  function shift(delta: number) {
    if (view === 'day') setFocusOverride(addDaysIso(focusDate, delta))
    else if (view === 'week') setFocusOverride(addDaysIso(focusDate, delta * 7))
    else if (view === 'month') {
      const next = addCalendarMonths(focusYear, focusMonth, delta)
      setFocusOverride(toIsoDate(next.year, next.month, 1))
    } else {
      setFocusOverride(toIsoDate(focusYear + delta, focusMonth, 1))
    }
  }

  const views: CalendarView[] = ['day', 'week', 'month', 'year']

  return (
    <section className="mt-4 overflow-hidden rounded-[10px] border border-[#e5e7eb] bg-white p-4 shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)]">
      <h2 className="sr-only">Lease calendar</h2>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-stretch gap-px">
          <button
            type="button"
            className="sa-press inline-flex items-center justify-center rounded-l-[6px] bg-[#f4f4f5] p-1"
            aria-label="Previous"
            onClick={() => shift(-1)}
          >
            <NavIcon src={chevronLeftIcon} alt="" />
          </button>
          <button
            type="button"
            className="sa-press bg-[#f4f4f5] px-4 py-1.5 text-[12px] leading-4 text-[#18181b]"
            onClick={goToday}
          >
            Today
          </button>
          <button
            type="button"
            className="sa-press inline-flex items-center justify-center rounded-r-[6px] bg-[#f4f4f5] p-1"
            aria-label="Next"
            onClick={() => shift(1)}
          >
            <NavIcon src={chevronRightIcon} alt="" />
          </button>
        </div>

        <div className="flex items-center">
          {views.map((item) => {
            const active = view === item
            return (
              <button
                key={item}
                type="button"
                className={[
                  'sa-press rounded-[8px] px-4 py-1 text-[14px] font-medium leading-5',
                  active ? 'bg-[#dc2626] text-white' : 'text-[#71717a]',
                ].join(' ')}
                onClick={() => setView(item)}
              >
                {item.charAt(0).toUpperCase() + item.slice(1)}
              </button>
            )
          })}
        </div>

        <label className="flex w-[184px] items-center gap-2 rounded-[4px] bg-[#f4f4f5] p-1">
          <span className="relative block size-5 shrink-0">
            <img alt="" src={searchIcon} className="absolute inset-0 block size-5 max-w-none" />
          </span>
          <span className="sr-only">Search</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search"
            className="min-w-0 flex-1 bg-transparent text-[12px] leading-4 text-[#18181b] outline-none placeholder:text-[#a1a1aa]"
          />
        </label>
      </div>

      <div className="mt-4 min-w-0">
        {view === 'week' ? (
          <HourGrid days={weekDays} todayIso={today} eventsByDate={eventsByDate} />
        ) : null}

        {view === 'day' ? (
          <HourGrid days={[focusDate]} todayIso={today} eventsByDate={eventsByDate} />
        ) : null}

        {view === 'month' ? (
          <div>
            <p className="mb-3 text-[14px] font-medium leading-5 text-[#18181b]">
              {monthTitle(focusYear, focusMonth)}
            </p>
            <div className="grid grid-cols-7">
              {WEEKDAY_LABELS.map((label) => (
                <div
                  key={label}
                  className="px-2 py-1 text-[10px] font-bold leading-3 text-[#71717a] shadow-[inset_-1px_-1px_0_0_#e0e0e0]"
                >
                  {label}
                </div>
              ))}
              {monthCells.map((cell) => {
                const dayEvents = eventsByDate.get(cell.date) ?? []
                const weekend = weekdayIndex(cell.date) === 0 || weekdayIndex(cell.date) === 6
                return (
                  <button
                    key={cell.date}
                    type="button"
                    onClick={() => {
                      setFocusOverride(cell.date)
                      setView('day')
                    }}
                    className={[
                      'sa-press flex min-h-[88px] flex-col items-start px-2 pb-2 pt-1 text-left shadow-[inset_-1px_-1px_0_0_#e0e0e0]',
                      cell.isToday ? 'bg-[#eff6ff]' : weekend ? 'bg-[#fafafa]' : 'bg-white',
                    ].join(' ')}
                  >
                    <span
                      className={[
                        'text-[22px] font-medium leading-8',
                        cell.inMonth ? 'text-black' : 'text-[#d4d4d8]',
                      ].join(' ')}
                    >
                      {cell.day}
                    </span>
                    <span className="mt-1 flex w-full flex-col gap-0.5">
                      {dayEvents.slice(0, 3).map((event) => (
                        <span
                          key={eventKey(event)}
                          className={`truncate rounded-[2px] px-1 text-[10px] font-medium leading-4 ${EVENT_STYLE[event.kind].fill} ${EVENT_STYLE[event.kind].text}`}
                        >
                          {event.label}
                        </span>
                      ))}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        ) : null}

        {view === 'year' ? (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 12 }, (_, index) => index + 1).map((month) => {
              const cells = buildMonthGrid(focusYear, month, today)
              return (
                <button
                  key={month}
                  type="button"
                  className="sa-press text-left"
                  onClick={() => {
                    setFocusOverride(toIsoDate(focusYear, month, 1))
                    setView('month')
                  }}
                >
                  <p className="mb-2 text-[13px] font-medium leading-5 text-[#18181b]">
                    {new Date(focusYear, month - 1, 1).toLocaleDateString(undefined, { month: 'long' })}
                  </p>
                  <div className="grid grid-cols-7 gap-px">
                    {WEEKDAY_LABELS.map((label) => (
                      <div key={label} className="text-center text-[9px] font-bold text-[#71717a]">
                        {label.charAt(0)}
                      </div>
                    ))}
                    {cells.map((cell) => {
                      const marked = (eventsByDate.get(cell.date) ?? []).length > 0
                      return (
                        <div
                          key={cell.date}
                          className={[
                            'flex h-6 items-center justify-center text-[11px] leading-4',
                            cell.inMonth ? 'text-[#18181b]' : 'text-[#d4d4d8]',
                            cell.isToday ? 'rounded-full bg-[#eff6ff] font-medium' : '',
                            marked ? 'font-semibold text-[#0369a1]' : '',
                          ].join(' ')}
                        >
                          {cell.day}
                        </div>
                      )
                    })}
                  </div>
                </button>
              )
            })}
          </div>
        ) : null}
      </div>
    </section>
  )
}
