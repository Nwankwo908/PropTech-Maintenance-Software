import { describe, expect, it } from 'vitest'
import {
  FAST_TRACK_DEFAULT_PROPERTY_TYPE,
  inferOnboardingPropertyTypeFromUnitCount,
  isSingleFamilyPropertyType,
  resolveOnboardingPropertyType,
  SINGLE_FAMILY_UNIT_LABEL,
} from './propertyType'

describe('resolveOnboardingPropertyType', () => {
  it('returns default for empty or unknown values', () => {
    expect(resolveOnboardingPropertyType('')).toBe(FAST_TRACK_DEFAULT_PROPERTY_TYPE)
    expect(resolveOnboardingPropertyType(undefined)).toBe(FAST_TRACK_DEFAULT_PROPERTY_TYPE)
    expect(resolveOnboardingPropertyType('unknown type')).toBe(FAST_TRACK_DEFAULT_PROPERTY_TYPE)
  })

  it('maps canonical and label values', () => {
    expect(resolveOnboardingPropertyType('multifamily')).toBe('multifamily')
    expect(resolveOnboardingPropertyType('Single-Family Home')).toBe('single_family_home')
  })

  it('maps common GPT and spreadsheet aliases', () => {
    expect(resolveOnboardingPropertyType('Single Family')).toBe('single_family_home')
    expect(resolveOnboardingPropertyType('single_family')).toBe('single_family_home')
    expect(resolveOnboardingPropertyType('SFR')).toBe('single_family_home')
    expect(resolveOnboardingPropertyType('Apartment Building')).toBe('multifamily')
    expect(resolveOnboardingPropertyType('Duplex')).toBe('multifamily')
    expect(resolveOnboardingPropertyType('Condo / Co-op')).toBe('condo')
    expect(resolveOnboardingPropertyType('Mixed Use Retail')).toBe('commercial')
  })
})

describe('isSingleFamilyPropertyType', () => {
  it('recognizes single-family aliases and rejects empty/multifamily', () => {
    expect(isSingleFamilyPropertyType('single_family')).toBe(true)
    expect(isSingleFamilyPropertyType('single_family_home')).toBe(true)
    expect(isSingleFamilyPropertyType('SFR')).toBe(true)
    expect(isSingleFamilyPropertyType('')).toBe(false)
    expect(isSingleFamilyPropertyType(null)).toBe(false)
    expect(isSingleFamilyPropertyType('multifamily')).toBe(false)
  })

  it('exposes a non-numeric inventory label constant', () => {
    expect(SINGLE_FAMILY_UNIT_LABEL).toBe('Home')
    expect(/\d/.test(SINGLE_FAMILY_UNIT_LABEL)).toBe(false)
  })
})

describe('inferOnboardingPropertyTypeFromUnitCount', () => {
  it('uses single family for one unit and multifamily for two or more', () => {
    expect(inferOnboardingPropertyTypeFromUnitCount(0)).toBe(FAST_TRACK_DEFAULT_PROPERTY_TYPE)
    expect(inferOnboardingPropertyTypeFromUnitCount(1)).toBe(FAST_TRACK_DEFAULT_PROPERTY_TYPE)
    expect(inferOnboardingPropertyTypeFromUnitCount(2)).toBe('multifamily')
  })
})
