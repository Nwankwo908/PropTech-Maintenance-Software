import { describe, expect, it } from 'vitest'
import {
  normalizeOnboardingStreet,
  onboardingAddressMatchKey,
  reconcilePropertiesByAddressIdentity,
} from './addressIdentity'

describe('addressIdentity', () => {
  it('normalizes street suffixes and punctuation', () => {
    expect(normalizeOnboardingStreet('123 Main Street.')).toBe('123 main st')
    expect(normalizeOnboardingStreet('123 Main St')).toBe('123 main st')
  })

  it('builds a match key only when street is present', () => {
    expect(
      onboardingAddressMatchKey({
        streetAddress: '123 Main St',
        city: 'Austin',
        state: 'tx',
        zipCode: '78701-1234',
      }),
    ).toBe('123 main st|austin|TX|78701')
    expect(onboardingAddressMatchKey({ streetAddress: '', city: 'Austin' })).toBe('')
  })

  it('merges two display names with the same verified address', () => {
    const { properties } = reconcilePropertiesByAddressIdentity([
      {
        id: 'a',
        name: 'Maple House',
        streetAddress: '14 Maple Avenue',
        city: 'Austin',
        state: 'TX',
        zipCode: '78701',
      },
      {
        id: 'b',
        name: '14 Maple Ave',
        streetAddress: '14 Maple Ave.',
        city: 'Austin',
        state: 'tx',
        zipCode: '78701',
      },
    ])
    expect(properties).toHaveLength(1)
    expect(properties[0]?.id).toBe('a')
    expect(properties[0]?.name).toBe('14 Maple Ave')
  })

  it('keeps conflicting addresses separate', () => {
    const { properties } = reconcilePropertiesByAddressIdentity([
      {
        id: 'a',
        name: 'Home',
        streetAddress: '1 Oak St',
        city: 'Austin',
        state: 'TX',
        zipCode: '78701',
      },
      {
        id: 'b',
        name: 'Home',
        streetAddress: '2 Oak St',
        city: 'Austin',
        state: 'TX',
        zipCode: '78701',
      },
    ])
    expect(properties).toHaveLength(2)
  })
})
