import { describe, expect, it } from 'vitest'
import {
  buildPropertyHealthReport,
  hasPropertyHealthOperationalSignal,
  PROPERTY_HEALTH_INSIGHTS_CAPTION,
  PROPERTY_HEALTH_OPS_MATURITY_DAYS,
  resolvePropertyHealthKpiCaption,
  resolvePropertyHealthKpiValue,
  shouldShowPropertyHealthScore,
  type PropertyHealthPmTask,
  type PropertyHealthResident,
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

const activatedResident: PropertyHealthResident = {
  id: 'res-1',
  fullName: 'Tamara Jones',
  unit: '101',
  building: 'Sunset',
  status: 'active',
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

describe('property activation vs health insights', () => {
  it('marks a newly onboarded property Active without 30 days of history', () => {
    const report = buildPropertyHealthReport({
      units: [activeUnit],
      tickets: [],
      pmTasks: [],
      feedback: [],
      vendorMetrics: [],
      residents: [activatedResident],
      canonicalProperties: [{ id: 'prop-sunset', name: 'Sunset' }],
      now,
    })

    expect(report.portfolio?.status).toBe('active')
    expect(report.portfolio?.pendingReason).toBe('collecting_history')
    expect(shouldShowPropertyHealthScore(report.portfolio?.status)).toBe(false)
    expect(report.buildings[0]?.status).toBe('active')
    expect(resolvePropertyHealthKpiCaption(report.portfolio)).toBe(PROPERTY_HEALTH_INSIGHTS_CAPTION)
    expect(resolvePropertyHealthKpiValue(report.portfolio?.status, report.portfolio?.score)).toBe('—')
  })

  it('does not require a preventive-maintenance task to become Active', () => {
    const report = buildPropertyHealthReport({
      units: [activeUnit],
      tickets: [],
      pmTasks: [],
      feedback: [],
      vendorMetrics: [],
      residents: [activatedResident],
      now,
    })

    expect(report.portfolio?.status).toBe('active')
    expect(report.portfolio?.status).not.toBe('pending_setup')
  })

  it('keeps 30-day / PM history as an insights gate, not activation', () => {
    const report = buildPropertyHealthReport({
      units: [activeUnit],
      tickets: [],
      pmTasks: [],
      feedback: [],
      vendorMetrics: [],
      residents: [activatedResident],
      now,
    })

    expect(hasPropertyHealthOperationalSignal([activeUnit], [], [], now)).toBe(false)
    expect(report.portfolio?.pendingReason).toBe('collecting_history')
    expect(shouldShowPropertyHealthScore(report.portfolio?.status)).toBe(false)
  })

  it('shows a numeric score once a completed PM task exists', () => {
    const report = buildPropertyHealthReport({
      units: [activeUnit],
      tickets: [],
      pmTasks: [{ building: 'Sunset', unitLabel: '101', taskStatus: 'completed' }],
      feedback: [],
      vendorMetrics: [],
      residents: [activatedResident],
      now,
    })

    expect(report.portfolio?.status).not.toBe('pending_setup')
    expect(report.portfolio?.status).not.toBe('active')
    expect(shouldShowPropertyHealthScore(report.portfolio?.status)).toBe(true)
    expect(report.portfolio?.pendingReason).toBeNull()
    expect(report.portfolio?.score).toBeGreaterThan(0)
  })

  it('leaves existing scored properties healthy/monitor/at_risk', () => {
    const matureUnit = { ...activeUnit, trackedSinceMs: now - 40 * DAY_MS }
    const report = buildPropertyHealthReport({
      units: [matureUnit],
      tickets: [],
      pmTasks: [{ building: 'Sunset', unitLabel: '101', taskStatus: 'completed' }],
      feedback: [],
      vendorMetrics: [],
      residents: [activatedResident],
      now,
    })

    expect(report.portfolio?.status).toBe('healthy')
    expect(shouldShowPropertyHealthScore(report.portfolio?.status)).toBe(true)
  })

  it('does not treat cancelled work orders as ops history for insights', () => {
    const cancelledTicket = {
      id: 'cancelled-wo',
      createdAt: new Date(now - 40 * DAY_MS).toISOString(),
      unit: '101',
      unitId: 'u1',
      building: 'Sunset',
      issueCategory: 'plumbing',
      vendorWorkStatus: 'cancelled',
      assignedVendorId: null,
    }
    const report = buildPropertyHealthReport({
      units: [activeUnit],
      tickets: [cancelledTicket],
      pmTasks: [],
      feedback: [],
      vendorMetrics: [],
      residents: [activatedResident],
      now,
    })

    expect(hasPropertyHealthOperationalSignal([activeUnit], [], [cancelledTicket], now)).toBe(
      false,
    )
    expect(shouldShowPropertyHealthScore(report.portfolio?.status)).toBe(false)
    expect(report.portfolio?.pendingReason).toBe('collecting_history')
  })

  it('keeps incomplete properties in Pending setup when units are still inactive', () => {
    const report = buildPropertyHealthReport({
      units: [{ ...activeUnit, status: 'inactive' }],
      tickets: [],
      pmTasks: [],
      feedback: [],
      vendorMetrics: [],
      residents: [activatedResident],
      canonicalProperties: [{ id: 'prop-sunset', name: 'Sunset' }],
      now,
    })

    expect(report.buildings[0]?.status).toBe('pending_setup')
    expect(report.buildings[0]?.pendingReason).toBe('inactive_units')
  })
})
