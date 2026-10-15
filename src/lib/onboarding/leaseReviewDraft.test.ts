import { leaseScanToExtract, normalizeLeaseScan, type LeaseFieldName } from '@shared/onboarding/leaseScan'
import { leaseFixture } from '@shared/onboarding/leaseScan.fixtures'
import { describe, expect, it } from 'vitest'
import {
  buildOnboardingExtractionReview,
  normalizeExtractionReview,
  toMockExtractionReview,
  type OnboardingUploadedDocument,
} from '@/lib/onboardingDocumentUpload'
import { confirmDisplayedLeaseDraft, editLeaseReviewDraft, leaseDraftRequiredBlankMessage } from './leaseReviewDraft'

function scan(overrides: Partial<Record<LeaseFieldName, { status?: string; value?: unknown }>> = {}) {
  const raw = leaseFixture()
  for (const [name, patch] of Object.entries(overrides)) {
    raw.fields[name as LeaseFieldName] = { ...raw.fields[name as LeaseFieldName], ...patch }
  }
  return normalizeLeaseScan(raw, ['Lease terms']).review
}

function leaseDoc(review = scan()): OnboardingUploadedDocument {
  return {
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
      leaseReview: review,
    },
  }
}

describe('lease review drafts', () => {
  it('keeps unverified tenant and address on the draft and leaves verified rent unmarked', () => {
    const review = buildOnboardingExtractionReview([
      leaseDoc(
        scan({
          tenant_names: { status: 'uncertain', value: ['John Smith'] },
          property_address: { status: 'uncertain', value: '123 Main Street' },
        }),
      ),
    ])
    expect(review.residents[0]?.fullName).toBe('John Smith')
    expect(review.residents[0]?.fieldAttention?.fullName).toBe('needs_verification')
    expect(review.properties[0]?.address).toContain('123 Main Street')
    expect(review.properties[0]?.fieldAttention?.address).toBe('needs_verification')
    expect(review.residents[0]?.monthlyRent).toBe('1500')
    expect(review.residents[0]?.fieldAttention?.monthlyRent).toBe('verified')
    expect(review.leases[0]?.rentAmount).toBe('1500')
  })

  it('keeps verified rent, dates, and deposit when the tenant was not found', () => {
    const review = buildOnboardingExtractionReview([
      leaseDoc(
        scan({
          tenant_names: { status: 'not_stated', value: null },
        }),
      ),
    ])
    expect(review.residents).toHaveLength(1)
    expect(review.residents[0]?.fullName).toBe('')
    expect(review.residents[0]?.fieldAttention?.fullName).toBe('required')
    expect(leaseDraftRequiredBlankMessage(review)).toBe(
      'Enter the lease details marked Required before continuing.',
    )
    expect(review.leases[0]?.residentName).toBe('')
    expect(review.leases[0]?.fieldAttention?.residentName).toBe('required')
    expect(review.residents[0]?.monthlyRent).toBe('1500')
    expect(review.residents[0]?.fieldAttention?.monthlyRent).toBe('verified')
    expect(review.residents[0]?.leaseStart).toBe('2026-01-01')
    expect(review.residents[0]?.fieldAttention?.leaseStart).toBe('verified')
    expect(review.leases[0]?.securityDeposit).toBe('0')
    expect(review.leases[0]?.fieldAttention?.securityDeposit).toBe('verified')
    expect(toMockExtractionReview(review).residents).toHaveLength(0)
  })

  it('keeps the other lease values when the address was not found', () => {
    const review = buildOnboardingExtractionReview([
      leaseDoc(scan({ property_address: { status: 'not_stated', value: null } })),
    ])
    expect(review.properties).toHaveLength(1)
    expect(review.properties[0]?.address).toBe('')
    expect(review.properties[0]?.fieldAttention?.address).toBe('required')
    expect(review.residents[0]?.fullName).toBe('Morgan Tenant')
    expect(review.residents[0]?.monthlyRent).toBe('1500')
    expect(toMockExtractionReview(review).properties).toHaveLength(0)
    expect(toMockExtractionReview(review).residents[0]?.fullName).toBe('Morgan Tenant')
  })

  it('leaves an optional blank unit unflagged', () => {
    const review = buildOnboardingExtractionReview([
      leaseDoc(scan({ unit: { status: 'not_stated', value: null } })),
    ])
    expect(review.residents[0]?.unit).toBe('')
    expect(review.residents[0]?.fieldAttention?.unit).toBeUndefined()
    expect(review.residents[0]?.needsReview).toBe(false)
  })

  it('clears only the edited field', () => {
    const review = buildOnboardingExtractionReview([
      leaseDoc(
        scan({
          tenant_names: { status: 'uncertain', value: ['John Smith'] },
          property_address: { status: 'uncertain', value: '123 Main Street' },
        }),
      ),
    ])
    const residentId = review.residents[0]?.id ?? ''
    const edited = editLeaseReviewDraft(review, residentId, 'fullName', 'Jane Smith')
    expect(edited.residents[0]?.fullName).toBe('Jane Smith')
    expect(edited.residents[0]?.fieldAttention?.fullName).toBeUndefined()
    expect(edited.leases[0]?.residentName).toBe('Jane Smith')
    expect(edited.leases[0]?.fieldAttention?.residentName).toBeUndefined()
    expect(edited.properties[0]?.fieldAttention?.address).toBe('needs_verification')
    expect(edited.residents[0]?.fieldAttention?.monthlyRent).toBe('verified')
  })

  it('confirms an edited tenant and an unchanged address for import', () => {
    const review = buildOnboardingExtractionReview([
      leaseDoc(
        scan({
          tenant_names: { status: 'uncertain', value: ['John Smith'] },
          property_address: { status: 'uncertain', value: '123 Main St' },
        }),
      ),
    ])
    const residentId = review.residents[0]?.id ?? ''
    const edited = editLeaseReviewDraft(review, residentId, 'fullName', 'Jonathan Smith')
    expect(edited.residents[0]?.fieldAttention?.fullName).toBeUndefined()
    expect(edited.leases[0]?.fieldAttention?.residentName).toBeUndefined()
    expect(edited.properties[0]?.fieldAttention?.address).toBe('needs_verification')
    expect(edited.residents[0]?.fieldAttention?.monthlyRent).toBe('verified')
    expect(leaseDraftRequiredBlankMessage(edited)).toBeNull()

    const confirmed = normalizeExtractionReview(confirmDisplayedLeaseDraft(edited))
    const portfolio = toMockExtractionReview(confirmed)
    expect(confirmed.residents[0]?.fullName).toBe('Jonathan Smith')
    expect(confirmed.properties[0]?.address).toContain('123 Main')
    expect(confirmed.residents[0]?.fieldAttention?.fullName).toBeUndefined()
    expect(confirmed.properties[0]?.fieldAttention?.address).toBeUndefined()
    expect(portfolio.residents[0]?.fullName).toBe('Jonathan Smith')
    expect(portfolio.residents[0]?.monthlyRent).toBe('1500')
    expect(portfolio.properties[0]?.address).toContain('123 Main')
    expect(JSON.stringify(portfolio)).not.toContain('fieldAttention')
    expect(JSON.stringify(portfolio)).not.toContain('needs_verification')
  })

  it('does not accept a required blank when the rest of the draft is confirmed', () => {
    const review = buildOnboardingExtractionReview([
      leaseDoc(
        scan({
          tenant_names: { status: 'uncertain', value: ['John Smith'] },
          property_address: { status: 'not_stated', value: null },
        }),
      ),
    ])
    const confirmed = confirmDisplayedLeaseDraft(review)
    expect(leaseDraftRequiredBlankMessage(review)).toBe(
      'Enter the lease details marked Required before continuing.',
    )
    expect(leaseDraftRequiredBlankMessage(confirmed)).toBe(
      'Enter the lease details marked Required before continuing.',
    )
    expect(confirmed.residents).toHaveLength(1)
    expect(confirmed.residents[0]?.fullName).toBe('John Smith')
    expect(confirmed.residents[0]?.fieldAttention?.fullName).toBeUndefined()
    expect(confirmed.properties[0]?.fieldAttention?.address).toBe('required')
    expect(toMockExtractionReview(confirmed).residents[0]?.fullName).toBe('John Smith')
    expect(toMockExtractionReview(confirmed).properties).toHaveLength(0)
  })

  it('does not let an uncertain lease replace a rent-roll resident', () => {
    const review = buildOnboardingExtractionReview([
      {
        ...leaseDoc(),
        id: 'doc-roll',
        fileName: 'rent-roll.xlsx',
        documentCategory: 'rent_roll',
        categoryGroup: 'financial',
        extractedPayload: {
          properties: [
            {
              name: '109 S Grove St',
              streetAddress: '109 S Grove St',
              city: 'East Orange',
              state: 'NJ',
              zipCode: '07018',
              propertyType: 'multifamily',
              unitCount: 1,
              confidence: 95,
            },
          ],
          units: [{ label: 'A', building: '109 S Grove St', confidence: 95 }],
          residents: [
            {
              fullName: 'Jane Roll',
              unit: 'A',
              building: '109 S Grove St',
              phone: '',
              email: '',
              leaseStart: '2026-01-01',
              leaseEnd: '2026-12-31',
              monthlyRent: '1800',
              confidence: 95,
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
      leaseDoc(
        scan({
          tenant_names: { status: 'uncertain', value: ['John Smith'] },
          monthly_rent: { status: 'found', value: 1500 },
          property_address: { status: 'uncertain', value: '123 Main Street' },
        }),
      ),
    ])
    expect(review.residents.map((row) => row.fullName)).toEqual(['Jane Roll'])
    expect(review.residents[0]?.monthlyRent).toBe('1800')
    expect(review.properties.some((row) => row.address.includes('Main Street'))).toBe(false)
  })

  it('still withholds unverified values from the trusted lease extract', () => {
    const raw = leaseFixture()
    raw.fields.monthly_rent = { ...raw.fields.monthly_rent, status: 'uncertain', value: 1500 }
    const normalized = normalizeLeaseScan(raw, ['Lease terms'])
    expect(leaseScanToExtract(normalized.review, normalized.extract).monthly_rent).toBeNull()
    expect(normalized.review.fields.monthly_rent.value).toBe(1500)
  })
})
