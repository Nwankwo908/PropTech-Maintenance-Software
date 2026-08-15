import { describe, expect, it } from 'vitest'
import {
  buildPropertyHealthReport,
  collectPropertyGridBuildingKeys,
  countDistinctPortfolioUnits,
  dedupePropertyUnitsByLabel,
  filterResidentsForPropertyScope,
  filterUnitsForPropertyDetailScope,
  resolveBuildingHealthRow,
  unitBelongsToCanonicalProperty,
  type PropertyHealthCanonicalProperty,
  type PropertyHealthResident,
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

describe('filterResidentsForPropertyScope', () => {
  const units: PropertyHealthUnit[] = [
    {
      id: 'u101',
      unitLabel: '101',
      building: 'Sunset',
      status: 'active',
      propertyId: 'prop-sunset',
    },
    {
      id: 'u102',
      unitLabel: '102',
      building: 'Sunset (Austin, TX)',
      status: 'active',
      propertyId: 'prop-sunset',
    },
  ]

  it('includes residents with empty building when their unit is in the property inventory', () => {
    const residents: PropertyHealthResident[] = [
      {
        id: 'r1',
        fullName: 'Alex Tenant',
        unit: '101',
        building: '',
        status: 'active',
      },
    ]

    const scoped = filterResidentsForPropertyScope(
      residents,
      'Sunset',
      sunsetProperty,
      units,
    )
    expect(scoped.map((row) => row.id)).toEqual(['r1'])
  })

  it('includes onboarding residents when rent-roll building label drifted from the saved property name', () => {
    const residents: PropertyHealthResident[] = [
      {
        id: 'r2',
        fullName: 'Jamie Tenant',
        unit: '102',
        building: 'Sunset Apartments Rent Roll',
        status: 'active',
      },
    ]

    const scoped = filterResidentsForPropertyScope(
      residents,
      'Sunset',
      sunsetProperty,
      units,
    )
    expect(scoped.map((row) => row.id)).toEqual(['r2'])
  })

  it('excludes residents on the same unit number at a different property', () => {
    const otherProperty: PropertyHealthCanonicalProperty = {
      id: 'prop-oak',
      name: 'Oak Court',
    }
    const portfolioUnits: PropertyHealthUnit[] = [
      ...units,
      {
        id: 'u101-oak',
        unitLabel: '101',
        building: 'Oak Court',
        status: 'active',
        propertyId: 'prop-oak',
      },
    ]
    const residents: PropertyHealthResident[] = [
      {
        id: 'r-oak',
        fullName: 'Oak Resident',
        unit: '101',
        building: 'Oak Court',
        status: 'active',
      },
    ]

    const scoped = filterResidentsForPropertyScope(
      residents,
      'Sunset',
      sunsetProperty,
      portfolioUnits,
    )
    expect(scoped).toEqual([])
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

describe('filterUnitsForPropertyDetailScope', () => {
  it('dedupes duplicate unit labels across legacy building aliases', () => {
    const units: PropertyHealthUnit[] = [
      {
        id: 'u-sunset',
        unitLabel: '101',
        building: 'Sunset',
        status: 'active',
        propertyId: 'prop-sunset',
      },
      {
        id: 'u-legacy',
        unitLabel: '101',
        building: 'Sunset (Austin, TX)',
        status: 'vacant',
        propertyId: 'prop-sunset',
      },
      {
        id: 'u-102',
        unitLabel: '102',
        building: 'Sunset (Austin, TX)',
        status: 'active',
        propertyId: 'prop-sunset',
      },
    ]

    const scoped = filterUnitsForPropertyDetailScope(units, 'Sunset', sunsetProperty)
    expect(scoped).toHaveLength(2)
    expect(scoped.map((unit) => unit.unitLabel).sort()).toEqual(['101', '102'])
    expect(scoped.find((unit) => unit.unitLabel === '101')?.building).toBe('Sunset')
  })

  it('prefers canonical building label when deduping', () => {
    const deduped = dedupePropertyUnitsByLabel(
      [
        {
          id: 'legacy',
          unitLabel: '4B',
          building: 'Oak (Denver, CO)',
        },
        {
          id: 'canonical',
          unitLabel: '4B',
          building: 'Oak',
        },
      ],
      'Oak',
    )
    expect(deduped).toHaveLength(1)
    expect(deduped[0]?.id).toBe('canonical')
  })
})

describe('countDistinctPortfolioUnits', () => {
  it('counts Unit 4B and 4-B once per building', () => {
    expect(
      countDistinctPortfolioUnits([
        { unitLabel: 'Unit 4B', building: 'Maple Court' },
        { unitLabel: '4-B', building: 'Maple Court' },
        { unitLabel: '4B', building: 'Oak House' },
      ]),
    ).toBe(2)
  })
})
