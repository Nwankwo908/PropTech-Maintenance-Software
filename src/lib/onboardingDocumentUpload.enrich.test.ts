import { describe, expect, it } from 'vitest'
import {
  enrichExtractedProperties,
  buildOnboardingExtractionReview,
  type OnboardingUploadedDocument,
} from './onboardingDocumentUpload'
import type { PortfolioDocumentExtractPayload } from '@/api/onboardingDocumentExtract'

function reviewDoc(
  id: string,
  fileName: string,
  documentCategory: OnboardingUploadedDocument['documentCategory'],
  payload: Partial<PortfolioDocumentExtractPayload>,
): OnboardingUploadedDocument {
  return {
    id,
    fileName,
    fileType: fileName.split('.').pop() ?? 'pdf',
    fileSize: 12,
    documentCategory,
    categoryGroup: documentCategory === 'rent_roll' ? 'financial' : 'resident',
    uploadStatus: 'ready_for_review',
    uploadProgress: 100,
    extractionStatus: 'ready_for_review',
    processingLabel: 'Ready for review',
    errorMessage: null,
    imageLabels: [],
    hasHandwriting: false,
    extractedPayload: {
      properties: [],
      units: [],
      residents: [],
      vendors: [],
      leases: [],
      maintenanceIssues: [],
      financialRecords: [],
      imageLabels: [],
      warnings: [],
      ...payload,
    },
  }
}

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
    expect(properties[0]?.selected).toBe(true)
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

