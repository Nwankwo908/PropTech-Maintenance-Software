import { describe, expect, it } from 'vitest'
import type { PortfolioDocumentExtractPayload } from '@/api/onboardingDocumentExtract'
import {
  buildOnboardingExtractionReview,
  collectExtractedAccount,
  fillExtractionReviewAccount,
  looksLikeExtractedCompanyName,
  normalizeExtractionReview,
  emptyExtractionReview,
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
  payload: PortfolioDocumentExtractPayload,
): OnboardingUploadedDocument {
  return {
    id,
    fileName: `${id}.pdf`,
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
    extractedPayload: payload,
  }
}

describe('looksLikeExtractedCompanyName', () => {
  it('accepts management-company names and rejects street addresses', () => {
    expect(looksLikeExtractedCompanyName('CEO Rentals NJ LLC')).toBe(true)
    expect(looksLikeExtractedCompanyName('Acme Property Management')).toBe(true)
    expect(looksLikeExtractedCompanyName('123 Main Street')).toBe(false)
    expect(looksLikeExtractedCompanyName('Maple Court')).toBe(false)
  })
})

describe('fast-track company name after extraction', () => {
  it('fills company name from the extracted landlord / account object', () => {
    const review = buildOnboardingExtractionReview([
      uploadedDoc(
        'lease',
        emptyPayload({
          account: { companyName: 'CEO Rentals NJ LLC', contactName: 'Alex Manager' },
          leases: [
            {
              residentName: 'Jane Smith',
              unit: '4B',
              building: '',
              leaseStart: '2024-01-01',
              leaseEnd: '2024-12-31',
              rentAmount: '1800',
              securityDeposit: '',
              confidence: 90,
            },
          ],
        }),
      ),
    ])
    expect(review.account.companyName).toBe('CEO Rentals NJ LLC')
    expect(review.account.contactName).toBe('Alex Manager')
  })

  it('does not copy a tenant name into company name', () => {
    const account = collectExtractedAccount(
      [
        emptyPayload({
          account: { companyName: 'Jane Smith' },
          residents: [
            {
              fullName: 'Jane Smith',
              unit: '4B',
              building: '',
              phone: '',
              email: '',
              leaseStart: '',
              leaseEnd: '',
              monthlyRent: '',
              confidence: 90,
            },
          ],
        }),
      ],
      ['Jane Smith'],
    )
    expect(account.companyName).toBe('')
  })

  it('infers company name from a company-like property name when account is missing', () => {
    const review = buildOnboardingExtractionReview([
      uploadedDoc(
        'roll',
        emptyPayload({
          properties: [
            {
              name: 'CEO Rentals NJ LLC',
              streetAddress: '100 Maple St',
              city: 'Newark',
              state: 'NJ',
              zipCode: '07102',
              propertyType: 'multifamily',
              unitCount: 4,
              confidence: 90,
            },
          ],
        }),
      ),
    ])
    expect(review.account.companyName).toBe('CEO Rentals NJ LLC')
  })

  it('keeps a profile company name over the extracted one', () => {
    const review = buildOnboardingExtractionReview(
      [
        uploadedDoc(
          'lease',
          emptyPayload({
            account: { companyName: 'Extracted LLC' },
          }),
        ),
      ],
      { companyName: 'Acme Properties', contactName: 'Alex' },
    )
    expect(review.account.companyName).toBe('Acme Properties')
    expect(review.account.contactName).toBe('Alex')
  })

  it('fills a persisted review that stored an empty company name', () => {
    const filled = fillExtractionReviewAccount(
      {
        ...emptyExtractionReview(),
        properties: [
          {
            id: 'ext-prop-1',
            name: 'Oakwood Properties LLC',
            address: '100 Maple St',
            city: 'Atlanta',
            state: 'GA',
            zipCode: '30301',
            propertyType: 'multifamily',
            unitCount: 4,
            unitLabels: '',
            propertyManagerName: '',
            propertyManagerPhone: '',
            sourceDocumentName: 'roll.xlsx',
            confidence: 90,
            selected: true,
            needsReview: false,
          },
        ],
      },
      [],
    )
    expect(filled.account.companyName).toBe('Oakwood Properties LLC')
  })

  it('normalizeExtractionReview still fills company from a company-like property', () => {
    const cleaned = normalizeExtractionReview({
      ...emptyExtractionReview(),
      properties: [
        {
          id: 'ext-prop-1',
          name: 'Harbor Management',
          address: '10 Dock St',
          city: 'Hoboken',
          state: 'NJ',
          zipCode: '07030',
          propertyType: 'multifamily',
          unitCount: 2,
          unitLabels: '',
          propertyManagerName: '',
          propertyManagerPhone: '',
          sourceDocumentName: 'lease.pdf',
          confidence: 88,
          selected: true,
          needsReview: false,
        },
      ],
    })
    expect(cleaned.account.companyName).toBe('Harbor Management')
  })
})
