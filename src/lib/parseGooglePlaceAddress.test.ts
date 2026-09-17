import { describe, expect, it } from 'vitest'
import {
  parseAddressSuggestionLabel,
  parseGooglePlaceAddress,
} from '@/lib/parseGooglePlaceAddress'

describe('parseGooglePlaceAddress', () => {
  it('fills street, city, state, and ZIP from Google place components', () => {
    expect(
      parseGooglePlaceAddress({
        address_components: [
          { long_name: '123', short_name: '123', types: ['street_number'] },
          { long_name: 'Main Street', short_name: 'Main St', types: ['route'] },
          { long_name: 'Newark', short_name: 'Newark', types: ['locality', 'political'] },
          {
            long_name: 'New Jersey',
            short_name: 'NJ',
            types: ['administrative_area_level_1', 'political'],
          },
          { long_name: '07102', short_name: '07102', types: ['postal_code'] },
        ],
      }),
    ).toEqual({
      street: '123 Main Street',
      city: 'Newark',
      state: 'NJ',
      zipCode: '07102',
    })
  })

  it('maps a full state name when the short code is missing', () => {
    expect(
      parseGooglePlaceAddress({
        address_components: [
          { long_name: 'Peachtree Street', short_name: 'Peachtree St', types: ['route'] },
          { long_name: 'Atlanta', short_name: 'Atlanta', types: ['locality', 'political'] },
          {
            long_name: 'Georgia',
            short_name: 'Georgia',
            types: ['administrative_area_level_1', 'political'],
          },
        ],
      }),
    ).toMatchObject({
      street: 'Peachtree Street',
      city: 'Atlanta',
      state: 'GA',
    })
  })

  it('returns null when there are no address components', () => {
    expect(parseGooglePlaceAddress({ name: '123 Main St' })).toBeNull()
  })
})

describe('parseAddressSuggestionLabel', () => {
  it('fills street, city, state, and ZIP from a Places suggestion', () => {
    expect(parseAddressSuggestionLabel('123 Main St, Newark, NJ 07102, USA')).toEqual({
      street: '123 Main St',
      city: 'Newark',
      state: 'NJ',
      zipCode: '07102',
    })
  })
})
