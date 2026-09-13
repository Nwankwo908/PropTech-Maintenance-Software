import { describe, expect, it } from 'vitest'
import { buildPropertyResidentCards } from './propertyResidentCards'

describe('buildPropertyResidentCards', () => {
  it('merges co-tenants on the same unit into one card', () => {
    const cards = buildPropertyResidentCards('109 S Grove St', [
      {
        id: 'b',
        fullName: 'Jordan Lee',
        unit: 'Unit 1',
        building: '109 S Grove St',
        status: 'active',
        balanceDue: 0,
        leaseEndDate: '2026-08-31',
      },
      {
        id: 'a',
        fullName: 'Adrian Antonio Ruiz Trelles',
        unit: '1',
        building: '109 S Grove St',
        status: 'active',
        balanceDue: 1200,
        leaseEndDate: '2026-08-31',
      },
      {
        id: 'c',
        fullName: 'Sam Park',
        unit: '2',
        building: '109 S Grove St',
        status: 'active',
        balanceDue: 0,
        leaseEndDate: null,
      },
    ])

    expect(cards).toHaveLength(2)
    expect(cards[0]?.name).toBe('Adrian Antonio Ruiz Trelles, Jordan Lee')
    expect(cards[0]?.unitDisplay).toBe('Unit 1')
    expect(cards[1]?.name).toBe('Sam Park')
  })
})
