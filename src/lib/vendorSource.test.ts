import { describe, expect, it } from 'vitest'
import {
  vendorBlockedFromAutoAssignBySettings,
  vendorSourceLabel,
} from './vendorSource'

describe('vendorSourceLabel', () => {
  it('labels preferred-network vendors', () => {
    expect(vendorSourceLabel(false)).toBe('Preferred')
  })

  it('labels externally discovered vendors', () => {
    expect(vendorSourceLabel(true)).toBe('External')
  })
})

describe('vendorBlockedFromAutoAssignBySettings', () => {
  it('blocks external vendors when the pool is Ulo-vetted only', () => {
    expect(
      vendorBlockedFromAutoAssignBySettings({
        onboardedFromExternal: true,
        marketplacePreference: 'ulo_vetted_only',
      }),
    ).toBe(true)
  })

  it('allows external vendors when imported vendors are included', () => {
    expect(
      vendorBlockedFromAutoAssignBySettings({
        onboardedFromExternal: true,
        marketplacePreference: 'include_imported',
      }),
    ).toBe(false)
  })

  it('never blocks preferred-network vendors', () => {
    expect(
      vendorBlockedFromAutoAssignBySettings({
        onboardedFromExternal: false,
        marketplacePreference: 'ulo_vetted_only',
      }),
    ).toBe(false)
  })
})
