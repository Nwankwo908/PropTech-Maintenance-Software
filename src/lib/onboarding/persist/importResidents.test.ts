import { describe, expect, it } from 'vitest'
import {
  mergeFastTrackReviewResidents,
  onboardingResidentScopeKey,
  resolveImportResidentBuilding,
} from './importResidents'
import type { OnboardingResident } from './residents'

describe('onboardingResidentScopeKey', () => {
  it('normalizes name, unit, and building for matching', () => {
    expect(onboardingResidentScopeKey('Jamie Tenant', '101', 'Riverview')).toBe(
      onboardingResidentScopeKey('jamie tenant', '101', 'Riverview'),
    )
  })
})

describe('resolveImportResidentBuilding', () => {
  const properties = [{ id: 'prop-1', name: 'Maple Court' }]
  const units = [
    { unitLabel: '101', building: 'Maple Court', propertyId: 'prop-1' },
    { unitLabel: '102', building: 'Maple Court', propertyId: 'prop-1' },
  ]

  it('maps an empty building to the property inventory when the unit is unique', () => {
    expect(resolveImportResidentBuilding('101', '', units, properties)).toBe('Maple Court')
  })

  it('maps drifted rent-roll building labels to the saved property name', () => {
    expect(
      resolveImportResidentBuilding('102', 'Maple Court Rent Roll', units, properties),
    ).toBe('Maple Court')
  })

  it('falls back to the only saved property for multifamily portfolios with one property', () => {
    expect(resolveImportResidentBuilding('', '', units, properties)).toBe('Maple Court')
  })
})

describe('mergeFastTrackReviewResidents', () => {
  it('keeps persisted residents and adds selected extracted rows not yet saved', () => {
    const persisted: OnboardingResident[] = [
      {
        id: 'db-1',
        residentId: 'ONB-001',
        fullName: 'Jamie Tenant',
        unit: '101',
        building: 'Riverview',
        email: 'jamie@example.com',
        phone: '',
        monthlyRent: null,
        rentDueDay: null,
        leaseStart: null,
        leaseEnd: null,
        maintenanceResponsibilitiesClause: null,
        occupancyStatus: 'active',
      },
    ]

    const merged = mergeFastTrackReviewResidents(persisted, [
      {
        id: 'ext-1',
        fullName: 'Jamie Tenant',
        unit: '101',
        building: 'Riverview',
        phone: '',
        email: 'jamie@example.com',
        leaseStart: '',
        leaseEnd: '',
        selected: true,
      },
      {
        id: 'ext-2',
        fullName: 'Alex Renter',
        unit: '102',
        building: 'Riverview',
        phone: '',
        email: 'alex@example.com',
        leaseStart: '',
        leaseEnd: '',
        selected: true,
      },
      {
        id: 'ext-3',
        fullName: 'Skipped Tenant',
        unit: '103',
        building: 'Riverview',
        phone: '',
        email: '',
        leaseStart: '',
        leaseEnd: '',
        selected: false,
      },
    ])

    expect(merged).toHaveLength(2)
    expect(merged.map((row) => row.fullName)).toEqual(['Jamie Tenant', 'Alex Renter'])
  })
})