describe('extraction review unit counts', () => {
  it('counts nine rent-roll tenants even when GPT unitCount is 4', () => {
    const review = buildOnboardingExtractionReview([
      {
        id: 'roll',
        fileName: 'rent-roll.xlsx',
        fileType: 'xlsx',
        fileSize: 12,
        documentCategory: 'rent_roll',
        categoryGroup: 'property',
        uploadStatus: 'ready_for_review',
        uploadProgress: 100,
        extractionStatus: 'ready_for_review',
        processingLabel: 'Ready for review',
        errorMessage: null,
        imageLabels: [],
        hasHandwriting: false,
        extractedPayload: {
          properties: [
            {
              name: 'Maple Court',
              streetAddress: '100 Maple St',
              city: 'Atlanta',
              state: 'GA',
              zipCode: '30301',
              propertyType: 'multifamily',
              unitCount: 4,
              confidence: 90,
            },
          ],
          units: [],
          residents: Array.from({ length: 9 }, (_, index) => ({
            fullName: `Tenant ${index + 1}`,
            unit: String(101 + index),
            building: 'Maple Court',
            phone: '',
            email: '',
            leaseStart: '',
            leaseEnd: '',
            monthlyRent: '',
            confidence: 90,
          })),
          vendors: [],
          leases: [],
          maintenanceIssues: [],
          financialRecords: [],
          imageLabels: [],
          warnings: [],
        },
      },
    ])

    expect(review.properties[0]?.unitCount).toBe(9)
    expect(review.units).toHaveLength(9)
  })

  it('counts Unit 4B and 4B as one unit from a rent roll', () => {
    const review = buildOnboardingExtractionReview([
      {
        id: 'roll',
        fileName: 'rent-roll.xlsx',
        fileType: 'xlsx',
        fileSize: 12,
        documentCategory: 'rent_roll',
        categoryGroup: 'financial',
        uploadStatus: 'ready_for_review',
        uploadProgress: 100,
        extractionStatus: 'ready_for_review',
        processingLabel: 'Ready for review',
        errorMessage: null,
        imageLabels: [],
        hasHandwriting: false,
        extractedPayload: {
          properties: [
            {
              name: 'Maple Court',
              streetAddress: '',
              city: '',
              state: '',
              zipCode: '',
              propertyType: 'multifamily',
              unitCount: 2,
              confidence: 80,
            },
          ],
          units: [
            { label: 'Unit 4B', building: 'Maple Court', confidence: 90 },
            { label: '4B', building: 'Maple Court', confidence: 88 },
          ],
          residents: [],
          vendors: [],
          leases: [],
          maintenanceIssues: [],
          financialRecords: [],
          imageLabels: [],
          warnings: [],
        },
      },
    ])

    expect(review.units).toHaveLength(1)
    expect(review.properties[0]?.unitCount).toBe(1)
  })

  it('does not create a second building from a lease address when a rent roll already named the property', () => {
    const review = buildOnboardingExtractionReview([
      {
        id: 'roll',
        fileName: 'rent-roll.xlsx',
        fileType: 'xlsx',
        fileSize: 12,
        documentCategory: 'rent_roll',
        categoryGroup: 'property',
        uploadStatus: 'ready_for_review',
        uploadProgress: 100,
        extractionStatus: 'ready_for_review',
        processingLabel: 'Ready for review',
        errorMessage: null,
        imageLabels: [],
        hasHandwriting: false,
        extractedPayload: {
          properties: [
            {
              name: 'Oak Apartments',
              streetAddress: '',
              city: 'Newark',
              state: 'NJ',
              zipCode: '07102',
              propertyType: 'multifamily',
              unitCount: 2,
              confidence: 92,
            },
          ],
          units: [
            { label: '4B', building: 'Oak Apartments', confidence: 90 },
            { label: '5A', building: 'Oak Apartments', confidence: 90 },
          ],
          residents: [
            {
              fullName: 'Jane Smith',
              unit: '4B',
              building: 'Oak Apartments',
              phone: '555-0100',
              email: '',
              leaseStart: '',
              leaseEnd: '',
              monthlyRent: '1800',
              confidence: 90,
            },
            {
              fullName: 'Sam Lee',
              unit: '5A',
              building: 'Oak Apartments',
              phone: '',
              email: '',
              leaseStart: '',
              leaseEnd: '',
              monthlyRent: '1900',
              confidence: 88,
            },
          ],
          vendors: [],
          leases: [],
          maintenanceIssues: [],
          financialRecords: [],
          imageLabels: [],
          warnings: [],
        },
      },
      {
        id: 'lease',
        fileName: 'Jane Smith Lease.pdf',
        fileType: 'pdf',
        fileSize: 12,
        documentCategory: 'lease_agreement',
        categoryGroup: 'resident',
        uploadStatus: 'ready_for_review',
        uploadProgress: 100,
        extractionStatus: 'ready_for_review',
        processingLabel: 'Ready for review',
        errorMessage: null,
        imageLabels: [],
        hasHandwriting: false,
        extractedPayload: {
          properties: [
            {
              name: '123 Oak Street',
              streetAddress: '123 Oak Street, Newark NJ 07102',
              city: 'Newark',
              state: 'NJ',
              zipCode: '07102',
              propertyType: 'multifamily',
              unitCount: 1,
              confidence: 80,
            },
          ],
          units: [{ label: 'Unit 4B', building: '123 Oak Street', confidence: 86 }],
          residents: [
            {
              fullName: 'Jane Smith',
              unit: '4B',
              building: '123 Oak Street',
              phone: '',
              email: '',
              leaseStart: '2024-01-01',
              leaseEnd: '2024-12-31',
              monthlyRent: '1800',
              confidence: 90,
            },
          ],
          vendors: [],
          leases: [
            {
              residentName: 'Jane Smith',
              unit: '4B',
              building: '123 Oak Street, Newark NJ',
              leaseStart: '2024-01-01',
              leaseEnd: '2024-12-31',
              rentAmount: '1800',
              securityDeposit: '1800',
              confidence: 91,
            },
          ],
          maintenanceIssues: [],
          financialRecords: [],
          imageLabels: [],
          warnings: [],
        },
      },
    ])

    expect(review.properties).toHaveLength(1)
    expect(review.properties[0]?.name).toBe('Oak Apartments')
    expect(review.units).toHaveLength(2)
    expect(review.properties[0]?.unitCount).toBe(2)
    expect(review.residents).toHaveLength(2)
  })

  it('keeps 17 tenants across 5 buildings when unit numbers repeat and leases share a city', () => {
    const buildings = [
      {
        name: 'Oak Apartments',
        address: '123 Oak Street, Newark NJ 07102',
        people: [
          ['Amy Chen', '1A'],
          ['Ben Diaz', '2A'],
          ['Cara Evans', '3A'],
          ['Dan Foster', '4A'],
        ],
      },
      {
        name: 'Pine Court',
        address: '45 Pine Street, Newark NJ 07102',
        people: [
          ['Elena Gomez', '1A'],
          ['Frank Hale', '2A'],
          ['Gina Ivey', '3A'],
          ['Hugo Jones', '4A'],
        ],
      },
      {
        name: 'Maple House',
        address: '8 Maple Avenue, Newark NJ 07102',
        people: [
          ['Iris Kim', '1A'],
          ['Jon Lee', '2A'],
          ['Kara Moss', '3A'],
        ],
      },
      {
        name: 'Elm Place',
        address: '90 Elm Road, Newark NJ 07102',
        people: [
          ['Leo Nash', '1A'],
          ['Mia Ortiz', '2A'],
          ['Nate Park', '3A'],
        ],
      },
      {
        name: 'Cedar Lane',
        address: '12 Cedar Lane, Newark NJ 07102',
        people: [
          ['Omar Quinn', '1A'],
          ['Priya Shah', '2A'],
          ['Rita Tong', '3A'],
        ],
      },
    ]

    const rentRollResidents = buildings.flatMap((building) =>
      building.people.map(([fullName, unit]) => ({
        fullName,
        unit,
        building: building.name,
        phone: '',
        email: '',
        leaseStart: '',
        leaseEnd: '',
        monthlyRent: '1800',
        confidence: 92,
      })),
    )

    const leaseDocs = buildings.flatMap((building) =>
      building.people.map(([fullName, unit]) =>
        reviewDoc(`lease-${building.name}-${unit}`, `${fullName} Lease.pdf`, 'lease_agreement', {
          properties: [
            {
              name: building.address,
              streetAddress: building.address,
              city: 'Newark',
              state: 'NJ',
              zipCode: '07102',
              propertyType: 'multifamily',
              unitCount: 1,
              confidence: 80,
            },
          ],
          units: [{ label: unit, building: building.address, confidence: 86 }],
          residents: [
            {
              fullName,
              unit,
              building: building.address,
              phone: '',
              email: '',
              leaseStart: '2024-01-01',
              leaseEnd: '2025-01-01',
              monthlyRent: '1800',
              confidence: 90,
            },
          ],
          leases: [
            {
              residentName: fullName,
              unit,
              building: building.address,
              leaseStart: '2024-01-01',
              leaseEnd: '2025-01-01',
              rentAmount: '1800',
              securityDeposit: '1800',
              confidence: 91,
            },
          ],
        }),
      ),
    )

    const review = buildOnboardingExtractionReview([
      reviewDoc('roll', 'rent-roll.xlsx', 'rent_roll', {
        properties: buildings.map((building) => ({
          name: building.name,
          streetAddress: '',
          city: 'Newark',
          state: 'NJ',
          zipCode: '07102',
          propertyType: 'multifamily',
          unitCount: building.people.length,
          confidence: 94,
        })),
        units: buildings.flatMap((building) =>
          building.people.map(([, unit]) => ({
            label: unit,
            building: building.name,
            confidence: 90,
          })),
        ),
        residents: rentRollResidents,
      }),
      ...leaseDocs,
    ])

    expect(review.residents).toHaveLength(17)
    expect(review.properties).toHaveLength(5)
    expect(review.units).toHaveLength(17)
    expect(new Set(review.residents.map((row) => row.fullName)).size).toBe(17)
  })
})
