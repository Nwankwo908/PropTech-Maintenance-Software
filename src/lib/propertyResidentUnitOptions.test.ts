import { describe, expect, it } from 'vitest'
import {
  buildPropertyResidentUnitOptions,
  resolveInventoryUnitForResidentSave,
} from './propertyResidentUnitOptions'

describe('resolveInventoryUnitForResidentSave', () => {
  const units = [
    { id: 'unit-101', unitLabel: '101', building: 'Maple Court' },
    { id: 'unit-102', unitLabel: '102', building: null },
  ]

  it('reuses the inventory row when the assignment building matches', () => {
    expect(
      resolveInventoryUnitForResidentSave(units, { unit: '101', building: 'Maple Court' }),
    ).toEqual({
      unitLabel: '101',
      building: 'Maple Court',
      unitId: 'unit-101',
    })
  })

  it('does not invent a second unit when the tenant building is the property name and inventory building is empty', () => {
    expect(
      resolveInventoryUnitForResidentSave(units, { unit: '102', building: 'Maple Court' }),
    ).toEqual({
      unitLabel: '102',
      building: 'Maple Court',
      unitId: 'unit-102',
    })
  })
})

describe('buildPropertyResidentUnitOptions', () => {
  it('keys options to the inventory building so save can look up the existing row', () => {
    const options = buildPropertyResidentUnitOptions({
      building: 'Maple Court',
      units: [{ id: 'unit-101', unitLabel: '101', building: 'Maple Court' }],
      residents: [],
      editingResidentId: null,
    })
    expect(options.some((option) => option.value.includes('101'))).toBe(true)
  })
})
