import { describe, expect, it } from 'vitest'
import { streetViewLookups } from '@/components/PropertyHomeStreetView'

describe('streetViewLookups', () => {
  it('tries the street address before coordinates', () => {
    expect(
      streetViewLookups('12 Jones St, Newark, NJ', 'Maple Heights', 40.7357, -74.1724),
    ).toEqual([
      '12 Jones St, Newark, NJ',
      'Maple Heights, 12 Jones St, Newark, NJ',
      '40.7357,-74.1724',
    ])
  })
})
