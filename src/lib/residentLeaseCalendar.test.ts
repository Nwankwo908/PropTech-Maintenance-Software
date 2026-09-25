import { describe, expect, it } from 'vitest'
import {
  buildMonthGrid,
  buildResidentCalendarEvents,
  buildTenantOnboardingCalendarEvents,
  calendarEventsFromOperationsGraph,
  calendarEventsFromScheduledTickets,
  datesForMonthWithRentReminders,
  datesInRange,
  datesInWeek,
  nextRentCalendarFocusDate,
  sliceResidentCalendarPage,
  mergeResidentCalendarEvents,
  nearestCalendarFocusDate,
  rentDueIsoForMonth,
  startOfWeekSunday,
  stripStartIncludingRentReminders,
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
      now: new Date(2026, 3, 1),
    })
    const rents = events.filter((event) => event.kind === 'rent').map((event) => event.date)
    expect(rents).toEqual(expect.arrayContaining(['2026-04-01', '2026-05-01', '2026-06-01']))
    expect(events.some((event) => event.kind === 'maintenance')).toBe(false)
  })

  it('plots rent from lease start through lease end, including months before today', () => {
    const events = buildResidentCalendarEvents({
      leaseStartDate: '2026-08-01',
      leaseEndDate: '2027-07-31',
      rentDueDay: 1,
      now: new Date(2026, 8, 12),
    })
    const rents = events.filter((event) => event.kind === 'rent').map((event) => event.date)
    expect(rents).toContain('2026-08-01')
    expect(rents).toContain('2026-09-01')
    expect(rents).toContain('2026-10-01')
    expect(rents).toContain('2027-07-01')
    expect(events.some((event) => event.kind === 'rent_reminder' && event.date >= '2026-09-12')).toBe(
      true,
    )
  })

  it('keeps this month’s already-passed rent and prior-month reminders when browsing history', () => {
    const events = buildResidentCalendarEvents({
      leaseStartDate: '2026-08-01',
      leaseEndDate: '2027-07-31',
      rentDueDay: 1,
      now: new Date(2026, 8, 12),
    })
    expect(events.some((event) => event.date === '2026-09-01')).toBe(true)
    expect(events.some((event) => event.date.startsWith('2026-08'))).toBe(true)
  })

  it('places reminder dates from cadence preferences before each rent due date', () => {
    const events = buildResidentCalendarEvents({
      leaseStartDate: '2026-03-01',
      leaseEndDate: '2026-04-30',
      rentDueDay: 10,
      rentReminderCadence: '5, 3, 1 days before',
      now: new Date(2026, 3, 1),
    })
    expect(
      events
        .filter((event) => event.kind === 'rent_reminder' && event.date.startsWith('2026-04'))
        .map((event) => `${event.date}:${event.daysBeforeDue}`),
    ).toEqual(['2026-04-05:5', '2026-04-07:3', '2026-04-09:1'])
  })
})

describe('stripStartIncludingRentReminders', () => {
  it('starts early enough to show reminders before the next rent due date', () => {
    const events = buildResidentCalendarEvents({
      leaseStartDate: '2026-03-01',
      leaseEndDate: '2026-12-31',
      rentDueDay: 1,
      rentReminderCadence: '5, 3, 1 days before',
      now: new Date(2026, 8, 11),
    })
  })

  it('does not open the strip in a month that has already passed', () => {
    const events = buildResidentCalendarEvents({
      leaseStartDate: '2026-08-01',
      leaseEndDate: '2027-07-31',
      rentDueDay: 1,
      rentReminderCadence: '5, 3, 1 days before',
      now: new Date(2026, 8, 12),
    })
    expect(stripStartIncludingRentReminders(events, '2026-09-12', '5, 3, 1 days before')).toBe(
      '2026-09-26',
    )
  })
})

