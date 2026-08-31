import { describe, expect, it } from 'vitest'
import {
  buildMonthGrid,
  buildResidentCalendarEvents,
  calendarEventsFromOperationsGraph,
  calendarEventsFromScheduledTickets,
  datesInWeek,
  mergeResidentCalendarEvents,
  nearestCalendarFocusDate,
  rentDueIsoForMonth,
  startOfWeekSunday,
} from './residentLeaseCalendar'
import type { PropertyOperationsTimelineEvent } from './propertyOperationsGraph'

describe('rentDueIsoForMonth', () => {
  it('clamps the 31st to the last day of February', () => {
    expect(rentDueIsoForMonth(2026, 2, 31)).toBe('2026-02-28')
  })
})

describe('buildResidentCalendarEvents', () => {
  it('marks rent dates in the lease window', () => {
    const events = buildResidentCalendarEvents({
      leaseStartDate: '2026-03-15',
      leaseEndDate: '2026-06-10',
      rentDueDay: 1,
    })
    expect(events.filter((event) => event.kind === 'rent').map((event) => event.date)).toEqual([
      '2026-04-01',
      '2026-05-01',
      '2026-06-01',
    ])
    expect(events.some((event) => event.kind === 'maintenance')).toBe(false)
  })

  it('places reminder dates from cadence preferences before each rent due date', () => {
    const events = buildResidentCalendarEvents({
      leaseStartDate: '2026-03-01',
      leaseEndDate: '2026-04-30',
      rentDueDay: 10,
      rentReminderCadence: '5, 3, 1 days before',
    })
    expect(
      events
        .filter((event) => event.kind === 'rent_reminder' && event.date.startsWith('2026-04'))
        .map((event) => `${event.date}:${event.daysBeforeDue}`),
    ).toEqual(['2026-04-05:5', '2026-04-07:3', '2026-04-09:1'])
  })

  it('includes rent on the lease start day when they fall on the same date', () => {
    const events = buildResidentCalendarEvents({
      leaseStartDate: '2026-08-01',
      leaseEndDate: '2026-08-31',
      rentDueDay: 1,
    })
    expect(events.map((event) => `${event.date}:${event.kind}`)).toEqual([
      '2026-07-27:rent_reminder',
      '2026-07-29:rent_reminder',
      '2026-07-31:rent_reminder',
      '2026-08-01:rent',
    ])
  })

  it('defaults to the 1st when rent due day is missing', () => {
    const events = buildResidentCalendarEvents({
      leaseStartDate: '2026-08-01',
      leaseEndDate: '2026-08-31',
      rentDueDay: null,
      rentReminderCadence: '1 day before',
    })
    expect(events.filter((event) => event.kind === 'rent').map((event) => event.date)).toEqual([
      '2026-08-01',
    ])
    expect(events.filter((event) => event.kind === 'rent_reminder').map((event) => event.date)).toEqual([
      '2026-07-31',
    ])
  })
})

describe('buildMonthGrid', () => {
  it('pads August 2026 from Saturday of the prior month', () => {
    const cells = buildMonthGrid(2026, 8, '2026-08-29')
    expect(cells[0]).toMatchObject({ date: '2026-07-26', inMonth: false, day: 26 })
    expect(cells.find((cell) => cell.date === '2026-08-01')?.inMonth).toBe(true)
    expect(cells.find((cell) => cell.date === '2026-08-29')?.isToday).toBe(true)
    expect(cells.length % 7).toBe(0)
  })
})

