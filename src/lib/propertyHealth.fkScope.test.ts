import { describe, expect, it } from 'vitest'
import {
  filterTicketsForBuildingScope,
  filterTicketsForScope,
  type PropertyHealthCanonicalProperty,
  type PropertyHealthTicket,
  type PropertyHealthUnit,
} from '@/lib/propertyHealth'

function ticket(partial: Partial<PropertyHealthTicket> & Pick<PropertyHealthTicket, 'id' | 'unit'>): PropertyHealthTicket {
  return {
    createdAt: '2026-09-01T12:00:00.000Z',
    unitId: null,
    building: null,
    propertyId: null,
    issueCategory: 'plumbing',
    vendorWorkStatus: 'unassigned',
    assignedVendorId: null,
    urgency: 'normal',
    ...partial,
  }
}

const units: PropertyHealthUnit[] = [
  {
    id: 'unit-bay-1',
    unitLabel: '1',
    building: '3804 W Bay Avenue',
    status: 'active',
    propertyId: 'prop-bay',
  },
  {
    id: 'unit-maple-1',
    unitLabel: '1',
    building: '14 Maple Ave',
    status: 'active',
    propertyId: 'prop-maple',
  },
]

const bayProperty: PropertyHealthCanonicalProperty = {
  id: 'prop-bay',
  name: '3804 W Bay Avenue',
}

describe('filterTicketsForBuildingScope FK-first', () => {
  it('still counts unlabeled SMS tickets for single-building inventories', () => {
    const onlyBayUnits = units.filter((unit) => unit.propertyId === 'prop-bay')
    const orphan = ticket({ id: 't-orphan', unit: '1', building: null, unitId: null })

    const scoped = filterTicketsForBuildingScope([orphan], '3804 W Bay Avenue', onlyBayUnits)
    expect(scoped.map((row) => row.id)).toEqual(['t-orphan'])
  })

  it('does not steal a ticket from Maple when Bay is the only inventory with label "1"', () => {
    const onlyBayUnits = units.filter((unit) => unit.propertyId === 'prop-bay')
    const mapleTicket = ticket({
      id: 't-maple',
      unit: '1',
      building: '14 Maple Ave',
      propertyId: 'prop-maple',
    })

    const scoped = filterTicketsForBuildingScope([mapleTicket], '3804 W Bay Avenue', onlyBayUnits)
    expect(scoped).toHaveLength(0)
  })

  it('scopes by property_id and unit_id across repeating labels', () => {
    const bayTicket = ticket({
      id: 't-bay',
      unit: '1',
      unitId: 'unit-bay-1',
      propertyId: 'prop-bay',
    })
    const mapleTicket = ticket({
      id: 't-maple',
      unit: '1',
      unitId: 'unit-maple-1',
      propertyId: 'prop-maple',
    })

    expect(
      filterTicketsForBuildingScope([bayTicket, mapleTicket], '3804 W Bay Avenue', units).map(
        (row) => row.id,
      ),
    ).toEqual(['t-bay'])
    expect(
      filterTicketsForScope([bayTicket, mapleTicket], '3804 W Bay Avenue', units, [], bayProperty).map(
        (row) => row.id,
      ),
    ).toEqual(['t-bay'])
  })

  it('does not use unique-label inference when the same label exists on two properties', () => {
    const orphan = ticket({ id: 't-orphan', unit: '1' })
    expect(filterTicketsForBuildingScope([orphan], '3804 W Bay Avenue', units)).toHaveLength(0)
    expect(filterTicketsForBuildingScope([orphan], '14 Maple Ave', units)).toHaveLength(0)
  })
})
