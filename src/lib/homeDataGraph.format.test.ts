import { describe, expect, it } from 'vitest'
import {
  formatHomeDataGarage,
  formatHomeDataHvac,
  formatHomeDataRange,
  formatHomeDataRent,
  formatHomeDataValue,
  homeDataHasFacts,
  isHomeDataStale,
  emptyHomeDataFacts,
  homeDataNeedsProviderRefresh,
  parseHomeDataProviderId,
} from '@shared/homeDataGraph'

describe('homeDataGraph', () => {
  it('treats missing fetch time as stale', () => {
    expect(isHomeDataStale(null)).toBe(true)
    expect(isHomeDataStale(new Date().toISOString())).toBe(false)
  })

  it('formats garage, hvac, and value without provider jargon', () => {
    const facts = {
      ...emptyHomeDataFacts(),
      estimatedValue: 500000,
      estimatedValueLow: 470000,
      estimatedValueHigh: 530000,
      hasGarage: true,
      garageSpaces: 2,
      garageType: 'Attached',
      heating: 'Forced Air',
      cooling: 'Central',
    }
    expect(homeDataHasFacts(facts)).toBe(true)
    expect(formatHomeDataGarage(facts)).toContain('2')
    expect(formatHomeDataHvac(facts.heating, facts.cooling)).toContain('Forced Air')
    expect(formatHomeDataValue(facts)).toContain('500')
    expect(formatHomeDataRent({ ...facts, estimatedRent: 2400, estimatedRentLow: 2200, estimatedRentHigh: 2600 })).toMatch(/\/mo/)
    expect(formatHomeDataRange(470000, 530000)).toMatch(/470/)
  })

  it('does not treat empty photo lists as facts, and refreshes until visuals exist', () => {
    const empty = emptyHomeDataFacts()
    expect(homeDataHasFacts(empty)).toBe(false)
    expect(homeDataNeedsProviderRefresh(null)).toBe(true)
    const withFacts = {
      ...emptyHomeDataFacts(),
      propertyId: 'p1',
      landlordId: 'l1',
      sourceProvider: 'manual',
      sourceRecordId: null,
      fetchedAt: new Date().toISOString(),
      rentLookupComplete: false,
      bedrooms: 3,
    }
    expect(homeDataNeedsProviderRefresh(withFacts)).toBe(true)
    expect(
      homeDataNeedsProviderRefresh({
        ...withFacts,
        latitude: 40.7,
        longitude: -74.1,
      }),
    ).toBe(true)
    expect(
      homeDataNeedsProviderRefresh({
        ...withFacts,
        latitude: 40.7,
        longitude: -74.1,
        rentLookupComplete: true,
      }),
    ).toBe(false)
    expect(
      homeDataNeedsProviderRefresh({
        ...withFacts,
        bedrooms: null,
        latitude: 40.7,
        longitude: -74.1,
        rentLookupComplete: true,
      }),
    ).toBe(true)
  })

  it('treats unknown provider ids as the default adapter without leaking vendor columns', () => {
    expect(parseHomeDataProviderId('ulo')).toBe('ulo')
    expect(parseHomeDataProviderId('ATTOM')).toBe('attom')
    expect(parseHomeDataProviderId('manual')).toBe('manual')
    expect(parseHomeDataProviderId('rentcast')).toBe('rentcast')
    expect(parseHomeDataProviderId('nope')).toBe('ulo')
  })
})
