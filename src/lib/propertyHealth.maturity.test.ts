import { describe, expect, it } from 'vitest'
import {
  buildPropertyHealthReport,
  hasPropertyHealthOperationalSignal,
  PROPERTY_HEALTH_OPS_MATURITY_DAYS,
  resolvePropertyHealthKpiValue,
  shouldShowPropertyHealthScore,
  type PropertyHealthAsset,
  type PropertyHealthPmTask,
  type PropertyHealthResident,
  type PropertyHealthTicket,
  type PropertyHealthUnit,
  type PropertyHealthVendor,
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

const youngRoof: PropertyHealthAsset = {
  building: 'Sunset',
  propertyId: 'prop-sunset',
  applianceType: 'roof',
  estimatedAgeYears: 5,
  usefulLifeYears: 25,
  replacementUrgency: null,
  condition: 'good',
  deficiencies: [],
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
  const allCoreVendors: PropertyHealthVendor[] = [
    'Plumbing',
    'HVAC',
    'Electrical',
    'Appliance repair',
    'Locksmith',
    'Pest control',
    'Roofing',
    'Handyman',
  ].map((category, index) => ({ id: `v${index}`, category, active: true, rosterStatus: 'active' }))

  const homeCheckAssets: PropertyHealthAsset[] = [
    { ...youngRoof, applianceType: 'water_heater' },
    { ...youngRoof, applianceType: 'furnace' },
  ]

  function ticket(id: string, vendorWorkStatus: string, extra: Partial<PropertyHealthTicket> = {}): PropertyHealthTicket {
    return {
      id,
      createdAt: new Date(now - 10 * DAY_MS).toISOString(),
      unit: '101',
      unitId: 'u1',
      building: 'Sunset',
      issueCategory: 'plumbing',
      vendorWorkStatus,
      assignedVendorId: null,
      ...extra,
    }
  }

  it('scores as soon as units are active — no condition gate', () => {
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

    // 25 (no open items) + 25 (fully occupied) + 0 (no vendors) + 0 (no documents)
    expect(report.portfolio?.score).toBe(50)
    expect(report.portfolio?.status).toBe('at_risk')
    expect(shouldShowPropertyHealthScore(report.portfolio?.status)).toBe(true)
    expect(resolvePropertyHealthKpiValue(report.portfolio?.status, report.portfolio?.score, 'over100')).toBe(
      '50 / 100',
    )
    expect(report.buildings[0]?.gaps?.[0]).toEqual({
      dimension: 'vendor_coverage',
      action: 'Add vendors for Plumbing, HVAC, Electrical and Appliance',
      pointsGain: 10,
    })
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

  it('scores 100 Healthy with full vendor coverage, lease, Home Check equipment and a job photo', () => {
    const report = buildPropertyHealthReport({
      units: [activeUnit],
      tickets: [ticket('done', 'completed', { completedAt: new Date(now - 2 * DAY_MS).toISOString() })],
      pmTasks: [],
      assets: homeCheckAssets,
      feedback: [],
      vendorMetrics: [],
      residents: [activatedResident],
      canonicalProperties: [{ id: 'prop-sunset', name: 'Sunset' }],
      vendors: allCoreVendors,
      ticketExtras: { done: { observationOnly: false, completionPhotoCount: 2 } },
      leaseDocuments: { hasLeaseFor: (resident) => resident.fullName === 'Tamara Jones' },
      now,
    })

    expect(report.portfolio?.score).toBe(100)
    expect(report.portfolio?.status).toBe('healthy')
    expect(report.buildings[0]?.gaps).toEqual([])
  })

  it('ignores cancelled jobs and Home Check observations as open action items', () => {
    const report = buildPropertyHealthReport({
      units: [activeUnit],
      tickets: [
        ticket('cancelled', 'cancelled'),
        ticket('home-check', 'pending_accept'),
        ticket('real', 'pending_accept'),
      ],
      pmTasks: [],
      feedback: [],
      vendorMetrics: [],
      residents: [activatedResident],
      ticketExtras: { 'home-check': { observationOnly: true, completionPhotoCount: 0 } },
      now,
    })

    const openItems = report.buildings[0]?.components.find((c) => c.key === 'open_items')
    expect(openItems?.score).toBe(18)
    expect(openItems?.detail).toContain('1 open action item')
  })

  it('does not count a lease when any current resident is missing one', () => {
    const report = buildPropertyHealthReport({
      units: [activeUnit, { ...activeUnit, id: 'u2', unitLabel: '102' }],
      tickets: [],
      pmTasks: [],
      feedback: [],
      vendorMetrics: [],
      residents: [activatedResident, { ...activatedResident, id: 'res-2', fullName: 'Sam Lee', unit: '102' }],
      leaseDocuments: { hasLeaseFor: (resident) => resident.fullName === 'Tamara Jones' },
      now,
    })

    const documentation = report.buildings[0]?.components.find((c) => c.key === 'documentation')
    expect(documentation?.score).toBe(0)
    expect(documentation?.detail).toContain('Lease missing')
  })

  it('does not show Pending setup when a qualified tenant is already assigned', () => {
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

    expect(report.buildings[0]?.status).not.toBe('pending_setup')
    expect(shouldShowPropertyHealthScore(report.buildings[0]?.status)).toBe(true)
  })

  it('does not show Pending setup when residents are on the property without matching unit labels', () => {
    const report = buildPropertyHealthReport({
      units: [
        {
          id: 'u-maple-1',
          unitLabel: '101',
          building: '81 Maple St',
          status: 'inactive',
          propertyId: 'prop-maple',
        },
      ],
      tickets: [],
      pmTasks: [],
      feedback: [],
      vendorMetrics: [],
      residents: [
        {
          id: 'marie',
          fullName: 'Marie Y Jean-Baptiste',
          unit: '1',
          building: '81 Maple St',
          status: 'active',
        },
        {
          id: 'jean',
          fullName: 'Jean J. Pierre',
          unit: '2',
          building: '81 Maple Street',
          status: 'active',
        },
      ],
      canonicalProperties: [{ id: 'prop-maple', name: '81 Maple St' }],
      now,
    })

    expect(report.buildings[0]?.building).toBe('81 Maple St')
    expect(report.buildings[0]?.status).not.toBe('pending_setup')
  })
})
