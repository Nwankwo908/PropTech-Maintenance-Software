import { describe, expect, it } from 'vitest'
import {
  householdMonthlyRent,
  householdRentBillingAmounts,
} from './householdRent'

const portfolio = [
  { id: 'lamont', unit: '', building: '3100 Ellerslie Avenue', status: 'active', monthlyRent: 1501 },
  { id: 'raqwan', unit: '', building: '3100 Ellerslie Avenue', status: 'active', monthlyRent: 1501 },
  { id: 'rashea', unit: '', building: '3110 Ellerslie Ave', status: 'active', monthlyRent: 1375 },
  { id: 'tynika', unit: '', building: '725 Bartlett Ave', status: 'active', monthlyRent: 1400 },
  { id: 'dominic', unit: '', building: '725 Bartlett Ave', status: 'active', monthlyRent: 1400 },
  { id: 'chinedu', unit: '', building: '4723 Amberley Ave', status: 'active', monthlyRent: 1600 },
  { id: 'denelle', unit: '', building: '705 Bartlett Ave', status: 'active', monthlyRent: 1577 },
]

describe('householdMonthlyRent', () => {
  it('counts shared single-family rent once', () => {
    expect(householdMonthlyRent(portfolio)).toBe(1501 + 1375 + 1400 + 1600 + 1577)
    expect(portfolio.reduce((sum, row) => sum + row.monthlyRent, 0)).toBe(
      1501 + 1501 + 1375 + 1400 + 1400 + 1600 + 1577,
    )
  })

  it('keeps different units at one building as separate rents', () => {
    expect(
      householdMonthlyRent([
        { id: 'a', unit: '1', building: 'Grove Apartments', monthlyRent: 900 },
        { id: 'b', unit: '2', building: 'Grove Apartments', monthlyRent: 1100 },
      ]),
    ).toBe(2000)
  })

  it('bills one co-tenant the shared amount', () => {
    const billed = householdRentBillingAmounts([
      { id: 'lamont', unit: '', building: '3100 Ellerslie Avenue', amountDue: 1501 },
      { id: 'raqwan', unit: '', building: '3100 Ellerslie Avenue', amountDue: 1501 },
      { id: 'tynika', unit: '', building: '725 Bartlett Ave', amountDue: 1400 },
      { id: 'dominic', unit: '', building: '725 Bartlett Ave', amountDue: 1400 },
    ])
    expect([...billed.entries()]).toEqual([
      ['lamont', 1501],
      ['dominic', 1400],
    ])
  })
})
