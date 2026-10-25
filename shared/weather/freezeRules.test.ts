import { describe, expect, it } from 'vitest'
import {
  evaluateFreezeLevel,
  nwsRequestDelayMs,
  shouldRetryNwsStatus,
  weatherCellKey,
  type HourlyForecastPoint,
} from './freezeRules.ts'
import {
  buildFreezeAlertSms,
  buildWinterizingSms,
  deriveWeatherAttentionCard,
  formatPropertyNameList,
  geocodeStatusForAddress,
  planGeocodeBackfill,
  planWeatherCycle,
  raisedTicketUrgency,
  resolveFrostDate,
  ticketRaisedActivityMessage,
  weatherChipLabel,
  winterizingChecklist,
  winterizingWindow,
  type WeatherEventState,
} from './weatherMonitor.ts'
import { LIMITED_ALPHA_1_LANDLORD_ID } from '../landlordCapabilities.ts'

function hours(startIso: string, temps: number[], chill: Array<number | null> = []): HourlyForecastPoint[] {
  const start = Date.parse(startIso)
  return temps.map((tempF, index) => ({
    time: new Date(start + index * 60 * 60 * 1000).toISOString(),
    tempF,
    windChillF: chill[index] ?? null,
  }))
}

const NOW = new Date('2026-01-20T18:00:00.000Z')

describe('freeze rules', () => {
  it('names each level at its threshold boundary', () => {
    expect(
      evaluateFreezeLevel({
        hourly: hours('2026-01-20T18:00:00.000Z', [32]),
        property: {},
        now: NOW,
      }),
    ).toBe('freeze_watch')
    expect(
      evaluateFreezeLevel({
        hourly: hours('2026-01-20T18:00:00.000Z', [33]),
        property: {},
        now: NOW,
      }),
    ).toBeNull()
    expect(
      evaluateFreezeLevel({
        hourly: hours('2026-01-20T18:00:00.000Z', [20]),
        property: {},
        now: NOW,
      }),
    ).toBe('hard_freeze')
    expect(
      evaluateFreezeLevel({
        hourly: hours('2026-01-20T18:00:00.000Z', [21, 21, 21, 21]),
        property: {},
        now: NOW,
      }),
    ).toBe('hard_freeze')
    expect(
      evaluateFreezeLevel({
        hourly: hours('2026-01-20T18:00:00.000Z', [28, 28, 28, 28]),
        property: {},
        now: NOW,
      }),
    ).toBe('hard_freeze')
    expect(
      evaluateFreezeLevel({
        hourly: hours('2026-01-20T18:00:00.000Z', [28, 28, 28]),
        property: {},
        now: NOW,
      }),
    ).toBe('freeze_watch')
    expect(
      evaluateFreezeLevel({
        hourly: hours('2026-01-20T18:00:00.000Z', [40], [0]),
        property: {},
        now: NOW,
      }),
    ).toBe('extreme_cold')
    expect(
      evaluateFreezeLevel({
        hourly: hours('2026-01-20T18:00:00.000Z', [40], [1]),
        property: {},
        now: NOW,
      }),
    ).toBeNull()
  })

  it('raises thresholds for a warm state and a vacant home', () => {
    const mild = hours('2026-01-20T18:00:00.000Z', [36])
    expect(evaluateFreezeLevel({ hourly: mild, property: { state: 'MD' }, now: NOW })).toBeNull()
    expect(evaluateFreezeLevel({ hourly: mild, property: { state: 'FL' }, now: NOW })).toBe('freeze_watch')
    expect(evaluateFreezeLevel({ hourly: mild, property: { vacant: true }, now: NOW })).toBe('freeze_watch')
    expect(
      evaluateFreezeLevel({
        hourly: mild,
        property: { state: 'MD', yearBuilt: 1950 },
        now: NOW,
      }),
    ).toBe('freeze_watch')
  })

  it('lets an NWS warning win over a warmer forecast', () => {
    const warm = hours('2026-01-20T18:00:00.000Z', [55])
    expect(
      evaluateFreezeLevel({
        hourly: warm,
        alerts: [{ event: 'Freeze Warning' }],
        property: {},
        now: NOW,
      }),
    ).toBe('hard_freeze')
    expect(
      evaluateFreezeLevel({
        hourly: warm,
        alerts: [{ event: 'Extreme Cold Warning' }],
        property: {},
        now: NOW,
      }),
    ).toBe('extreme_cold')
    expect(
      evaluateFreezeLevel({
        hourly: warm,
        alerts: [{ event: 'Wind Chill Warning' }],
        property: {},
        now: NOW,
      }),
    ).toBe('extreme_cold')
  })

  it('rounds a cell to a tenth of a degree and paces NWS calls', () => {
    expect(weatherCellKey(38.907, -77.036)).toBe('38.9,-77.0')
    expect(nwsRequestDelayMs([0, 10, 20, 30, 40], 50)).toBeGreaterThan(0)
    expect(nwsRequestDelayMs([0, 10], 50)).toBe(0)
    expect(shouldRetryNwsStatus(429)).toBe(true)
    expect(shouldRetryNwsStatus(503)).toBe(true)
    expect(shouldRetryNwsStatus(404)).toBe(false)
  })
})

