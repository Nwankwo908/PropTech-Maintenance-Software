import { describe, expect, it } from 'vitest'
import {
  findInventoryUnitForResident,
  pickCanonicalUnitForResident,
  residentHasLeaseDatesForActivation,
  residentQualifiesForUnitActivation,
} from './unitActivation'

describe('residentQualifiesForUnitActivation', () => {
  it('activates when the tenant has a unit and lease dates', () => {
    expect(
      residentQualifiesForUnitActivation({
        id: 'res-1',
        unit: '4B',
        building: 'Oak Apartments',
        leaseStart: '2024-01-01',
        leaseEnd: '2025-01-01',
      }),
    ).toBe(true)
    expect(
      residentHasLeaseDatesForActivation({
        id: 'res-1',
        unit: '4B',
        leaseStart: '2024-01-01',
        leaseEnd: '',
      }),
    ).toBe(false)
  })

  it('activates when occupancy is Occupied even without lease dates', () => {
    expect(
      residentQualifiesForUnitActivation({
        id: 'res-1',
        unit: '4B',
        building: 'Oak Apartments',
        status: 'active',
      }),
    ).toBe(true)
  })

  it('does not occupy a pending move-in until the tenant replies YES', () => {
    expect(
      residentQualifiesForUnitActivation({
        id: 'res-1',
        unit: '4B',
        building: 'Oak Apartments',
        status: 'pending',
        leaseStart: '2024-01-01',
        leaseEnd: '2025-01-01',
      }),
    ).toBe(false)
  })

  it('activates when the tenant finished SMS onboarding even without lease dates', () => {
    expect(
      residentQualifiesForUnitActivation({
        id: 'res-1',
        unit: '4B',
        building: 'Oak Apartments',
        status: 'pending',
        activationStatus: 'activated',
      }),
    ).toBe(true)
  })

  it('does not activate a past resident or a row with no unit', () => {
    expect(
      residentQualifiesForUnitActivation({
        id: 'res-1',
        unit: '4B',
        activationStatus: 'activated',
        status: 'past_resident',
      }),
    ).toBe(false)
    expect(
      residentQualifiesForUnitActivation({
        id: 'res-1',
        unit: '',
        activationStatus: 'activated',
        leaseStart: '2024-01-01',
        leaseEnd: '2025-01-01',
      }),
    ).toBe(false)
  })
})

describe('findInventoryUnitForResident', () => {
  const units = [
    { id: 'u-oak', unitLabel: '1A', building: 'Oak Apartments' },
    { id: 'u-pine', unitLabel: '1A', building: 'Pine Court' },
    { id: 'u-oak-2', unitLabel: '2A', building: 'Oak Apartments' },
  ]

  it('matches a lease street to the rent-roll building', () => {
    expect(
      findInventoryUnitForResident(units, {
        unit: 'Unit 1A',
        building: '123 Oak Street, Newark NJ',
      })?.id,
    ).toBe('u-oak')
  })

  it('does not assign a repeating unit number to the first building in the list', () => {
    expect(
      findInventoryUnitForResident(units, {
        unit: '1A',
        building: 'Pine Court',
      })?.id,
    ).toBe('u-pine')
  })
})

describe('pickCanonicalUnitForResident', () => {
  const units = [
    { id: 'u-oak', unitLabel: '1A', building: 'Oak Apartments' },
    { id: 'u-pine', unitLabel: '1A', building: 'Pine Court' },
    { id: 'u-maple-2', unitLabel: '2', building: '78 Maple Ave' },
  ]

  it('uses occupancy unit id over a conflicting label', () => {
    expect(
      pickCanonicalUnitForResident(units, {
        unit: '1A',
        building: 'Oak Apartments',
        occupancyUnitId: 'u-maple-2',
      })?.id,
    ).toBe('u-maple-2')
  })

  it('uses SMS identity unit id when occupancy is missing', () => {
    expect(
      pickCanonicalUnitForResident(units, {
        unit: 'Unit 2',
        building: 'Somewhere else',
        identityUnitId: 'u-maple-2',
      })?.id,
    ).toBe('u-maple-2')
  })

  it('does not invent a unit when no id or label matches', () => {
    expect(
      pickCanonicalUnitForResident(units, {
        unit: '9Z',
        building: 'Oak Apartments',
      }),
    ).toBeUndefined()
  })

  it('qualifies an SMS-activated resident with only a canonical unit id', () => {
    expect(
      residentQualifiesForUnitActivation({
        id: 'res-1',
        unit: '',
        occupancyUnitId: 'u-maple-2',
        activationStatus: 'activated',
      }),
    ).toBe(true)
  })
})
