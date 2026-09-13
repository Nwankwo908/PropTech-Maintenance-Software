import { describe, expect, it } from 'vitest'
import {
  buildPropertyResidentUnitOptions,
  residentPlacementUpdateForSave,
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

  it('keeps the tenant’s current unit selectable when inventory building text differs', () => {
    const options = buildPropertyResidentUnitOptions({
      building: '123 Maple Court',
      units: [{ id: 'unit-4b', unitLabel: '4B', building: 'Building A' }],
      residents: [
        {
          id: 'res-1',
          unit: '4B',
          building: '123 Maple Court',
          status: 'active',
        },
      ],
      editingResidentId: 'res-1',
    })
    expect(options.some((option) => option.label.includes('current'))).toBe(true)
    expect(options.some((option) => option.value === '')).toBe(true)
  })
})

describe('residentPlacementUpdateForSave', () => {
  const units = [{ id: 'unit-1', unitLabel: '1', building: '109 S Grove St' }]

  it('omits unit and building when contact fields change and the unit dropdown was not touched', () => {
    expect(
      residentPlacementUpdateForSave({
        unitAssignmentChanged: false,
        submittedUnitKey: '',
        previousUnit: '1',
        previousBuilding: '109 S Grove St',
        units,
      }),
    ).toBeUndefined()
  })

  it('keeps the stored address when a new unit option has an empty building', () => {
    expect(
      residentPlacementUpdateForSave({
        unitAssignmentChanged: true,
        submittedUnitKey: '__pick:1:',
        previousUnit: '1',
        previousBuilding: '109 S Grove St',
        units: [{ id: 'unit-1', unitLabel: '1', building: null }],
        fallbackBuilding: '109 S Grove St',
      }),
    ).toEqual({ unit: '1', building: '109 S Grove St' })
  })
})
