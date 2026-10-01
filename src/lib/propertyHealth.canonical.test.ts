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

  it('matches street-suffix aliases to the saved property name', () => {
    const unit: PropertyHealthUnit = {
      id: 'u-maple',
      unitLabel: '1',
      building: '81 Maple Street',
      status: 'inactive',
      propertyId: null,
    }
    expect(
      unitBelongsToCanonicalProperty(unit, { id: 'prop-maple', name: '81 Maple St' }),
    ).toBe(true)
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
    expect(row?.status).toBe('unknown')
    expect(row?.score).toBeNull()
    expect(row?.pendingReason).toBe('unknown_condition')
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

describe('Properties grid work-order counts', () => {
  it('attributes SMS tickets with no building to the only property', () => {
    const report = buildPropertyHealthReport({
      units: [
        {
          id: 'u1',
          unitLabel: '1',
          building: 'Sunset',
          status: 'active',
          propertyId: 'prop-sunset',
        },
      ],
      tickets: [
        {
          id: 't1',
          createdAt: '2026-09-01T00:00:00.000Z',
          unit: '1',
          unitId: null,
          building: null,
          vendorWorkStatus: 'in_progress',
        },
      ],
      pmTasks: [],
      feedback: [],
      vendorMetrics: [],
      assets: [],
      inspections: [],
      damageReports: [],
      residents: [
        {
          id: 'r1',
          fullName: 'Alex',
          unit: '1',
          building: 'Sunset',
          status: 'active',
        },
      ],
      canonicalProperties: [sunsetProperty],
      now: Date.parse('2026-09-26T00:00:00.000Z'),
    })

    expect(report.buildings).toHaveLength(1)
    expect(report.buildings[0]?.openTickets).toBe(1)
    expect(report.buildings[0]?.workOrderCount).toBe(1)
  })

  it('excludes completed and archived tickets from the Work orders column', () => {
    const report = buildPropertyHealthReport({
      units: [
        {
          id: 'u1',
          unitLabel: '1',
          building: 'Sunset',
          status: 'active',
          propertyId: 'prop-sunset',
        },
      ],
      tickets: [
        {
          id: 'open',
          createdAt: '2026-09-01T00:00:00.000Z',
          unit: '1',
          unitId: 'u1',
          building: 'Sunset',
          vendorWorkStatus: 'accepted',
        },
        {
          id: 'done',
          createdAt: '2026-09-02T00:00:00.000Z',
          unit: '1',
          unitId: 'u1',
          building: 'Sunset',
          vendorWorkStatus: 'in_progress',
          completedAt: '2026-09-20T00:00:00.000Z',
        },
        {
          id: 'archived',
          createdAt: '2026-09-03T00:00:00.000Z',
          unit: '1',
          unitId: 'u1',
          building: 'Sunset',
          vendorWorkStatus: 'archived',
        },
      ],
      pmTasks: [],
      feedback: [],
      vendorMetrics: [],
      assets: [],
      inspections: [],
      damageReports: [],
      residents: [],
      canonicalProperties: [sunsetProperty],
      now: Date.parse('2026-09-26T00:00:00.000Z'),
    })

    expect(report.buildings[0]?.openTickets).toBe(1)
    // Completed still counts as a work order; archived/cancelled do not.
    expect(report.buildings[0]?.workOrderCount).toBe(2)
  })

  it('matches tickets by property_id when building text drifted', () => {
    const report = buildPropertyHealthReport({
      units: [
        {
          id: 'u1',
          unitLabel: '2B',
          building: 'Sunset (Austin, TX)',
          status: 'active',
          propertyId: 'prop-sunset',
        },
      ],
      tickets: [
        {
          id: 't1',
          createdAt: '2026-09-01T00:00:00.000Z',
          unit: '2B',
          unitId: null,
          building: null,
          propertyId: 'prop-sunset',
          vendorWorkStatus: 'pending_accept',
        },
      ],
      pmTasks: [],
      feedback: [],
      vendorMetrics: [],
      assets: [],
      inspections: [],
      damageReports: [],
      residents: [],
      canonicalProperties: [sunsetProperty],
      now: Date.parse('2026-09-26T00:00:00.000Z'),
    })

    const row = resolveBuildingHealthRow(report, 'Sunset')
    expect(row?.openTickets).toBe(1)
    expect(row?.workOrderCount).toBe(1)
  })

  it('counts completed jobs in Work orders while Open stays separate', () => {
    const report = buildPropertyHealthReport({
      units: [
        {
          id: 'u1',
          unitLabel: '1',
          building: 'Sunset',
          status: 'active',
          propertyId: 'prop-sunset',
        },
      ],
      tickets: [
        {
          id: 'done',
          createdAt: '2026-09-02T00:00:00.000Z',
          unit: '1',
          unitId: 'u1',
          building: 'Sunset',
          vendorWorkStatus: 'completed',
          completedAt: '2026-09-20T00:00:00.000Z',
        },
      ],
      pmTasks: [],
      feedback: [],
      vendorMetrics: [],
      assets: [],
      inspections: [],
      damageReports: [],
      residents: [],
      canonicalProperties: [sunsetProperty],
      now: Date.parse('2026-09-26T00:00:00.000Z'),
    })

    expect(report.buildings[0]?.openTickets).toBe(0)
    expect(report.buildings[0]?.workOrderCount).toBe(1)
  })

  it('does not copy a work order from 35 Maple onto 33 Maple', () => {
    const prop33: PropertyHealthCanonicalProperty = {
      id: 'prop-33',
      name: '33 Maple Street',
    }
    const prop35: PropertyHealthCanonicalProperty = {
      id: 'prop-35',
      name: '35 Maple St',
    }
    const report = buildPropertyHealthReport({
      units: [
        {
          id: 'u33',
          unitLabel: '1',
          building: '33 Maple Street',
          status: 'active',
          // Shared/wrong property_id must not merge sibling addresses.
          propertyId: 'prop-35',
        },
        {
          id: 'u35',
          unitLabel: '1',
          building: '35 Maple St',
          status: 'active',
          propertyId: 'prop-35',
        },
      ],
      tickets: [
        {
          id: 'pest',
          createdAt: '2026-09-02T00:00:00.000Z',
          unit: '1',
          unitId: 'u35',
          building: '35 Maple St',
          propertyId: 'prop-35',
          vendorWorkStatus: 'completed',
          completedAt: '2026-09-20T00:00:00.000Z',
          // Same email as the resident at 33 — must not move the ticket.
          email: 'shared@example.com',
        },
      ],
      pmTasks: [],
      feedback: [],
      vendorMetrics: [],
      assets: [],
      inspections: [],
      damageReports: [],
      residents: [
        {
          id: 'r33',
          fullName: 'Resident 33',
          unit: '1',
          building: '33 Maple Street',
          status: 'active',
          email: 'shared@example.com',
        },
        {
          id: 'r35',
          fullName: 'Resident 35',
          unit: '1',
          building: '35 Maple St',
          status: 'active',
          email: 'other@example.com',
        },
      ],
      canonicalProperties: [prop33, prop35],
      now: Date.parse('2026-09-26T00:00:00.000Z'),
    })

    const row33 = resolveBuildingHealthRow(report, '33 Maple Street')
    const row35 = resolveBuildingHealthRow(report, '35 Maple St')
    expect(row33?.workOrderCount).toBe(0)
    expect(row35?.workOrderCount).toBe(1)
  })
})
