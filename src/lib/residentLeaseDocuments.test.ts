import { describe, expect, it } from 'vitest'
import type { PortfolioDocumentExtractPayload } from '@/api/onboardingDocumentExtract'
import type {
  OnboardingExtractionReview,
  OnboardingUploadedDocument,
} from '@/lib/onboardingDocumentUpload'
import { emptyReviewManualAccount } from '@/lib/onboardingReviewManual'
import { collectResidentLeaseDocuments } from '@/lib/residentLeaseDocuments'

function emptyPayload(
  patch: Partial<PortfolioDocumentExtractPayload> = {},
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
    ...patch,
  }
}

function doc(
  patch: Partial<OnboardingUploadedDocument> & Pick<OnboardingUploadedDocument, 'id' | 'fileName'>,
): OnboardingUploadedDocument {
  return {
    fileType: 'pdf',
    fileSize: 1200,
    documentCategory: 'lease_agreement',
    categoryGroup: 'resident',
    uploadStatus: 'ready_for_review',
    uploadProgress: 100,
    extractionStatus: 'ready_for_review',
    processingLabel: null,
    errorMessage: null,
    imageLabels: [],
    hasHandwriting: false,
    storageBucket: 'landlord-onboarding-documents',
    storagePath: `alpha/${patch.id}/${patch.fileName}`,
    extractedPayload: null,
    ...patch,
  }
}

function emptyReview(
  patch: Partial<OnboardingExtractionReview> = {},
): OnboardingExtractionReview {
  return {
    account: emptyReviewManualAccount(),
    properties: [],
    units: [],
    residents: [],
    leases: [],
    vendors: [],
    maintenanceIssues: [],
    financialRecords: [],
    needsReview: [],
    imageLabels: [],
    ...patch,
  }
}

const jane = {
  fullName: 'Jane Doe',
  unit: '4B',
  building: 'Maple Court',
  phone: '9735550100',
  email: 'jane@example.com',
}

describe('collectResidentLeaseDocuments', () => {
  it('attaches a lease PDF that extracted this tenant', () => {
    const lease = doc({
      id: 'doc-lease',
      fileName: 'Jane-Doe-Lease.pdf',
      extractedPayload: emptyPayload({
        leases: [
          {
            residentName: 'Jane Doe',
            unit: '4B',
            building: 'Maple Court',
            leaseStart: '2025-01-01',
            leaseEnd: '2026-01-01',
            rentAmount: '1850',
            securityDeposit: '1850',
            confidence: 90,
          },
        ],
      }),
    })

    expect(collectResidentLeaseDocuments([lease], jane).map((row) => row.fileName)).toEqual([
      'Jane-Doe-Lease.pdf',
    ])
  })

  it('does not attach a rent roll even when it lists the tenant', () => {
    const roll = doc({
      id: 'doc-roll',
      fileName: 'Rent-Roll.xlsx',
      documentCategory: 'rent_roll',
      categoryGroup: 'financial',
      extractedPayload: emptyPayload({
        residents: [
          {
            fullName: 'Jane Doe',
            unit: '4B',
            building: 'Maple Court',
            phone: '',
            email: '',
            leaseStart: '',
            leaseEnd: '',
            monthlyRent: '1850',
            confidence: 90,
          },
        ],
      }),
    })

    expect(collectResidentLeaseDocuments([roll], jane)).toEqual([])
  })

  it('does not attach another tenant’s lease', () => {
    const other = doc({
      id: 'doc-other',
      fileName: 'Sam-Lee-Lease.pdf',
      extractedPayload: emptyPayload({
        leases: [
          {
            residentName: 'Sam Lee',
            unit: '2A',
            building: 'Maple Court',
            leaseStart: '',
            leaseEnd: '',
            rentAmount: '',
            securityDeposit: '',
            confidence: 90,
          },
        ],
      }),
    })

    expect(collectResidentLeaseDocuments([other], jane)).toEqual([])
  })

  it('uses AI review source files and skips the merged rent roll name', () => {
    const lease = doc({
      id: 'doc-lease',
      fileName: 'Lease.pdf',
    })
    const roll = doc({
      id: 'doc-roll',
      fileName: 'Rent-Roll.xlsx',
      documentCategory: 'rent_roll',
      categoryGroup: 'financial',
    })
    const review = emptyReview({
      residents: [
        {
          id: 'ext-res-doc-lease-0',
          fullName: 'Jane Doe',
          unit: '4B',
          building: 'Maple Court',
          phone: '',
          email: '',
          leaseStart: '',
          leaseEnd: '',
          monthlyRent: '',
          rentDueDay: '',
          occupancyStatus: 'active',
          maintenanceResponsibilitiesClause: '',
          sourceDocumentName: 'Lease.pdf · Rent-Roll.xlsx',
          confidence: 90,
          selected: true,
          needsReview: false,
        },
      ],
    })

    expect(
      collectResidentLeaseDocuments([lease, roll], jane, review).map((row) => row.fileName),
    ).toEqual(['Lease.pdf'])
  })

  it('matches a move-in packet by uploaded document id on the review row', () => {
    const packet = doc({
      id: 'doc-movein',
      fileName: 'Move-In-Packet.pdf',
      documentCategory: 'move_in_document',
    })
    const review = emptyReview({
      leases: [
        {
          id: 'ext-lease-doc-movein-0',
          residentName: 'J. Doe',
          unit: '4B',
          building: 'Maple Court',
          leaseStart: '',
          leaseEnd: '',
          rentAmount: '',
          securityDeposit: '',
          sourceDocumentName: 'Move-In-Packet.pdf',
          confidence: 88,
          selected: true,
          needsReview: false,
        },
      ],
    })

    expect(collectResidentLeaseDocuments([packet], jane, review).map((row) => row.id)).toEqual([
      'doc-movein',
    ])
  })
})
