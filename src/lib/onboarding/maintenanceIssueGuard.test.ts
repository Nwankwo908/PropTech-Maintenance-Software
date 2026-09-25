import { describe, expect, it } from 'vitest'
import {
  isLikelyPropertyPhotoFileName,
  looksLikePropertyFeatureNotRepair,
  shouldAutoSelectMaintenanceIssue,
} from '@shared/onboarding/maintenanceIssueGuard'

describe('looksLikePropertyFeatureNotRepair', () => {
  it('flags listing amenity labels as non-repairs', () => {
    expect(looksLikePropertyFeatureNotRepair('window')).toBe(true)
    expect(looksLikePropertyFeatureNotRepair('empty room')).toBe(true)
    expect(looksLikePropertyFeatureNotRepair('stainless steel appliances')).toBe(true)
    expect(looksLikePropertyFeatureNotRepair('wooden floor')).toBe(true)
  })

  it('keeps real defect language as repairs', () => {
    expect(looksLikePropertyFeatureNotRepair('kitchen sink leaking')).toBe(false)
    expect(looksLikePropertyFeatureNotRepair('broken window')).toBe(false)
    expect(looksLikePropertyFeatureNotRepair('water damage on ceiling')).toBe(false)
  })
})

describe('shouldAutoSelectMaintenanceIssue', () => {
  it('does not auto-select amenity labels', () => {
    expect(
      shouldAutoSelectMaintenanceIssue({ description: 'carpet', confidence: 95 }),
    ).toBe(false)
  })

  it('auto-selects confident real repairs only', () => {
    expect(
      shouldAutoSelectMaintenanceIssue({
        description: 'Kitchen faucet leaking',
        confidence: 88,
      }),
    ).toBe(true)
    expect(
      shouldAutoSelectMaintenanceIssue({
        description: 'Kitchen faucet leaking',
        confidence: 40,
      }),
    ).toBe(false)
  })
})

describe('isLikelyPropertyPhotoFileName', () => {
  it('treats bare images as property photos', () => {
    expect(isLikelyPropertyPhotoFileName('IMG_2048.jpg')).toBe(true)
    expect(isLikelyPropertyPhotoFileName('unit-living-room.png')).toBe(true)
  })

  it('keeps explicit inspection photo names as inspections', () => {
    expect(isLikelyPropertyPhotoFileName('unit-4b-inspection.jpg')).toBe(false)
    expect(isLikelyPropertyPhotoFileName('water-damage-ceiling.jpg')).toBe(false)
  })
})
