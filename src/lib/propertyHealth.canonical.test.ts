import { describe, expect, it } from 'vitest'
import {
  buildPropertyHealthReport,
  collectPropertyGridBuildingKeys,
  resolveBuildingHealthRow,
  unitBelongsToCanonicalProperty,
  type PropertyHealthCanonicalProperty,
  type PropertyHealthUnit,
} from '@/lib/propertyHealth'

const sunsetProperty: PropertyHealthCanonicalProperty = {
  id: 'prop-sunset',
  name: 'Sunset',
}

describe('collectPropertyGridBuildingKeys', () => {
  it('always includes saved properties even without units or active residents', () => {
    const keys = collectPropertyGridBuildingKeys(
      [],
      [],
      [],
      'landlord-1',
      [],
      [sunsetProperty],
    )
    expect(keys).toEqual(['Sunset'])
  })

  it('maps legacy suffixed unit buildings to the canonical property name', () => {
    const units: PropertyHealthUnit[] = [
      {
        id: 'u1',
        unitLabel: 'Unit 1',
        building: 'Sunset (Austin, TX)',
        status: 'vacant',
        propertyId: 'prop-sunset',
      },
    ]
    const keys = collectPropertyGridBuildingKeys(
      units,
      [],
      [],
      'landlord-1',
      [],
      [sunsetProperty],
    )
    expect(keys).toEqual(['Sunset'])
  })
})

describe('unitBelongsToCanonicalProperty', () => {
  it('matches by property id and legacy building suffix', () => {
    const unit: PropertyHealthUnit = {
      id: 'u1',
      unitLabel: 'Unit 1',
      building: 'Sunset (Austin, TX)',
      status: 'vacant',
      propertyId: 'prop-sunset',
    }
    expect(unitBelongsToCanonicalProperty(unit, sunsetProperty)).toBe(true)
  })
})

describe('buildPropertyHealthReport', () => {
  it('keeps a saved property visible after its only resident is marked past', () => {
    const units: PropertyHealthUnit[] = [
      {
        id: 'u1',
        unitLabel: 'Unit 1',
        building: 'Sunset',
        status: 'vacant',
        propertyId: 'prop-sunset',
      },
    ]

    const report = buildPropertyHealthReport({
      units,
      tickets: [],
      pmTasks: [],
      feedback: [],
      vendorMetrics: [],
      residents: [],
      canonicalProperties: [sunsetProperty],
    })

    expect(report.buildings.map((row) => row.building)).toEqual(['Sunset'])
    expect(report.buildings[0]?.unitCount).toBe(1)
  })

  it('resolveBuildingHealthRow matches the canonical property name on the grid', () => {
    const units: PropertyHealthUnit[] = [
      {
        id: 'u1',
        unitLabel: 'Unit 1',
        building: 'Sunset (Austin, TX)',
        status: 'active',
        propertyId: 'prop-sunset',
      },
    ]

    const report = buildPropertyHealthReport({
      units,
      tickets: [],
      pmTasks: [],
      feedback: [],
      vendorMetrics: [],
      residents: [],
      canonicalProperties: [sunsetProperty],
    })

    const row = resolveBuildingHealthRow(report, 'Sunset')
    expect(row?.building).toBe('Sunset')
    expect(row?.unitCount).toBe(1)
    expect(row?.score).toBeGreaterThan(0)
  })
})
