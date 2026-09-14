import { describe, expect, it } from 'vitest'
import {
  geocodablePropertyOrigin,
  haversineMiles,
  metersToMiles,
  roundMiles,
} from './haversineMiles'

describe('haversineMiles', () => {
  it('measures ~80 miles from Midtown Manhattan to Center City Philadelphia', () => {
    const miles = haversineMiles(
      { lat: 40.758, lng: -73.9855 },
      { lat: 39.9526, lng: -75.1652 },
    )
    expect(miles).toBeGreaterThan(75)
    expect(miles).toBeLessThan(90)
  })
})

describe('geocodablePropertyOrigin', () => {
  it('strips the unit suffix from a property label', () => {
    expect(geocodablePropertyOrigin('109 S Grove St, East Orange, NJ 07018 · Unit 4B')).toBe(
      '109 S Grove St, East Orange, NJ 07018',
    )
  })
})

describe('roundMiles', () => {
  it('converts meters to one-decimal miles', () => {
    expect(metersToMiles(95760)).toBe(59.5)
    expect(roundMiles(59.48)).toBe(59.5)
  })
})
