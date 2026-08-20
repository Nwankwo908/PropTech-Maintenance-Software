import { describe, expect, it } from 'vitest'
import {
  dedupeOnboardingImportResidents,
  isSelectedOnboardingExtractedResident,
  mergeFastTrackReviewResidents,
  onboardingResidentIdentityMatch,
  onboardingResidentScopeKey,
  onboardingResidentsToImportRows,
  resolveImportResidentBuilding,
} from './importResidents'
import type { OnboardingResident } from './residents'

describe('onboardingResidentScopeKey', () => {
  it('normalizes name, unit, and building for matching', () => {
    expect(onboardingResidentScopeKey('Jamie Tenant', '101', 'Riverview')).toBe(
      onboardingResidentScopeKey('jamie tenant', '101', 'Riverview'),
    )
  })

  it('treats Unit 101 and 101 as the same unit', () => {
    expect(onboardingResidentScopeKey('Jamie Tenant', 'Unit 101', 'Riverview')).toBe(
      onboardingResidentScopeKey('Jamie Tenant', '101', 'Riverview'),
    )
  })
})

describe('onboardingResidentIdentityMatch', () => {
  it('matches the same tenant across AI review and final review checkpoints', () => {
    expect(
      onboardingResidentIdentityMatch(
        {
          id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
          fullName: 'Jamie Tenant',
          unit: '101',
          building: 'Maple Court',
          phone: '',
        },
        {
          id: 'ext-1',
          fullName: 'Jamie Tenant',
          unit: 'Unit 101',
          building: 'Maple Court Rent Roll',
          phone: '',
        },
      ),
    ).toBe(true)
  })

  it('keeps two people with the same unit number in different buildings', () => {
    expect(
      onboardingResidentIdentityMatch(
        { fullName: 'Amy Chen', unit: '1A', building: 'Oak Apartments' },
        { fullName: 'Amy Chen', unit: '1A', building: 'Pine Court' },
      ),
    ).toBe(false)
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

  it('does not move a repeating unit number onto the first property in the list', () => {
    const multi = [
      { id: 'prop-1', name: 'Maple Court' },
      { id: 'prop-2', name: 'Pine Court' },
    ]
    const repeatingUnits = [
      { unitLabel: '1A', building: 'Maple Court', propertyId: 'prop-1' },
      { unitLabel: '1A', building: 'Pine Court', propertyId: 'prop-2' },
    ]
    expect(resolveImportResidentBuilding('1A', 'Pine Court', repeatingUnits, multi)).toBe('Pine Court')
    expect(resolveImportResidentBuilding('1A', '45 Pine Street, Newark NJ', repeatingUnits, multi)).toBe(
      'Pine Court',
    )
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

  it('does not list a second copy when the saved row and extracted row are the same person', () => {
    const persisted: OnboardingResident[] = [
      {
        id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
        residentId: 'ONB-001',
        fullName: 'Jamie Tenant',
        unit: '101',
        building: 'Maple Court',
        email: '',
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
        unit: 'Unit 101',
        building: 'Maple Court Rent Roll',
        phone: '',
        email: '',
        leaseStart: '',
        leaseEnd: '',
        selected: true,
      },
    ])

    expect(merged).toHaveLength(1)
    expect(merged[0]?.id).toBe('aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee')
  })

  it('does not add unchecked extracted tenants to the review roster', () => {
    const merged = mergeFastTrackReviewResidents([], [
      {
        id: 'ext-skip',
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
    expect(merged).toHaveLength(0)
  })
})

describe('onboardingResidentsToImportRows', () => {
  it('marks every named review resident selected so complete persists the full roster', () => {
    const rows = onboardingResidentsToImportRows([
      {
        id: 'db-1',
        residentId: 'ONB-001',
        fullName: 'Jamie Tenant',
        unit: '101',
        building: 'Riverview',
        email: '',
        phone: '',
        monthlyRent: 1800,
        rentDueDay: 1,
        leaseStart: '2026-01-01',
        leaseEnd: '2026-12-31',
        maintenanceResponsibilitiesClause: null,
        occupancyStatus: 'active',
      },
      {
        id: 'extract-review-1',
        residentId: '',
        fullName: 'Alex Renter',
        unit: '102',
        building: 'Riverview',
        email: '',
        phone: '',
        monthlyRent: null,
        rentDueDay: null,
        leaseStart: null,
        leaseEnd: null,
        maintenanceResponsibilitiesClause: null,
        occupancyStatus: 'active',
      },
    ])
    expect(rows).toHaveLength(2)
    expect(rows.every(isSelectedOnboardingExtractedResident)).toBe(true)
    expect(rows.map((row) => row.fullName)).toEqual(['Jamie Tenant', 'Alex Renter'])
  })

  it('collapses a saved row and an extracted copy into one import row', () => {
    const rows = onboardingResidentsToImportRows([
      {
        id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
        residentId: 'ONB-001',
        fullName: 'Jamie Tenant',
        unit: '101',
        building: 'Maple Court',
        email: '',
        phone: '555-0100',
        monthlyRent: null,
        rentDueDay: null,
        leaseStart: null,
        leaseEnd: null,
        maintenanceResponsibilitiesClause: null,
        occupancyStatus: 'active',
      },
      {
        id: 'extract-review-1',
        residentId: '',
        fullName: 'Jamie Tenant',
        unit: 'Unit 101',
        building: 'Maple Court Rent Roll',
        email: '',
        phone: '',
        monthlyRent: null,
        rentDueDay: null,
        leaseStart: null,
        leaseEnd: null,
        maintenanceResponsibilitiesClause: null,
        occupancyStatus: 'active',
      },
    ])
    expect(dedupeOnboardingImportResidents(rows)).toHaveLength(1)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.id).toBe('aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee')
  })
})

describe('isSelectedOnboardingExtractedResident', () => {
  it('only imports tenants the landlord checked', () => {
    expect(isSelectedOnboardingExtractedResident({ selected: true })).toBe(true)
    expect(isSelectedOnboardingExtractedResident({ selected: false })).toBe(false)
    expect(isSelectedOnboardingExtractedResident({})).toBe(false)
  })
})
