import { describe, expect, it } from 'vitest'
import {
  buildPropertyHealthReport,
  resolvePropertyHealthKpiCaption,
  rollupPortfolioHealthFromBuildings,
  type PropertyHealthAsset,
  type PropertyHealthResident,
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

function resident(
  id: string,
  unitLabel: string,
  building: string,
): PropertyHealthResident {
  return { id, fullName: id, unit: unitLabel, building, status: 'active' }
}

function goodRoof(building: string, propertyId: string): PropertyHealthAsset {
  return {
    building,
    propertyId,
    applianceType: 'roof',
    estimatedAgeYears: 5,
    usefulLifeYears: 25,
    replacementUrgency: null,
    condition: 'good',
    deficiencies: [],
  }
}

function wornRoof(building: string, propertyId: string): PropertyHealthAsset {
  return {
    ...goodRoof(building, propertyId),
    estimatedAgeYears: 24,
    condition: 'poor',
    replacementUrgency: 'replace_now',
  }
}

describe('rollupPortfolioHealthFromBuildings', () => {
  it('unit-weights Overview by inventory, skipping buildings without a Condition score', () => {
    const report = buildPropertyHealthReport({
      units: [
        unit({ id: 'a1', unitLabel: '1', building: 'Annex', propertyId: 'p-annex' }),
        unit({ id: 'm1', unitLabel: '1', building: 'Main', propertyId: 'p-main' }),
        unit({ id: 'm2', unitLabel: '2', building: 'Main', propertyId: 'p-main' }),
        unit({ id: 'm3', unitLabel: '3', building: 'Main', propertyId: 'p-main' }),
        unit({ id: 'u1', unitLabel: '1', building: 'Unknown', propertyId: 'p-unk' }),
      ],
      tickets: [],
      pmTasks: [],
      feedback: [],
      vendorMetrics: [],
      assets: [wornRoof('Annex', 'p-annex'), goodRoof('Main', 'p-main')],
      residents: [
        resident('ra', '1', 'Annex'),
        resident('rm1', '1', 'Main'),
        resident('rm2', '2', 'Main'),
        resident('rm3', '3', 'Main'),
        resident('ru', '1', 'Unknown'),
      ],
      canonicalProperties: [
        { id: 'p-annex', name: 'Annex' },
        { id: 'p-main', name: 'Main' },
        { id: 'p-unk', name: 'Unknown' },
      ],
      now,
    })

    const annex = report.buildings.find((row) => row.building === 'Annex')
    const main = report.buildings.find((row) => row.building === 'Main')
    const unknown = report.buildings.find((row) => row.building === 'Unknown')

    expect(annex?.score).not.toBeNull()
    expect(main?.score).not.toBeNull()
    expect(unknown?.score).toBeNull()
    expect(report.portfolio?.scoredPropertyCount).toBe(2)
    expect(report.portfolio?.propertyCount).toBe(3)

    const expected = Math.round(
      (annex!.score! * 1 + main!.score! * 3) / 4,
    )
    expect(report.portfolio?.score).toBe(expected)
    expect(expected).not.toBe(Math.round(((annex!.score! + main!.score!) / 2)))
    expect(resolvePropertyHealthKpiCaption(report.portfolio)).toContain('2 of 3 properties scored')
  })

  it('does not average pending-setup buildings as 0 or 50', () => {
    const rolled = rollupPortfolioHealthFromBuildings([
      {
        building: 'Ready',
        unitCount: 2,
        openTickets: 0,
        occupancyPct: 100,
        residentRating: null,
        feedbackCount: 0,
        score: 90,
        status: 'excellent',
        rating: 'Excellent',
        components: [
          {
            key: 'condition',
            label: 'Condition',
            score: 90,
            weight: 0.4,
            isFallback: false,
            detail: 'Roof in good condition',
          },
          {
            key: 'maintenance',
            label: 'Maintenance',
            score: 100,
            weight: 0.35,
            isFallback: false,
            detail: 'No deductions',
          },
          {
            key: 'risk',
            label: 'Risk',
            score: 100,
            weight: 0.25,
            isFallback: false,
            detail: 'No deductions',
          },
        ],
        trackedUnitCount: 2,
      },
      {
        building: 'Empty',
        unitCount: 10,
        openTickets: 0,
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
    expect(rolled?.scoredPropertyCount).toBe(1)
    expect(rolled?.propertyCount).toBe(2)
  })
})