describe('weather event lifecycle', () => {
  const property = {
    id: 'prop-1',
    landlordId: 'landlord-1',
    name: '123 Main',
    state: 'MD',
    yearBuilt: 1990,
    vacant: false,
    cellKey: '38.9,-77.0',
  }

  function cycle(hourly: HourlyForecastPoint[], events: WeatherEventState[] = [], fetchedAt = NOW.toISOString()) {
    return planWeatherCycle({
      now: NOW,
      properties: [property],
      snapshots: {
        '38.9,-77.0': { fetchedAt, sourceOk: true, hourly, alerts: [] },
      },
      events,
      tickets: [],
      tasks: [{ id: 'done', propertyId: 'prop-1', title: 'Winterizing', status: 'completed', kind: 'winterizing', season: '2026', checklistDone: true }],
      settingsByLandlord: {
        'landlord-1': { textEnabled: true, thresholdAdjustF: 0, watchTextEnabled: false },
      },
      appLink: 'https://www.ulohome.io/admin',
    })
  }

  it('updates one event from a watch to a hard freeze and sends one text', () => {
    const watch = cycle(hours('2026-01-20T18:00:00.000Z', [30]))
    expect(watch.events.filter((event) => event.status === 'active')).toHaveLength(1)
    expect(watch.events[0]?.level).toBe('freeze_watch')
    expect(watch.sms).toHaveLength(0)

    const harder = cycle(hours('2026-01-20T18:00:00.000Z', [19]), watch.events)
    const active = harder.events.filter((event) => event.status === 'active')
    expect(active).toHaveLength(1)
    expect(active[0]?.id).toBe(watch.events[0]?.id)
    expect(active[0]?.level).toBe('hard_freeze')
    expect(harder.sms).toHaveLength(1)

    const again = cycle(hours('2026-01-20T18:00:00.000Z', [19]), harder.events)
    expect(again.sms).toHaveLength(0)

    const warm = cycle(hours('2026-01-20T18:00:00.000Z', [45]), harder.events)
    expect(warm.events.filter((event) => event.status === 'active')).toHaveLength(0)
    expect(warm.events[0]?.status).toBe('resolved')
    expect(warm.sms).toHaveLength(0)
  })

  it('does not alert from a snapshot older than 6 hours', () => {
    const stale = new Date(NOW.getTime() - 7 * 60 * 60 * 1000).toISOString()
    const plan = cycle(hours('2026-01-20T18:00:00.000Z', [10]), [], stale)
    expect(plan.sms).toHaveLength(0)
    expect(plan.events.filter((event) => event.status === 'active')).toHaveLength(0)
  })
})

