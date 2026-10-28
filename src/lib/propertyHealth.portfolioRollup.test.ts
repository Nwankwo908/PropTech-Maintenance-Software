import { describe, expect, it } from 'vitest'
import {
  buildPropertyHealthReport,
  resolvePropertyHealthKpiCaption,
  rollupPortfolioHealthFromBuildings,
  type PropertyHealthComponent,
  type PropertyHealthResident,
  type PropertyHealthTicket,
  type PropertyHealthUnit,
} from '@/lib/propertyHealth'

const now = Date.parse('2026-08-01T12:00:00.000Z')

function unit(partial: Partial<PropertyHealthUnit> & Pick<PropertyHealthUnit, 'id' | 'unitLabel' | 'building'>): PropertyHealthUnit {
  return {
    status: 'active',
    propertyId: partial.propertyId ?? `prop-${partial.building}`,
    ...partial,
  }
}

function resident(id: string, unitLabel: string, building: string): PropertyHealthResident {
  return { id, fullName: id, unit: unitLabel, building, status: 'active' }
}

function openTicket(id: string, building: string, unitId: string, propertyId: string): PropertyHealthTicket {
  return {
    id,
    createdAt: new Date(now - 3 * 24 * 60 * 60 * 1000).toISOString(),
    unit: '1',
    unitId,
    building,
    propertyId,
    issueCategory: 'plumbing',
    vendorWorkStatus: 'pending_accept',
    assignedVendorId: null,
  }
}

function component(key: PropertyHealthComponent['key'], score: number): PropertyHealthComponent {
  return { key, label: key, score, maxPoints: 25, weight: 0.25, isFallback: false, detail: '' }
}

describe('rollupPortfolioHealthFromBuildings', () => {
  it('unit-weights Overview by inventory, skipping pending-setup buildings', () => {
    const report = buildPropertyHealthReport({
      units: [
        unit({ id: 'a1', unitLabel: '1', building: 'Annex', propertyId: 'p-annex' }),
        unit({ id: 'm1', unitLabel: '1', building: 'Main', propertyId: 'p-main' }),
        unit({ id: 'm2', unitLabel: '2', building: 'Main', propertyId: 'p-main' }),
        unit({ id: 'm3', unitLabel: '3', building: 'Main', propertyId: 'p-main' }),
        unit({ id: 'n1', unitLabel: '1', building: 'New', propertyId: 'p-new', status: 'inactive' }),
      ],
      tickets: [
        openTicket('t1', 'Annex', 'a1', 'p-annex'),
        openTicket('t2', 'Annex', 'a1', 'p-annex'),
      ],
      pmTasks: [],
      feedback: [],
      vendorMetrics: [],
      residents: [
        resident('ra', '1', 'Annex'),
        resident('rm1', '1', 'Main'),
        resident('rm2', '2', 'Main'),
        resident('rm3', '3', 'Main'),
      ],
      canonicalProperties: [
        { id: 'p-annex', name: 'Annex' },
        { id: 'p-main', name: 'Main' },
        { id: 'p-new', name: 'New' },
      ],
      now,
    })

    const annex = report.buildings.find((row) => row.building === 'Annex')
    const main = report.buildings.find((row) => row.building === 'Main')
    const fresh = report.buildings.find((row) => row.building === 'New')

    // Annex: 2 open items (10) + occupied (25) = 35. Main: 0 open (25) + occupied (25) = 50.
    expect(annex?.score).toBe(35)
    expect(main?.score).toBe(50)
    expect(fresh?.status).toBe('pending_setup')
    expect(report.portfolio?.scoredPropertyCount).toBe(2)
    expect(report.portfolio?.propertyCount).toBe(3)

    // (35 × 1 unit + 50 × 3 units) / 4 = 46.25 → 46, not the plain average 43.
    expect(report.portfolio?.score).toBe(46)
    expect(report.portfolio?.status).toBe('critical')
    expect(resolvePropertyHealthKpiCaption(report.portfolio)).toContain('2 of 3 properties scored')
  })

  it('does not average pending-setup buildings as 0', () => {
    const rolled = rollupPortfolioHealthFromBuildings([
      {
        building: 'Ready',
        unitCount: 2,
        openTickets: 0,
        workOrderCount: 0,
        occupancyPct: 100,
        residentRating: null,
        feedbackCount: 0,
        score: 90,
        status: 'healthy',
        rating: 'Healthy',
        components: [
          component('open_items', 25),
          component('occupancy', 25),
          component('vendor_coverage', 25),
          component('documentation', 15),
        ],
        trackedUnitCount: 2,
      },
      {
        building: 'Empty',
        unitCount: 10,
        openTickets: 0,
        workOrderCount: 0,
        occupancyPct: 0,
        residentRating: null,
        feedbackCount: 0,
        score: 0,
        status: 'pending_setup',
        rating: null,
        components: [],
        trackedUnitCount: 0,
        pendingReason: 'inactive_units',
      },
    ])

    expect(rolled?.score).toBe(90)
    expect(rolled?.status).toBe('healthy')
    expect(rolled?.scoredPropertyCount).toBe(1)
    expect(rolled?.propertyCount).toBe(2)
  })
})
