import { describe, expect, it } from 'vitest'
import {
  formatSteadilyPremium,
  steadilyQuoteAddressFromBuilding,
  steadilyQuoteAddressFromParts,
} from './steadilyPartner'

describe('steadilyQuoteAddressFromBuilding', () => {
  it('splits a full US mailing line for the quote widget', () => {
    expect(
      steadilyQuoteAddressFromBuilding('563 Springdale Cir, Palm Springs, FL 33461', 1980),
    ).toEqual({
      streetAddress: '563 Springdale Cir',
      city: 'Palm Springs',
      state: 'FL',
      zipCode: '33461',
      yearBuilt: 1980,
    })
  })
})

describe('steadilyQuoteAddressFromParts', () => {
  it('fills city, state, and zip from the property record when the name is only the street', () => {
    expect(
      steadilyQuoteAddressFromParts({
        building: '563 Springdale Cir',
        streetAddress: '563 Springdale Cir',
        city: 'Palm Springs',
        state: 'FL',
        zipCode: '33461',
        yearBuilt: 1980,
      }),
    ).toEqual({
      streetAddress: '563 Springdale Cir',
      city: 'Palm Springs',
      state: 'FL',
      zipCode: '33461',
      yearBuilt: 1980,
    })
  })
})

describe('steadilyQuoteAddressFromBuilding', () => {
  it('splits a full US mailing line for the quote widget', () => {
    expect(
      steadilyQuoteAddressFromBuilding('563 Springdale Cir, Palm Springs, FL 33461', 1980),
    ).toEqual({
      streetAddress: '563 Springdale Cir',
      city: 'Palm Springs',
      state: 'FL',
      zipCode: '33461',
      yearBuilt: 1980,
    })
  })
})

describe('formatSteadilyPremium', () => {
  it('formats whole-dollar estimates like the quote card', () => {
    expect(formatSteadilyPremium(544500)).toBe('$544,500')
  })
})
