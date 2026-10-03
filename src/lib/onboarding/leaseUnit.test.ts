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

  it('does not invent a unit for single-family leases without a unit field', () => {
    expect(leaseUnitOrDefault('', 'single_family')).toBe('')
    expect(leaseUnitOrDefault(null, 'single_family_home')).toBe('')
    expect(leaseUnitOrDefault('illegible', 'SFR')).toBe('')
    expect(leaseUnitOrDefault('2A', 'single_family')).toBe('2A')
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

  it('does not invent a unit for single-family co-tenants without a readable unit', () => {
    expect(sharedUnitForCoTenants(['', 'illegible', 'N/A'], 'single_family')).toBeNull()
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
  })

  it('does not invent unit 1 for single-family co-tenants on the same lease', () => {
    const rows = assignSharedUnitToLeaseCoTenants(
      [
        {
          unit: '',
          building: '14 Maple Ave',
          sourceDocumentName: 'Maple-Lease.pdf',
          needsReview: true,
          confidence: 90,
        },
        {
          unit: 'illegible',
          building: '14 Maple Ave',
          sourceDocumentName: 'Maple-Lease.pdf',
          needsReview: true,
          confidence: 88,
        },
      ],
      'single_family',
    )
    expect(rows.map((row) => row.unit)).toEqual(['', 'illegible'])
  })
})
