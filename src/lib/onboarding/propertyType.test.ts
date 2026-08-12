import { describe, expect, it } from 'vitest'
import {
  FAST_TRACK_DEFAULT_PROPERTY_TYPE,
  inferOnboardingPropertyTypeFromUnitCount,
  resolveOnboardingPropertyType,
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

describe('inferOnboardingPropertyTypeFromUnitCount', () => {
  it('uses single family for one unit and multifamily for two or more', () => {
    expect(inferOnboardingPropertyTypeFromUnitCount(0)).toBe(FAST_TRACK_DEFAULT_PROPERTY_TYPE)
    expect(inferOnboardingPropertyTypeFromUnitCount(1)).toBe(FAST_TRACK_DEFAULT_PROPERTY_TYPE)
    expect(inferOnboardingPropertyTypeFromUnitCount(2)).toBe('multifamily')
  })
})
