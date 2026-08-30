import { describe, expect, it } from 'vitest'
import { emptyToNull, formatVendorLocationLabel } from './vendorLocation'

describe('formatVendorLocationLabel', () => {
  it('joins city, state, and country', () => {
    expect(
      formatVendorLocationLabel({
        city: 'Atlanta',
        state: 'GA',
        country: 'United States',
      }),
    ).toBe('Atlanta, GA, United States')
  })

  it('skips empty parts', () => {
    expect(formatVendorLocationLabel({ city: 'Austin', state: '', country: '' })).toBe('Austin')
  })

  it('returns null when nothing is set', () => {
    expect(formatVendorLocationLabel({ city: '  ', state: null, country: undefined })).toBeNull()
  })
})

describe('emptyToNull', () => {
  it('trims blank strings to null', () => {
    expect(emptyToNull('  ')).toBeNull()
    expect(emptyToNull('GA')).toBe('GA')
  })
})
