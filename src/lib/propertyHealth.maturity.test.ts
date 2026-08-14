import { describe, expect, it } from 'vitest'
import {
  buildPropertyHealthReport,
  hasPropertyHealthOperationalSignal,
  PROPERTY_HEALTH_OPS_MATURITY_DAYS,
  type PropertyHealthPmTask,
  type PropertyHealthUnit,
} from '@/lib/propertyHealth'

const DAY_MS = 24 * 60 * 60 * 1000
const now = Date.parse('2026-08-01T12:00:00.000Z')

const activeUnit: PropertyHealthUnit = {
  id: 'u1',
  unitLabel: '101',
  building: 'Sunset',
  status: 'active',
  propertyId: 'prop-sunset',
  trackedSinceMs: now - 3 * DAY_MS,
}

describe('hasPropertyHealthOperationalSignal', () => {
  it('returns false for recently activated units with no PM history', () => {
    expect(
      hasPropertyHealthOperationalSignal([activeUnit], [], [], now, PROPERTY_HEALTH_OPS_MATURITY_DAYS),
    ).toBe(false)
  })

  it('returns true after 30 days of operational history', () => {
    const matureUnit = {
      ...activeUnit,
      trackedSinceMs: now - 31 * DAY_MS,
    }
    expect(
      hasPropertyHealthOperationalSignal([matureUnit], [], [], now, PROPERTY_HEALTH_OPS_MATURITY_DAYS),
    ).toBe(true)
  })

  it('returns true after one completed PM task', () => {
    const pmTasks: PropertyHealthPmTask[] = [
      { building: 'Sunset', unitLabel: '101', taskStatus: 'completed' },
    ]
    expect(
      hasPropertyHealthOperationalSignal([activeUnit], pmTasks, [], now, PROPERTY_HEALTH_OPS_MATURITY_DAYS),
    ).toBe(true)
  })
})

describe('buildPropertyHealthReport maturity gate', () => {
  it('keeps a freshly activated property in pending setup instead of showing a high score', () => {
    const report = buildPropertyHealthReport({
      units: [activeUnit],
      tickets: [],
      pmTasks: [],
      feedback: [],
      vendorMetrics: [],
      residents: [],
      now,
    })

    expect(report.portfolio?.status).toBe('pending_setup')
    expect(report.portfolio?.pendingReason).toBe('collecting_history')
    expect(report.portfolio?.score).toBeGreaterThan(0)
    expect(report.buildings[0]?.status).toBe('pending_setup')
    expect(report.buildings[0]?.pendingReason).toBe('collecting_history')
  })

  it('shows a numeric score once a completed PM task exists', () => {
    const report = buildPropertyHealthReport({
      units: [activeUnit],
      tickets: [],
      pmTasks: [{ building: 'Sunset', unitLabel: '101', taskStatus: 'completed' }],
      feedback: [],
      vendorMetrics: [],
      residents: [],
      now,
    })

    expect(report.portfolio?.status).not.toBe('pending_setup')
    expect(report.portfolio?.pendingReason).toBeNull()
    expect(report.portfolio?.score).toBeGreaterThan(0)
  })
})
