import { describe, expect, it } from 'vitest'
import {
  isSingleFamilyPropertyType,
  resolveCanonicalPropertyType,
  SINGLE_FAMILY_UNIT_LABEL,
} from './propertyType'
import {
  formatBareUnitLabel,
  formatInUnitPhrase,
  formatLocationWithOptionalUnit,
  formatUnitReference,
  shouldOmitUnitReference,
} from './unitLabelDisplay'

describe('shared propertyType — single-family', () => {
  it('detects aliases and rejects empty/multifamily', () => {
    expect(isSingleFamilyPropertyType('single_family')).toBe(true)
    expect(isSingleFamilyPropertyType('single_family_home')).toBe(true)
    expect(isSingleFamilyPropertyType('SFR')).toBe(true)
    expect(isSingleFamilyPropertyType('')).toBe(false)
    expect(isSingleFamilyPropertyType(null)).toBe(false)
    expect(isSingleFamilyPropertyType('multifamily')).toBe(false)
    expect(resolveCanonicalPropertyType('single_family')).toBe('single_family_home')
  })

  it('uses a non-numeric inventory sentinel', () => {
    expect(SINGLE_FAMILY_UNIT_LABEL).toBe('Home')
    expect(/\d/.test(SINGLE_FAMILY_UNIT_LABEL)).toBe(false)
  })
})

describe('shared unitLabelDisplay', () => {
  it('omits unit for single-family in outbound-style formatting', () => {
    expect(formatUnitReference('1', 'single_family')).toBe('')
    expect(formatUnitReference('Unit 1', 'single_family_home')).toBe('')
    expect(formatUnitReference(SINGLE_FAMILY_UNIT_LABEL)).toBe('')
    expect(
      formatLocationWithOptionalUnit({
        propertyLabel: '14 Maple Ave',
        unitLabel: '1',
        propertyType: 'single_family',
      }),
    ).toBe('14 Maple Ave')
    expect(shouldOmitUnitReference({ propertyType: 'single_family', unitLabel: '1' })).toBe(true)
  })

  it('keeps multifamily unit references', () => {
    expect(formatUnitReference('1', 'multifamily')).toBe('Unit 1')
    expect(formatUnitReference('2B')).toBe('Unit 2B')
    expect(
      formatLocationWithOptionalUnit({
        propertyLabel: 'Maple Court',
        unitLabel: '204',
        propertyType: 'multifamily',
      }),
    ).toBe('Maple Court · Unit 204')
  })

  it('builds in-unit phrases and bare labels for SMS lines', () => {
    expect(formatInUnitPhrase('3A')).toBe(' in Unit 3A')
    expect(formatInUnitPhrase('1', 'single_family')).toBe('')
    expect(formatBareUnitLabel('3A')).toBe('3A')
    expect(formatBareUnitLabel('Unit 3A')).toBe('3A')
    expect(formatBareUnitLabel('1', 'single_family_home')).toBe('')
  })
})
