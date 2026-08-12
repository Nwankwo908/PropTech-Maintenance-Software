import { describe, expect, it } from 'vitest'
import { enrichExtractedProperties } from './onboardingDocumentUpload'

describe('enrichExtractedProperties', () => {
  it('derives a property row from distinct resident building names on rent rolls', () => {
    const properties = enrichExtractedProperties(
      [],
      [
        {
          id: 'res-1',
          fullName: 'Jamie Tenant',
          unit: '101',
          building: 'Riverview Apartments',
          phone: '',
          email: '',
          leaseStart: '',
          leaseEnd: '',
          monthlyRent: '',
          rentDueDay: '',
          occupancyStatus: 'active',
          maintenanceResponsibilitiesClause: '',
          sourceDocumentName: 'rent-roll.xlsx',
          confidence: 90,
          selected: true,
          needsReview: false,
        },
        {
          id: 'res-2',
          fullName: 'Alex Renter',
          unit: '102',
          building: 'Riverview Apartments',
          phone: '',
          email: '',
          leaseStart: '',
          leaseEnd: '',
          monthlyRent: '',
          rentDueDay: '',
          occupancyStatus: 'active',
          maintenanceResponsibilitiesClause: '',
          sourceDocumentName: 'rent-roll.xlsx',
          confidence: 88,
          selected: true,
          needsReview: false,
        },
      ],
      [],
      [],
    )

    expect(properties).toHaveLength(1)
    expect(properties[0]?.name).toBe('Riverview Apartments')
    expect(properties[0]?.unitCount).toBe(2)
    expect(properties[0]?.propertyType).toBe('multifamily')
    expect(properties[0]?.needsReview).toBe(true)
  })

  it('derives single-family type when rent roll shows one unit in a building', () => {
    const properties = enrichExtractedProperties(
      [],
      [
        {
          id: 'res-1',
          fullName: 'Jamie Tenant',
          unit: '101',
          building: 'Oak Cottage',
          phone: '',
          email: '',
          leaseStart: '',
          leaseEnd: '',
          monthlyRent: '',
          rentDueDay: '',
          occupancyStatus: 'active',
          maintenanceResponsibilitiesClause: '',
          sourceDocumentName: 'rent-roll.xlsx',
          confidence: 90,
          selected: true,
          needsReview: false,
        },
      ],
      [],
      [],
    )

    expect(properties).toHaveLength(1)
    expect(properties[0]?.propertyType).toBe('single_family_home')
    expect(properties[0]?.unitCount).toBe(1)
  })

  it('merges GPT property rows with derived building inventory', () => {
    const properties = enrichExtractedProperties(
      [
        {
          id: 'prop-1',
          name: 'Riverview Apartments',
          address: '123 Main St',
          city: 'Newark',
          state: 'NJ',
          zipCode: '07102',
          propertyType: 'multifamily',
          unitCount: 0,
          unitLabels: '',
          propertyManagerName: '',
          propertyManagerPhone: '',
          sourceDocumentName: 'rent-roll.xlsx',
          confidence: 95,
          selected: true,
          needsReview: false,
        },
      ],
      [
        {
          id: 'res-1',
          fullName: 'Jamie Tenant',
          unit: '101',
          building: 'Riverview Apartments',
          phone: '',
          email: '',
          leaseStart: '',
          leaseEnd: '',
          monthlyRent: '',
          rentDueDay: '',
          occupancyStatus: 'active',
          maintenanceResponsibilitiesClause: '',
          sourceDocumentName: 'rent-roll.xlsx',
          confidence: 90,
          selected: true,
          needsReview: false,
        },
      ],
      [],
      [],
    )

    expect(properties).toHaveLength(1)
    expect(properties[0]?.address).toBe('123 Main St')
    expect(properties[0]?.unitCount).toBe(1)
    expect(properties[0]?.selected).toBe(true)
  })
})
