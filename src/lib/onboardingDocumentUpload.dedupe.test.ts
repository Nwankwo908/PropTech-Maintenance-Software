import { describe, expect, it } from 'vitest'
import type { PortfolioDocumentExtractPayload } from '@/api/onboardingDocumentExtract'
import {
  buildOnboardingExtractionReview,
  dedupeOnboardingExtractedResidents,
  type OnboardingExtractedResident,
  type OnboardingUploadedDocument,
} from './onboardingDocumentUpload'

function emptyPayload(
  overrides: Partial<PortfolioDocumentExtractPayload> = {},
): PortfolioDocumentExtractPayload {
  return {
    properties: [],
    units: [],
    residents: [],
    vendors: [],
    leases: [],
    maintenanceIssues: [],
    financialRecords: [],
    imageLabels: [],
    warnings: [],
    ...overrides,
  }
}

function uploadedDoc(
  id: string,
  fileName: string,
  payload: PortfolioDocumentExtractPayload,
): OnboardingUploadedDocument {
  return {
    id,
    fileName,
    fileType: fileName.split('.').pop() ?? 'pdf',
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
    extractedPayload: payload,
  }
}

function resident(
  overrides: Partial<OnboardingExtractedResident> & Pick<OnboardingExtractedResident, 'id' | 'fullName'>,
): OnboardingExtractedResident {
  return {
    unit: '',
    building: '',
    phone: '',
    email: '',
    leaseStart: '',
    leaseEnd: '',
    monthlyRent: '',
    rentDueDay: '',
    occupancyStatus: 'active',
    maintenanceResponsibilitiesClause: '',
    sourceDocumentName: 'doc.pdf',
    confidence: 90,
    selected: true,
    needsReview: false,
    ...overrides,
  }
}

describe('dedupeOnboardingExtractedResidents', () => {
  it('merges the same tenant from a lease and a rent roll into one row', () => {
    const merged = dedupeOnboardingExtractedResidents([
      resident({
        id: 'res-roll',
        fullName: 'Smith, Jane',
        unit: 'Unit 4B',
        phone: '555-0100',
        sourceDocumentName: 'rent-roll.xlsx',
      }),
      resident({
        id: 'res-lease',
        fullName: 'Jane A. Smith',
        unit: '4B',
        leaseStart: '2024-01-01',
        leaseEnd: '2024-12-31',
        monthlyRent: '1800',
        sourceDocumentName: 'Lease.pdf',
      }),
    ])

    expect(merged).toHaveLength(1)
    expect(merged[0]?.fullName).toBe('Jane A. Smith')
    expect(merged[0]?.phone).toBe('555-0100')
    expect(merged[0]?.leaseStart).toBe('2024-01-01')
    expect(merged[0]?.monthlyRent).toBe('1800')
    expect(merged[0]?.sourceDocumentName).toContain('rent-roll.xlsx')
    expect(merged[0]?.sourceDocumentName).toContain('Lease.pdf')
  })

  it('keeps two people with the same name in different units', () => {
    const merged = dedupeOnboardingExtractedResidents([
      resident({ id: 'a', fullName: 'John Smith', unit: '101' }),
      resident({ id: 'b', fullName: 'John Smith', unit: '102' }),
    ])
    expect(merged).toHaveLength(2)
  })
})

describe('buildOnboardingExtractionReview tenant dedupe', () => {
  it('does not list one tenant six times across lease pages and a rent roll', () => {
    const review = buildOnboardingExtractionReview([
      uploadedDoc(
        'doc-roll',
        'rent-roll.xlsx',
        emptyPayload({
          residents: [
            {
              fullName: 'Jane Smith',
              unit: '4B',
              building: 'Oak',
              phone: '555-0100',
              email: '',
              leaseStart: '',
              leaseEnd: '',
              monthlyRent: '1800',
              confidence: 92,
            },
            {
              fullName: 'Jane Smith',
              unit: '4B',
              building: 'Oak',
              phone: '555-0100',
              email: '',
              leaseStart: '',
              leaseEnd: '',
              monthlyRent: '1800',
              confidence: 88,
            },
          ],
        }),
      ),
      uploadedDoc(
        'doc-lease',
        'Lease.pdf',
        emptyPayload({
          residents: [
            {
              fullName: 'Jane A Smith',
              unit: '4B',
              building: 'Oak',
              phone: '',
              email: '',
              leaseStart: '2024-01-01',
              leaseEnd: '2024-12-31',
              monthlyRent: '1800',
              confidence: 90,
            },
            {
              fullName: 'Jane A Smith',
              unit: '4B',
              building: 'Oak',
              phone: '',
              email: '',
              leaseStart: '2024-01-01',
              leaseEnd: '2024-12-31',
              monthlyRent: '1800',
              confidence: 86,
            },
          ],
          leases: [
            {
              residentName: 'Smith, Jane',
              unit: '4-B',
              building: 'Oak',
              leaseStart: '2024-01-01',
              leaseEnd: '2024-12-31',
              rentAmount: '1800',
              securityDeposit: '1800',
              confidence: 91,
            },
            {
              residentName: 'Jane Smith',
              unit: '4B',
              building: 'Oak',
              leaseStart: '2024-01-01',
              leaseEnd: '2024-12-31',
              rentAmount: '1800',
              securityDeposit: '1800',
              confidence: 85,
            },
          ],
        }),
      ),
    ])

    expect(review.residents).toHaveLength(1)
    expect(review.leases).toHaveLength(1)
    expect(review.residents[0]?.fullName.toLowerCase()).toContain('jane')
    expect(review.residents[0]?.phone).toBe('555-0100')
    expect(review.residents[0]?.leaseStart).toBe('2024-01-01')
  })
})