describe('ticket urgency from the forecast', () => {
  it('raises an open no-heat ticket and never lowers one', () => {
    expect(raisedTicketUrgency('medium', 'No heat in the bedroom', 18)).toEqual({
      next: 'emergency',
      changed: true,
    })
    expect(ticketRaisedActivityMessage('emergency', 18)).toBe(
      'No-heat ticket raised to emergency: low of 18°F forecast tonight.',
    )
    expect(raisedTicketUrgency('emergency', 'No heat in the bedroom', 70)).toEqual({
      next: 'emergency',
      changed: false,
    })
  })

  it('raises the ticket inside a monitor pass', () => {
    const plan = planWeatherCycle({
      now: NOW,
      properties: [{
        id: 'prop-1',
        landlordId: 'landlord-1',
        name: '123 Main',
        state: 'MD',
        yearBuilt: 1990,
        vacant: false,
        cellKey: '38.9,-77.0',
      }],
      snapshots: {
        '38.9,-77.0': {
          fetchedAt: NOW.toISOString(),
          sourceOk: true,
          hourly: hours('2026-01-20T18:00:00.000Z', [18]),
          alerts: [],
        },
      },
      events: [],
      tickets: [{ id: 'ticket-1', propertyId: 'prop-1', description: 'No heat in the bedroom', urgency: 'normal' }],
      tasks: [],
      settingsByLandlord: {},
      appLink: 'https://www.ulohome.io/admin',
    })
    expect(plan.ticketUpdates).toEqual([
      expect.objectContaining({
        ticketId: 'ticket-1',
        to: 'emergency',
        message: 'No-heat ticket raised to emergency: low of 18°F forecast tonight.',
      }),
    ])
  })
})

describe('frost dates and winterizing', () => {
  it('uses the median first frost from Open-Meteo days', () => {
    const days = [2020, 2021, 2022, 2023, 2024].flatMap((year) => [
      { time: `${year}-10-01`, tempMinF: 40 },
      { time: `${year}-10-12`, tempMinF: 31 },
    ])
    const frost = resolveFrostDate({ state: 'MD', openMeteoDays: days, apiKeyPresent: true })
    expect(frost).toEqual({ monthDay: '10-12', source: 'open-meteo', loggedFallback: false })
  })

  it('falls back to the state table when the key is missing', () => {
    const frost = resolveFrostDate({ state: 'MD', openMeteoDays: null, apiKeyPresent: false })
    expect(frost.source).toBe('state_average')
    expect(frost.loggedFallback).toBe(true)
    expect(frost.monthDay).toBe('10-20')
  })

  it('creates one winterizing checklist 28 days before frost and links the HVAC tune-up', () => {
    const now = new Date('2026-10-15T15:00:00.000Z')
    expect(winterizingWindow(now, '11-12')?.season).toBe('2026')
    const checklist = winterizingChecklist('hvac-1')
    expect(checklist.find((item) => item.key === 'furnace')?.linkedTaskId).toBe('hvac-1')
    const plan = planWeatherCycle({
      now,
      properties: [{
        id: 'prop-1',
        landlordId: 'landlord-1',
        name: '123 Main',
        state: 'MD',
        yearBuilt: 1990,
        vacant: true,
        cellKey: null,
      }],
      snapshots: {},
      events: [],
      tickets: [],
      tasks: [{ id: 'hvac-1', propertyId: 'prop-1', title: 'Furnace tune-up', status: 'scheduled', kind: 'hvac', season: null, checklistDone: false }],
      settingsByLandlord: {},
      appLink: 'https://www.ulohome.io/admin',
      frostByProperty: { 'prop-1': { monthDay: '11-12', label: 'Nov 12' } },
    })
    expect(plan.winterizingTasks).toHaveLength(1)
    expect(plan.winterizingTasks[0]?.hvacTaskId).toBe('hvac-1')
    expect(plan.winterizingTasks[0]?.checklist.some((item) => item.label.startsWith('Shut off and drain'))).toBe(true)
    const again = planWeatherCycle({
      now,
      properties: [{
        id: 'prop-1',
        landlordId: 'landlord-1',
        name: '123 Main',
        state: 'MD',
        yearBuilt: 1990,
        vacant: true,
        cellKey: null,
      }],
      snapshots: {},
      events: [],
      tickets: [],
      tasks: [
        { id: 'hvac-1', propertyId: 'prop-1', title: 'Furnace tune-up', status: 'scheduled', kind: 'hvac', season: null, checklistDone: false },
        { id: 'win-1', propertyId: 'prop-1', title: 'Winterizing checklist', status: 'scheduled', kind: 'winterizing', season: '2026', checklistDone: false },
      ],
      settingsByLandlord: {},
      appLink: 'https://www.ulohome.io/admin',
      frostByProperty: { 'prop-1': { monthDay: '11-12', label: 'Nov 12' } },
      winterizingAlreadySentOn: { 'landlord-1': '2026-10-15' },
    })
    expect(again.winterizingTasks).toHaveLength(0)
    expect(again.winterizingSms).toHaveLength(0)
  })
})