describe('buildResidentCalendarEvents extra cases', () => {
  it('includes rent on the lease start day when they fall on the same date', () => {
    const events = buildResidentCalendarEvents({
      leaseStartDate: '2026-08-01',
      leaseEndDate: '2026-08-31',
      rentDueDay: 1,
      now: new Date(2026, 7, 1),
    })
    expect(events.map((event) => `${event.date}:${event.kind}`)).toEqual(
      expect.arrayContaining([
        '2026-07-27:rent_reminder',
        '2026-07-29:rent_reminder',
        '2026-07-31:rent_reminder',
        '2026-08-01:rent',
      ]),
    )
  })

  it('defaults to the 1st when rent due day is missing', () => {
    const events = buildResidentCalendarEvents({
      leaseStartDate: '2026-08-01',
      leaseEndDate: '2026-08-31',
      rentDueDay: null,
      rentReminderCadence: '1 day before',
      now: new Date(2026, 7, 1),
    })
    expect(events.filter((event) => event.kind === 'rent').map((event) => event.date)).toEqual(
      expect.arrayContaining(['2026-08-01']),
    )
    expect(events.filter((event) => event.kind === 'rent_reminder').map((event) => event.date)).toEqual(
      expect.arrayContaining(['2026-07-31']),
    )
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
      now: new Date(2026, 7, 1),
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
        now: new Date(2026, 7, 1),
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

  it('includes prior-month reminders with the rent due month', () => {
    const events = buildResidentCalendarEvents({
      leaseStartDate: '2026-03-01',
      leaseEndDate: '2026-12-31',
      rentDueDay: 1,
      rentReminderCadence: '5, 3, 1 days before',
      now: new Date(2026, 8, 12),
    })
    const october = datesForMonthWithRentReminders(2026, 10, events)
    expect(october.slice(0, 4)).toEqual([
      '2026-09-26',
      '2026-09-28',
      '2026-09-30',
      '2026-10-01',
    ])
    expect(october.at(-1)).toBe('2026-10-31')
  })

  it('lists inclusive dates across a range', () => {
    expect(datesInRange('2026-04-29', '2026-05-02')).toEqual([
      '2026-04-29',
      '2026-04-30',
      '2026-05-01',
      '2026-05-02',
    ])
  })
})

describe('sliceResidentCalendarPage', () => {
  it('pages a month strip seven days at a time', () => {
    const dates = Array.from({ length: 31 }, (_, index) => `2026-10-${String(index + 1).padStart(2, '0')}`)
    const first = sliceResidentCalendarPage(dates, 0)
    expect(first.pageCount).toBe(5)
    expect(first.dates).toEqual(dates.slice(0, 7))
    expect(sliceResidentCalendarPage(dates, 4).dates).toEqual(dates.slice(28, 31))
    expect(sliceResidentCalendarPage(dates, 99).pageIndex).toBe(4)
  })
})

describe('nextRentCalendarFocusDate', () => {
  it('returns the next rent due date on or after today', () => {
    const events = buildResidentCalendarEvents({
      leaseStartDate: '2026-03-01',
      leaseEndDate: '2026-12-31',
      rentDueDay: 15,
      rentReminderCadence: '5, 3, 1 days before',
      now: new Date(2026, 8, 12),
    })
    expect(nextRentCalendarFocusDate(events, '2026-09-12')).toBe('2026-09-15')
  })
})

describe('buildTenantOnboardingCalendarEvents', () => {
  it('plots 48-hour follow-ups keyed to this resident only', () => {
    const last = new Date(2026, 8, 15, 10, 0, 0)
    const events = buildTenantOnboardingCalendarEvents({
      residentId: 'res-a',
      activationStatus: 'waiting',
      activationAttemptCount: 1,
      lastActivationAttemptAt: last.toISOString(),
      now: last,
    })
    expect(events.length).toBeGreaterThan(0)
    expect(events[0]).toMatchObject({
      kind: 'onboarding_reminder',
      id: expect.stringMatching(/^onboarding:res-a:/),
    })
    const roommate = buildTenantOnboardingCalendarEvents({
      residentId: 'res-b',
      activationStatus: 'waiting',
      activationAttemptCount: 1,
      lastActivationAttemptAt: last.toISOString(),
      now: last,
    })
    expect(roommate[0]?.id).toMatch(/^onboarding:res-b:/)
    expect(roommate[0]?.id).not.toBe(events[0]?.id)
  })

  it('keeps past welcome sends after YES/NO and hides when not started', () => {
    const last = new Date(2026, 8, 15, 10, 0, 0).toISOString()
    const activated = buildTenantOnboardingCalendarEvents({
      residentId: 'res-a',
      activationStatus: 'activated',
      activationAttemptCount: 1,
      activationSmsSentAt: last,
      lastActivationAttemptAt: last,
      now: new Date(2026, 8, 20, 10, 0, 0),
    })
    expect(activated).toEqual([
      expect.objectContaining({
        kind: 'onboarding_reminder',
        date: '2026-09-15',
      }),
    ])
    expect(
      buildTenantOnboardingCalendarEvents({
        residentId: 'res-a',
        activationStatus: 'not_started',
        now: new Date(2026, 8, 15, 10, 0, 0),
      }),
    ).toEqual([])
  })

  it('keeps overdue follow-up dates before today while waiting', () => {
    const last = new Date(2026, 8, 15, 10, 0, 0)
    const events = buildTenantOnboardingCalendarEvents({
      residentId: 'res-a',
      activationStatus: 'waiting',
      activationAttemptCount: 1,
      activationSmsSentAt: last.toISOString(),
      lastActivationAttemptAt: last.toISOString(),
      now: new Date(2026, 8, 20, 10, 0, 0),
    })
    expect(events.some((event) => event.date === '2026-09-15')).toBe(true)
    expect(events.some((event) => event.date === '2026-09-17')).toBe(true)
    expect(events.some((event) => event.date > '2026-09-20')).toBe(true)
  })

  it('stops projecting after 14 unanswered outbound texts', () => {
    const last = new Date(2026, 8, 15, 10, 0, 0)
    expect(
      buildTenantOnboardingCalendarEvents({
        residentId: 'res-a',
        activationStatus: 'waiting',
        activationAttemptCount: 14,
        lastActivationAttemptAt: last.toISOString(),
        now: last,
      }),
    ).toEqual([])
  })

  it('opens the strip on today when this tenant’s onboarding reminder is sooner than rent', () => {
    const rent = buildResidentCalendarEvents({
      leaseStartDate: '2026-03-01',
      leaseEndDate: '2026-12-31',
      rentDueDay: 1,
      rentReminderCadence: '5, 3, 1 days before',
      now: new Date(2026, 8, 15, 10, 0, 0),
    })
    const onboarding = buildTenantOnboardingCalendarEvents({
      residentId: 'res-a',
      activationStatus: 'waiting',
      activationAttemptCount: 1,
      lastActivationAttemptAt: new Date(2026, 8, 15, 10, 0, 0).toISOString(),
      now: new Date(2026, 8, 15, 10, 0, 0),
    })
    expect(
      stripStartIncludingRentReminders(
        [...rent, ...onboarding],
        '2026-09-15',
        '5, 3, 1 days before',
      ),
    ).toBe('2026-09-15')
  })
})
