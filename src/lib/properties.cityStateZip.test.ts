import { describe, expect, it } from 'vitest'
import { cityStateZipForBuildingName, propertyRecordToCityStateZip, type PropertyRecord } from './properties'

const grove: PropertyRecord = {
  id: 'p1',
  landlordId: 'l1',
  name: 'Grove',
  streetAddress: '109 S Grove St',
  city: 'Newark',
  state: 'NJ',
  zipCode: '07112',
  propertyType: null,
  managerName: null,
  managerPhone: null,
  unitCount: null,
  yearBuilt: null,
}

describe('propertyRecordToCityStateZip', () => {
  it('returns City, State ZIP with no street', () => {
    expect(propertyRecordToCityStateZip(grove)).toBe('Newark, NJ 07112')
  })
})

describe('cityStateZipForBuildingName', () => {
  it('matches property name or street without returning the address', () => {
    expect(cityStateZipForBuildingName([grove], 'Grove')).toBe('Newark, NJ 07112')
    expect(cityStateZipForBuildingName([grove], '109 S Grove St')).toBe('Newark, NJ 07112')
  })
})
