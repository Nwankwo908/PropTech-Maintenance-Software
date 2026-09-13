import { describe, expect, it } from 'vitest'
import {
  DEFAULT_LEASE_UNIT,
  assignSharedUnitToLeaseCoTenants,
  isIllegibleLeaseUnit,
  leaseUnitOrDefault,
  sharedUnitForCoTenants,
} from './leaseUnit'

describe('leaseUnitOrDefault', () => {
  it('keeps an extracted unit label', () => {
    expect(leaseUnitOrDefault('B')).toBe('B')
    expect(leaseUnitOrDefault('  2A  ')).toBe('2A')
  })

  it('defaults to unit 1 when the lease has no unit', () => {
    expect(leaseUnitOrDefault('')).toBe(DEFAULT_LEASE_UNIT)
    expect(leaseUnitOrDefault('   ')).toBe(DEFAULT_LEASE_UNIT)
    expect(leaseUnitOrDefault(null)).toBe(DEFAULT_LEASE_UNIT)
    expect(leaseUnitOrDefault(undefined)).toBe(DEFAULT_LEASE_UNIT)
  })

  it('defaults to unit 1 when the unit is not legible', () => {
    expect(isIllegibleLeaseUnit('illegible')).toBe(true)
    expect(isIllegibleLeaseUnit('N/A')).toBe(true)
    expect(isIllegibleLeaseUnit('?')).toBe(true)
    expect(leaseUnitOrDefault('illegible')).toBe(DEFAULT_LEASE_UNIT)
    expect(leaseUnitOrDefault('not visible')).toBe(DEFAULT_LEASE_UNIT)
  })
})

describe('sharedUnitForCoTenants', () => {
  it('defaults every co-tenant to unit 1 when no unit is readable', () => {
    expect(sharedUnitForCoTenants(['', 'illegible', 'N/A'])).toBe(DEFAULT_LEASE_UNIT)
  })

  it('copies the one readable unit onto the rest', () => {
    expect(sharedUnitForCoTenants(['', '4B', 'illegible'])).toBe('4B')
  })

  it('does not pick a unit when two readable units disagree', () => {
    expect(sharedUnitForCoTenants(['1', '2'])).toBeNull()
  })
})

describe('assignSharedUnitToLeaseCoTenants', () => {
  it('assigns unit 1 to every resident on the same lease and property', () => {
    const rows = assignSharedUnitToLeaseCoTenants([
      {
        unit: '',
        building: '109 S Grove St',
        sourceDocumentName: 'Grove-Lease.pdf',
        needsReview: true,
        confidence: 90,
      },
      {
        unit: 'illegible',
        building: '109 S Grove St',
        sourceDocumentName: 'Grove-Lease.pdf',
        needsReview: true,
        confidence: 88,
      },
    ])
    expect(rows.map((row) => row.unit)).toEqual([DEFAULT_LEASE_UNIT, DEFAULT_LEASE_UNIT])
    expect(rows.every((row) => row.needsReview === false)).toBe(true)
  })
})
