import { describe, expect, it } from 'vitest'
import {
  buildPropertyHealthReport,
  computeGridOccupancyForBuilding,
  computeOccupancyStats,
  type PropertyHealthCanonicalProperty,
  type PropertyHealthUnit,
} from '@/lib/propertyHealth'

function unit(
  partial: Pick<PropertyHealthUnit, 'id' | 'unitLabel' | 'building' | 'status'> &
    Partial<PropertyHealthUnit>,
): PropertyHealthUnit {
  return {
    propertyId: partial.propertyId ?? null,
    ...partial,
  }
}

describe('computeOccupancyStats', () => {
  it('counts vacant and pending-setup units in the denominator', () => {
    const units: PropertyHealthUnit[] = [
      unit({ id: 'a1', unitLabel: '1', building: 'Grove', status: 'active', propertyId: 'p-grove' }),
      unit({ id: 'a2', unitLabel: '2', building: 'Grove', status: 'inactive', propertyId: 'p-grove' }),
      unit({ id: 'b1', unitLabel: '1', building: 'Maple', status: 'vacant', propertyId: 'p-maple' }),
      unit({ id: 'b2', unitLabel: '2', building: 'Maple', status: 'inactive', propertyId: 'p-maple' }),
      unit({ id: 'c1', unitLabel: '1', building: 'Oak', status: 'active', propertyId: 'p-oak' }),
      unit({ id: 'c2', unitLabel: '2', building: 'Oak', status: 'active', propertyId: 'p-oak' }),
      unit({ id: 'c3', unitLabel: '3', building: 'Oak', status: 'active', propertyId: 'p-oak' }),
      unit({ id: 'c4', unitLabel: '4', building: 'Oak', status: 'vacant', propertyId: 'p-oak' }),
    ]

    expect(computeOccupancyStats(units)).toEqual({
      occupied: 4,
      tracked: 8,
      occupancyPct: 50,
    })
  })

  it('does not treat a 1-occupied / 1-pending property as 100%', () => {
    const units: PropertyHealthUnit[] = [
      unit({ id: 'a1', unitLabel: 'A', building: 'Grove', status: 'active' }),
      unit({ id: 'a2', unitLabel: 'B', building: 'Grove', status: 'inactive' }),
    ]
    expect(computeOccupancyStats(units, [], 'Grove')).toEqual({
      occupied: 1,
      tracked: 2,
      occupancyPct: 50,
    })
  })
})

describe('computeGridOccupancyForBuilding', () => {
  const grove: PropertyHealthCanonicalProperty = { id: 'p-grove', name: 'Grove' }

  it('uses the same inventory as the property card unit count', () => {
    const units: PropertyHealthUnit[] = [
      unit({ id: 'a1', unitLabel: 'A', building: 'Grove', status: 'active', propertyId: 'p-grove' }),
      unit({ id: 'a2', unitLabel: 'B', building: 'Grove', status: 'inactive', propertyId: 'p-grove' }),
    ]
    expect(computeGridOccupancyForBuilding(units, [], 'Grove', grove)).toEqual({
      occupied: 1,
      tracked: 2,
      occupancyPct: 50,
    })
  })
})

describe('property card occupancy vs portfolio average', () => {
  it('shows 0% on empty properties and averages them into the KPI', () => {
    const grove: PropertyHealthCanonicalProperty = { id: 'p-grove', name: 'Grove' }
    const maple: PropertyHealthCanonicalProperty = { id: 'p-maple', name: 'Maple' }
    const oak: PropertyHealthCanonicalProperty = { id: 'p-oak', name: 'Oak' }

    const units: PropertyHealthUnit[] = [
      unit({ id: 'g1', unitLabel: 'A', building: 'Grove', status: 'active', propertyId: 'p-grove' }),
      unit({ id: 'g2', unitLabel: 'B', building: 'Grove', status: 'inactive', propertyId: 'p-grove' }),
      unit({ id: 'm1', unitLabel: '1', building: 'Maple', status: 'inactive', propertyId: 'p-maple' }),
      unit({ id: 'm2', unitLabel: '2', building: 'Maple', status: 'inactive', propertyId: 'p-maple' }),
      unit({ id: 'o1', unitLabel: '1', building: 'Oak', status: 'active', propertyId: 'p-oak' }),
      unit({ id: 'o2', unitLabel: '2', building: 'Oak', status: 'active', propertyId: 'p-oak' }),
      unit({ id: 'o3', unitLabel: '3', building: 'Oak', status: 'active', propertyId: 'p-oak' }),
      unit({ id: 'o4', unitLabel: '4', building: 'Oak', status: 'vacant', propertyId: 'p-oak' }),
    ]

    const report = buildPropertyHealthReport({
      units,
      tickets: [],
      pmTasks: [],
      feedback: [],
      vendorMetrics: [],
      canonicalProperties: [grove, maple, oak],
    })

    expect(report.buildings.find((row) => row.building === 'Grove')?.occupancyPct).toBe(50)
    expect(report.buildings.find((row) => row.building === 'Maple')?.occupancyPct).toBe(0)
    expect(report.buildings.find((row) => row.building === 'Oak')?.occupancyPct).toBe(75)
    expect(computeOccupancyStats(units).occupancyPct).toBe(50)
  })
})
