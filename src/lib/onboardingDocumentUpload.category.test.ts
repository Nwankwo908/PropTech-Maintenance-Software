import { describe, expect, it } from 'vitest'
import {
  inferDocumentCategory,
  canRetryOnboardingDocumentExtract,
  isOnboardingExtractJunkValue,
  buildOnboardingExtractionReview,
  normalizeExtractionReview,
  emptyExtractionReview,
} from './onboardingDocumentUpload'

describe('inferDocumentCategory', () => {
  it('classifies lease agreements from common filenames', () => {
    expect(inferDocumentCategory('Unit 4B Lease Agreement.pdf')).toBe('lease_agreement')
    expect(inferDocumentCategory('Residential Tenancy Agreement.pdf')).toBe(
      'lease_agreement',
    )
    expect(inferDocumentCategory('Occupancy Agreement - 101.pdf')).toBe(
      'lease_agreement',
    )
    expect(inferDocumentCategory('rental-agreement-smith.docx')).toBe(
      'lease_agreement',
    )
  })

  it('still classifies rent rolls separately', () => {
    expect(inferDocumentCategory('April rent roll.xlsx')).toBe('rent_roll')
    expect(inferDocumentCategory('tenant roster.csv')).toBe('rent_roll')
  })
})

describe('canRetryOnboardingDocumentExtract', () => {
  it('allows retry after a failed or empty extract', () => {
    const base = {
      id: 'doc-1',
      fileName: 'Lease.pdf',
      fileType: 'pdf',
      fileSize: 12,
      documentCategory: 'lease_agreement' as const,
      categoryGroup: 'resident' as const,
      uploadProgress: 100,
      processingLabel: null,
      errorMessage: 'Document scanning is busy right now. Please wait a moment and try again.',
      imageLabels: [],
      hasHandwriting: false,
    }

    expect(
      canRetryOnboardingDocumentExtract({
        ...base,
        uploadStatus: 'failed',
        extractionStatus: 'failed',
      }),
    ).toBe(true)
    expect(
      canRetryOnboardingDocumentExtract({
        ...base,
        uploadStatus: 'needs_attention',
        extractionStatus: 'needs_attention',
        errorMessage: 'No content could be read from this document.',
      }),
    ).toBe(true)
    expect(
      canRetryOnboardingDocumentExtract({
        ...base,
        uploadStatus: 'scanning',
        extractionStatus: 'scanning',
      }),
    ).toBe(false)
    expect(
      canRetryOnboardingDocumentExtract({
        ...base,
        uploadStatus: 'ready_for_review',
        extractionStatus: 'ready_for_review',
        errorMessage: null,
      }),
    ).toBe(false)
  })
})

describe('isOnboardingExtractJunkValue', () => {
  it('treats status and error leftovers as junk, not portfolio data', () => {
    expect(isOnboardingExtractJunkValue('Needs attention')).toBe(true)
    expect(isOnboardingExtractJunkValue('needs_review')).toBe(true)
    expect(isOnboardingExtractJunkValue('n/a')).toBe(true)
    expect(isOnboardingExtractJunkValue('Jamie Tenant')).toBe(false)
  })

  it('drops junk names and warnings from extraction review', () => {
    const review = buildOnboardingExtractionReview([
      {
        id: 'doc-lease',
        fileName: 'Lease.pdf',
        fileType: 'pdf',
        fileSize: 12,
        documentCategory: 'lease_agreement',
        categoryGroup: 'resident',
        uploadStatus: 'ready_for_review',
        uploadProgress: 100,
        extractionStatus: 'ready_for_review',
        processingLabel: 'Ready for review',
        errorMessage: null,
        imageLabels: ['Needs attention'],
        hasHandwriting: false,
        extractedPayload: {
          properties: [{ name: 'Needs attention', streetAddress: '', city: '', state: '', zipCode: '', propertyType: 'multifamily', unitCount: 1, confidence: 40 }],
          units: [],
          residents: [{ fullName: 'Needs attention', unit: '4B', building: '', phone: '', email: '', leaseStart: '', leaseEnd: '', monthlyRent: '', confidence: 40 }],
          vendors: [],
          leases: [{ residentName: 'Alex Rivera', unit: '4B', building: '', leaseStart: '2024-01-01', leaseEnd: '2024-12-31', rentAmount: '1800', securityDeposit: '', confidence: 90 }],
          maintenanceIssues: [],
          financialRecords: [],
          imageLabels: ['Needs attention'],
          warnings: ['Needs attention', 'Last page is cut off'],
        },
      },
    ])

    // Leases enrich — they never mint residents/properties on their own.
    expect(review.residents).toEqual([])
    expect(review.properties).toEqual([])
    expect(review.leases.map((row) => row.residentName)).toEqual(['Alex Rivera'])
    expect(review.needsReview.map((row) => row.value)).toContain('Last page is cut off')
    expect(review.imageLabels).toEqual([])
  })

  it('scrubs persisted review rows that stored status copy as values', () => {
    const cleaned = normalizeExtractionReview({
      ...emptyExtractionReview(),
      residents: [
        {
          id: 'ext-res-1',
          fullName: 'Needs attention',
          unit: '4B',
          building: '',
          phone: '',
          email: '',
          leaseStart: '',
          leaseEnd: '',
          monthlyRent: '',
          rentDueDay: '',
          occupancyStatus: 'active',
          maintenanceResponsibilitiesClause: '',
          sourceDocumentName: 'Lease.pdf',
          confidence: 40,
          selected: true,
          needsReview: true,
        },
      ],
      needsReview: [
        {
          id: 'ext-warn-1',
          uploadedDocumentId: 'doc',
          sourceDocumentName: 'Lease.pdf',
          dataType: 'warning',
          label: 'Extraction note',
          value: 'Needs attention',
          confidence: 100,
          includeInImport: false,
          needsReview: true,
        },
      ],
    })
    expect(cleaned.residents).toEqual([])
    expect(cleaned.needsReview).toEqual([])
  })
})