describe('calendarEventsFromOperationsGraph', () => {
  const graphEvent = (
    overrides: Partial<PropertyOperationsTimelineEvent> &
      Pick<PropertyOperationsTimelineEvent, 'id' | 'eventType' | 'label'>,
  ): PropertyOperationsTimelineEvent => ({
    category: 'maintenance',
    message: null,
    eventSource: 'sms',
    createdAt: '2026-08-20T16:00:00.000Z',
    scheduledAt: null,
    unitLabel: null,
    building: null,
    residentId: 'res-1',
    residentName: 'Alex',
    vendorName: null,
    maintenanceRequestId: 'ticket-1',
    workflowRunId: null,
    ...overrides,
  })

  it('places visit events on scheduled_at, not the SMS day', () => {
    const events = calendarEventsFromOperationsGraph([
      graphEvent({
        id: 'visit',
        eventType: 'maintenance.schedule_confirmed',
        label: 'Maintenance scheduled',
        createdAt: '2026-08-18T20:00:00.000Z',
        scheduledAt: '2026-08-21',
      }),
    ])
    expect(events).toEqual([
      expect.objectContaining({
        id: 'visit:ticket-1',
        date: '2026-08-21',
        kind: 'maintenance',
        label: 'Maintenance scheduled',
      }),
    ])
  })

  it('ignores work-order opened and other graph events', () => {
    const events = calendarEventsFromOperationsGraph([
      graphEvent({
        id: 'opened',
        eventType: 'maintenance.created',
        label: 'Work order opened',
        createdAt: '2026-08-19T14:00:00.000Z',
      }),
      graphEvent({
        id: 'pipe',
        eventType: 'workflow.act',
        label: 'Action taken',
        category: 'admin',
        createdAt: '2026-08-19T14:01:00.000Z',
      }),
      graphEvent({
        id: 'accepted',
        eventType: 'vendor.accepted',
        label: 'Vendor accepted the job',
        category: 'vendor',
        createdAt: '2026-08-19T14:02:00.000Z',
      }),
    ])
    expect(events).toEqual([])
  })

  it('does not duplicate synthesized rent reminder cards from the graph', () => {
    const events = calendarEventsFromOperationsGraph([
      graphEvent({
        id: 'reminder',
        eventType: 'rent.reminder_sent',
        label: 'Rent reminder sent',
        category: 'rent',
        createdAt: '2026-08-27T12:00:00.000Z',
      }),
    ])
    expect(events).toEqual([])
  })
})

describe('calendarEventsFromScheduledTickets', () => {
  it('plots confirmed visits from the work order scheduled_at', () => {
    const events = calendarEventsFromScheduledTickets([
      {
        id: 'wo-1',
        scheduledAt: '2026-08-21T14:00:00.000Z',
        scheduleConfirmedAt: '2026-08-18T20:00:00.000Z',
        vendorWorkStatus: 'accepted',
      },
    ])
    expect(events).toEqual([
      expect.objectContaining({
        id: 'visit:wo-1',
        date: '2026-08-21',
        kind: 'maintenance',
        label: 'Maintenance scheduled',
      }),
    ])
  })

  it('skips cancelled work orders', () => {
    expect(
      calendarEventsFromScheduledTickets([
        {
          id: 'wo-2',
          scheduledAt: '2026-08-21T14:00:00.000Z',
          scheduleConfirmedAt: '2026-08-18T20:00:00.000Z',
          vendorWorkStatus: 'cancelled',
        },
      ]),
    ).toEqual([])
  })
})

describe('nearestCalendarFocusDate', () => {
  it('opens on the next upcoming rent or reminder', () => {
    const events = buildResidentCalendarEvents({
      leaseStartDate: '2026-01-01',
      leaseEndDate: '2026-12-31',
      rentDueDay: 1,
      rentReminderCadence: '1 day before',
    })
    expect(nearestCalendarFocusDate(events, '2026-08-29')).toBe('2026-08-31')
  })

  it('opens on a recent maintenance date instead of skipping ahead to rent', () => {
    const events = mergeResidentCalendarEvents(
      buildResidentCalendarEvents({
        leaseStartDate: '2026-01-01',
        leaseEndDate: '2026-12-31',
        rentDueDay: 1,
        rentReminderCadence: '1 day before',
      }),
      [{ date: '2026-08-25', kind: 'maintenance', label: 'Maintenance scheduled' }],
    )
    expect(nearestCalendarFocusDate(events, '2026-08-29')).toBe('2026-08-25')
  })
})

describe('week helpers', () => {
  it('starts the week on Sunday', () => {
    expect(startOfWeekSunday('2026-08-25')).toBe('2026-08-23')
    expect(datesInWeek('2026-08-23')).toEqual([
      '2026-08-23',
      '2026-08-24',
      '2026-08-25',
      '2026-08-26',
      '2026-08-27',
      '2026-08-28',
      '2026-08-29',
    ])
  })
})