describe('weather attention and SMS', () => {
  it('marks an unwinterized hard freeze critical', () => {
    const card = deriveWeatherAttentionCard({
      landlordId: 'landlord-1',
      events: [{
        id: 'event-1',
        propertyId: 'prop-1',
        landlordId: 'landlord-1',
        level: 'hard_freeze',
        startsAt: '2026-01-20T18:00:00.000Z',
        endsAt: null,
        lowTempF: 19,
        nwsEvent: null,
        status: 'active',
        notifiedLevel: 'hard_freeze',
      }],
      properties: [{ id: 'prop-1', name: '123 Main', vacant: true }],
      unwinterizedPropertyIds: ['prop-1'],
      heatTickets: [],
    })
    expect(card?.badge).toBe('critical')
    expect(card?.key).toBe('weather:landlord-1:2026-01-20')
  })

  it('lists three property names and a remainder', () => {
    expect(formatPropertyNameList(['123 Main', '45 Oak', '9 Elm', '2 Pine', '8 Cedar'])).toBe(
      '123 Main, 45 Oak, 9 Elm +2 more',
    )
    const body = buildFreezeAlertSms({
      level: 'hard_freeze',
      lowTempF: 19,
      whenLabel: 'Tue night',
      propertyNames: ['123 Main', '45 Oak', '9 Elm', '2 Pine', '8 Cedar'],
      vacantCount: 1,
      unwinterizedCount: 1,
      link: 'https://www.ulohome.io/admin',
    })
    expect(body).toContain('123 Main, 45 Oak, 9 Elm +2 more')
    expect(body).toContain('1 vacant unit, 1 not winterized')
    expect(buildWinterizingSms({
      frostLabel: 'Nov 12',
      nearName: '123 Main',
      propertyCount: 3,
      link: 'https://www.ulohome.io/admin',
    })).toContain('First frost is usually around Nov 12 near 123 Main')
  })

  it('shows the low on the property chip', () => {
    const label = weatherChipLabel({
      sourceOk: true,
      fetchedAt: '2026-01-20T16:00:00.000Z',
      hourly: [{ time: '2026-01-20T23:00:00.000Z', tempF: 19, windChillF: null }],
      now: new Date('2026-01-20T18:00:00.000Z'),
    })
    expect(label.startsWith('Low 19°F')).toBe(true)
    expect(weatherChipLabel({
      sourceOk: true,
      fetchedAt: '2026-01-20T00:00:00.000Z',
      hourly: [],
      now: new Date('2026-01-20T18:00:00.000Z'),
    })).toBe('Weather unavailable')
  })
})

describe('geocode backfill', () => {
  it('saves coordinates, records misses, and skips Limited Alpha 1', () => {
    const plan = planGeocodeBackfill({
      dryRun: false,
      rows: [
        { id: 'ok', landlordId: 'landlord-1', state: 'MD', latitude: null, longitude: null },
        { id: 'miss', landlordId: 'landlord-1', state: 'MD', latitude: null, longitude: null },
        { id: 'abroad', landlordId: 'landlord-1', state: 'ON', latitude: null, longitude: null },
        { id: 'la1', landlordId: LIMITED_ALPHA_1_LANDLORD_ID, state: 'MD', latitude: null, longitude: null },
      ],
      results: {
        ok: { lat: 38.9, lon: -77.0 },
        miss: null,
        abroad: null,
        la1: { lat: 1, lon: 1 },
      },
    })
    expect(plan.find((row) => row.id === 'ok')).toMatchObject({
      action: 'save',
      latitude: 38.9,
      longitude: -77.0,
      geocodeStatus: 'ok',
    })
    expect(plan.find((row) => row.id === 'miss')?.action).toBe('not_found')
    expect(plan.find((row) => row.id === 'abroad')?.action).toBe('non_us')
    expect(plan.find((row) => row.id === 'la1')?.action).toBe('skip_la1')
    expect(geocodeStatusForAddress('MD', null)).toBe('not_found')
  })
})
