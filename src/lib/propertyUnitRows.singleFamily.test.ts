import { describe, expect, it } from 'vitest'
import { SINGLE_FAMILY_UNIT_LABEL } from '@shared/properties/propertyType'
import { formatUnitReference } from '@shared/properties/unitLabelDisplay'
import { formatPropertyUnitDisplay } from './propertyUnitRows'
import { buildUnitOptionsFromPropertyPayload, unitOptionKeyToCell } from './residentUnitKeys'

describe('single-family unit numbers', () => {
  it('does not display unit numbers for single-family properties', () => {
    expect(formatPropertyUnitDisplay('1', 'single_family')).toBe('')
    expect(formatPropertyUnitDisplay('Unit 1', 'single_family_home')).toBe('')
    expect(formatPropertyUnitDisplay('101', 'SFR')).toBe('')
    expect(formatPropertyUnitDisplay(SINGLE_FAMILY_UNIT_LABEL)).toBe('')
    expect(formatUnitReference('1', 'single_family')).toBe('')
  })

  it('still formats multifamily unit numbers', () => {
    expect(formatPropertyUnitDisplay('1', 'multifamily')).toBe('Unit 1')
    expect(formatPropertyUnitDisplay('Unit 2B')).toBe('Unit 2B')
  })

  it('registers single-family inventory without Unit 1 / Unit N labels', () => {
    const options = buildUnitOptionsFromPropertyPayload({
      propertyName: '14 Maple Ave',
      city: 'Baltimore',
      state: 'MD',
      totalUnits: '1',
      propertyType: 'single_family',
    })
    expect(options).toHaveLength(1)
    expect(options[0]?.label).toBe('14 Maple Ave')
    const cell = unitOptionKeyToCell(options[0]!.value)
    expect(cell).toEqual({
      kind: 'assigned',
      unit: SINGLE_FAMILY_UNIT_LABEL,
      building: '14 Maple Ave',
    })
    expect(cell.kind === 'assigned' && /\d/.test(cell.unit)).toBe(false)
  })

  it('still invents Unit 1…N for multifamily', () => {
    const options = buildUnitOptionsFromPropertyPayload({
      propertyName: 'Maple Court',
      city: 'Baltimore',
      state: 'MD',
      totalUnits: '2',
      propertyType: 'multifamily',
    })
    expect(options.map((o) => o.label)).toEqual([
      'Unit 1 — Maple Court',
      'Unit 2 — Maple Court',
    ])
  })
})
