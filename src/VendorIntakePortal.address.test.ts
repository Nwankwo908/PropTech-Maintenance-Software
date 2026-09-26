import { describe, expect, it } from 'vitest'
import { parseCenterAddress } from './VendorIntakePortal'

describe('parseCenterAddress', () => {
  it('parses City, ST ZIP', () => {
    expect(parseCenterAddress('Chicago, IL 60614')).toEqual({
      city: 'Chicago',
      state: 'IL',
      zip: '60614',
    })
  })

  it('parses City ST without comma', () => {
    expect(parseCenterAddress('Atlanta GA')).toEqual({
      city: 'Atlanta',
      state: 'GA',
      zip: '',
    })
  })
})
