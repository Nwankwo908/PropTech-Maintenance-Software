import { describe, expect, it } from 'vitest'
import { buildPropertyUnitRows, propertyUnitColumnLabel } from './propertyUnitRows'
import {
  correctedPropertyTypeForPlace,
  correctedPropertyTypeFromLabels,
  propertyTypeCorrectionsFromInventory,
} from './propertyInventoryType'

const grove = {
  id: 'grove',
  name: '109 S Grove St',
  streetAddress: '109 S Grove St',
  propertyType: 'single_family_home',
}

describe('property inventory type', () => {
  it('treats two real units on a single-family record as multifamily', () => {
    expect(correctedPropertyTypeFromLabels('single_family_home', ['A', 'B'])).toBe('multifamily')
    expect(correctedPropertyTypeFromLabels('SFR', ['A', 'B'])).toBe('multifamily')
    expect(correctedPropertyTypeFromLabels(null, ['A', 'B'])).toBe('multifamily')
    expect(propertyUnitColumnLabel('A', 'multifamily')).toBe('Unit A')
    expect(propertyUnitColumnLabel('B', 'multifamily')).toBe('Unit B')
  })

  it('keeps a house when two residents share one home', () => {
    expect(correctedPropertyTypeFromLabels('single_family_home', ['1', 'Home', '', 'Unit 1'])).toBe(
      'single_family_home',
    )
    const corrections = propertyTypeCorrectionsFromInventory({
      properties: [grove],
      units: [{ propertyId: grove.id, building: grove.name, unitLabel: '1' }],
      residents: [
        { building: grove.name, unit: '1', status: 'active' },
        { building: grove.name, unit: 'Home', status: 'active' },
      ],
    })
    expect(corrections).toEqual([])
  })

  it('does not overwrite condo, townhouse, or commercial', () => {
    expect(correctedPropertyTypeFromLabels('condo', ['A', 'B'])).toBe('condo')
    expect(correctedPropertyTypeFromLabels('townhouse', ['A', 'B'])).toBe('townhouse')
    expect(correctedPropertyTypeFromLabels('commercial', ['A', 'B'])).toBe('commercial')
  })

  it('corrects 109 S Grove St from units A and B and two residents', () => {
    const corrections = propertyTypeCorrectionsFromInventory({
      properties: [grove],
      units: [
        { propertyId: grove.id, building: grove.name, unitLabel: 'A' },
        { propertyId: grove.id, building: grove.name, unitLabel: 'B' },
      ],
      residents: [
        { building: grove.name, unit: 'A', status: 'active' },
        { building: grove.name, unit: 'B', status: 'active' },
      ],
    })
    expect(corrections).toEqual([
      {
        propertyId: 'grove',
        propertyName: '109 S Grove St',
        streetAddress: '109 S Grove St',
        storedType: 'single_family_home',
        propertyType: 'multifamily',
        unitCount: 2,
        unitLabels: ['A', 'B'],
      },
    ])
    expect(
      correctedPropertyTypeForPlace(corrections, {
        building: '109 S Grove St',
        storedType: 'single_family_home',
      }),
    ).toBe('multifamily')
  })

  it('shows unit A and B on the property units table when the stored type is single-family', () => {
    const rows = buildPropertyUnitRows({
      building: grove.name,
      propertyId: grove.id,
      propertyType: 'single_family_home',
      units: [
        { id: 'a', unitLabel: 'A', building: grove.name, status: 'active' },
        { id: 'b', unitLabel: 'B', building: grove.name, status: 'active' },
      ],
      residents: [
        {
          id: 'r1',
          fullName: 'Saad Iqbal',
          unit: 'A',
          building: grove.name,
          status: 'active',
          balanceDue: 0,
          leaseEndDate: null,
        },
        {
          id: 'r2',
          fullName: 'Ikea Vandross',
          unit: 'B',
          building: grove.name,
          status: 'active',
          balanceDue: 0,
          leaseEndDate: null,
        },
      ],
      tickets: [],
      workflowData: null,
    })
    expect(rows.map((row) => row.unitDisplay)).toEqual(['Unit A', 'Unit B'])
  })
})
