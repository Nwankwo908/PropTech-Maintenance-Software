import { describe, expect, it } from 'vitest'
import {
  buildPropertyHealthReport,
  hasPropertyHealthOperationalSignal,
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
  it('shows a numeric Property Health score as soon as units are tracked', () => {
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

    expect(report.portfolio?.status).not.toBe('pending_setup')
    expect(shouldShowPropertyHealthScore(report.portfolio?.status)).toBe(true)
    expect(resolvePropertyHealthKpiValue(report.portfolio?.status, report.portfolio?.score, 'over100')).toMatch(
      /\/ 100$/,
    )
    expect(resolvePropertyHealthKpiCaption(report.portfolio)).toBe(report.portfolio?.rating)
    expect(report.buildings[0]?.components.some((c) => c.key === 'maintenance' && !c.isFallback)).toBe(true)
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

    expect(report.portfolio?.status).not.toBe('pending_setup')
  })

  it('keeps 30-day / PM history as a separate ops-maturity helper, not a KPI hide', () => {
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
    expect(shouldShowPropertyHealthScore(report.portfolio?.status)).toBe(true)
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
    expect(shouldShowPropertyHealthScore(report.portfolio?.status)).toBe(true)
    expect(report.portfolio?.score).toBeGreaterThan(0)
  })

  it('rates an occupied property with no open issues as Excellent', () => {
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

    expect(report.portfolio?.status).toBe('excellent')
    expect(shouldShowPropertyHealthScore(report.portfolio?.status)).toBe(true)
  })

  it('does not treat cancelled work orders as ops history for the maturity helper', () => {
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
    expect(shouldShowPropertyHealthScore(report.portfolio?.status)).toBe(true)
    expect(report.portfolio?.components.find((c) => c.key === 'maintenance')?.score).toBe(100)
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
