import { describe, expect, it } from 'vitest'
import {
  displayResidentEmail,
  groupResidentsByLeasePlace,
  otherOccupantsOnSamePlace,
  residentEmailPatchForSave,
  residentPlaceLabel,
  buildResidentProfileDetail,
} from './residentProfileDetail'

describe('residentEmailPatchForSave', () => {
  it('omits email when the form still shows the stored address', () => {
    expect(residentEmailPatchForSave('ada@example.com', 'ada@example.com')).toBeUndefined()
    expect(residentEmailPatchForSave('  ada@example.com  ', 'ada@example.com')).toBeUndefined()
  })

  it('omits email when the field is blank and the row has no real email', () => {
    expect(residentEmailPatchForSave('', '')).toBeUndefined()
    expect(residentEmailPatchForSave('', 'res-1@onboarding.local')).toBeUndefined()
    expect(residentEmailPatchForSave('', null)).toBeUndefined()
  })

  it('sends a newly entered or cleared address', () => {
    expect(residentEmailPatchForSave('new@example.com', 'old@example.com')).toBe('new@example.com')
    expect(residentEmailPatchForSave('', 'old@example.com')).toBe('')
    expect(residentEmailPatchForSave('ada@example.com', '')).toBe('ada@example.com')
  })
})

describe('displayResidentEmail', () => {
  it('hides onboarding placeholder addresses', () => {
    expect(displayResidentEmail('res-1@onboarding.local')).toBeNull()
    expect(displayResidentEmail('ada@example.com')).toBe('ada@example.com')
  })
})

describe('residentPlaceLabel', () => {
  it('uses Address when the property is missing or the Portfolio placeholder', () => {
    expect(residentPlaceLabel('')).toBe('Address')
    expect(residentPlaceLabel('  ')).toBe('Address')
    expect(residentPlaceLabel('Portfolio')).toBe('Address')
    expect(residentPlaceLabel(null)).toBe('Address')
  })

  it('keeps a real property name', () => {
    expect(residentPlaceLabel('Maple Court Apartments')).toBe('Maple Court')
  })
})

describe('otherOccupantsOnSamePlace', () => {
  const adrian = {
    id: 'a',
    fullName: 'Adrian Antonio Ruiz Trelles',
    unit: '1',
    building: '109 S Grove St',
    status: 'active',
  }
  const roommate = {
    id: 'b',
    fullName: 'Jordan Lee',
    unit: 'Unit 1',
    building: '109 S Grove St',
    status: 'active',
  }

  it('lists other current residents on the same unit and property', () => {
    expect(
      otherOccupantsOnSamePlace({
        residentId: 'a',
        unit: '1',
        building: '109 S Grove St',
        residents: [adrian, roommate],
      }),
    ).toEqual([{ id: 'b', name: 'Jordan Lee' }])
  })

  it('does not list someone on a different unit or property', () => {
    expect(
      otherOccupantsOnSamePlace({
        residentId: 'a',
        unit: '1',
        building: '109 S Grove St',
        residents: [
          adrian,
          { ...roommate, id: 'c', unit: '2' },
          { ...roommate, id: 'd', building: '200 Oak Ave' },
          { ...roommate, id: 'e', status: 'past_resident' },
        ],
      }),
    ).toEqual([])
  })
})

describe('groupResidentsByLeasePlace', () => {
  const adrian = {
    id: 'a',
    fullName: 'Adrian Antonio Ruiz Trelles',
    unit: '1',
    building: '109 S Grove St',
    status: 'active',
  }
  const roommate = {
    id: 'b',
    fullName: 'Jordan Lee',
    unit: 'Unit 1',
    building: '109 S Grove St',
    status: 'active',
  }

  it('merges current residents on the same property and unit', () => {
    const groups = groupResidentsByLeasePlace([
      roommate,
      adrian,
      { ...roommate, id: 'c', fullName: 'Sam Park', unit: '2' },
    ])
    expect(groups).toHaveLength(2)
    expect(groups[0]?.map((row) => row.id)).toEqual(['a', 'b'])
    expect(groups[1]?.map((row) => row.id)).toEqual(['c'])
  })

  it('keeps different properties and past residents separate', () => {
    const groups = groupResidentsByLeasePlace([
      adrian,
      { ...roommate, id: 'd', building: '200 Oak Ave' },
      { ...roommate, id: 'e', status: 'past_resident' },
    ])
    expect(groups.map((group) => group.map((row) => row.id))).toEqual([['a'], ['d']])
  })

  it('does not merge people who have no unit', () => {
    const groups = groupResidentsByLeasePlace([
      { id: 'x', fullName: 'Alex', unit: '', building: '109 S Grove St', status: 'active' },
      { id: 'y', fullName: 'Blair', unit: '', building: '109 S Grove St', status: 'active' },
    ])
    expect(groups).toHaveLength(2)
  })
})

describe('buildResidentProfileDetail', () => {
  it('shows onboarding rent due on the resident profile', () => {
    const profile = buildResidentProfileDetail({
      user: {
        id: 'res-1',
        fullName: 'Jamie Tenant',
        email: 'jamie@example.com',
        phone: null,
        unit: '101',
        building: 'Maple Court',
        status: 'active',
        balanceDue: 0,
        leaseStartDate: '2026-01-01',
        leaseEndDate: '2026-12-31',
        rentDueDay: 1,
        monthlyRent: 1850,
      },
      workflowData: null,
    })
    expect(profile.rentDueDay).toBe(1)
    expect(profile.rentDueDayLabel).toBe('1st')
    expect(profile.monthlyRentLabel).toContain('1,850')
  })

  it('shows an em dash when rent due was not collected', () => {
    const profile = buildResidentProfileDetail({
      user: {
        id: 'res-2',
        fullName: 'Alex Renter',
        email: '',
        phone: null,
        unit: '102',
        building: 'Maple Court',
        status: 'active',
        balanceDue: 0,
        leaseEndDate: null,
        rentDueDay: null,
      },
      workflowData: null,
    })
    expect(profile.rentDueDay).toBeNull()
    expect(profile.rentDueDayLabel).toBe('—')
  })
})
