import { describe, expect, it } from 'vitest'
import {
  isMaintenanceExpenseFinancialRecord,
  parseFinancialAmount,
  parseFinancialPeriodToIso,
  resolveListedPropertyForExpense,
} from '@/lib/onboarding/maintenanceExpenseFromFinancial'

describe('isMaintenanceExpenseFinancialRecord', () => {
  it('accepts repair / maintenance lines', () => {
    expect(
      isMaintenanceExpenseFinancialRecord({
        recordType: 'Expense',
        description: 'Roof repair',
        amount: '4200',
      }),
    ).toBe(true)
    expect(
      isMaintenanceExpenseFinancialRecord({
        recordType: 'Maintenance',
        description: 'HVAC service call',
        amount: '350',
      }),
    ).toBe(true)
  })

  it('rejects rent / tax / income lines', () => {
    expect(
      isMaintenanceExpenseFinancialRecord({
        recordType: 'Income',
        description: 'Rental income',
        amount: '2400',
      }),
    ).toBe(false)
    expect(
      isMaintenanceExpenseFinancialRecord({
        recordType: 'Expense',
        description: 'Property tax Q3',
        amount: '1800',
      }),
    ).toBe(false)
  })
})

describe('parseFinancialAmount', () => {
  it('parses currency strings', () => {
    expect(parseFinancialAmount('$4,200.00')).toBe(4200)
    expect(parseFinancialAmount('(320.50)')).toBe(-320.5)
    expect(parseFinancialAmount('')).toBe(0)
  })
})

describe('parseFinancialPeriodToIso', () => {
  it('parses year-month and dates', () => {
    expect(parseFinancialPeriodToIso('2024-08')?.startsWith('2024-08-')).toBe(true)
    expect(parseFinancialPeriodToIso('2024-08-15')?.startsWith('2024-08-15')).toBe(true)
    expect(parseFinancialPeriodToIso('')).toBeNull()
  })
})

describe('resolveListedPropertyForExpense', () => {
  it('matches building to a listed property', () => {
    expect(
      resolveListedPropertyForExpense('Maple Heights', [
        { name: 'Maple Heights' },
        { name: 'Pine Ridge' },
      ]),
    ).toBe('Maple Heights')
  })

  it('uses the sole listed property when building is blank', () => {
    expect(resolveListedPropertyForExpense('', [{ name: 'Oakwood Apartments' }])).toBe(
      'Oakwood Apartments',
    )
  })

  it('returns null when multi-property and building is unknown', () => {
    expect(
      resolveListedPropertyForExpense('', [
        { name: 'Maple Heights' },
        { name: 'Pine Ridge' },
      ]),
    ).toBeNull()
  })
})
