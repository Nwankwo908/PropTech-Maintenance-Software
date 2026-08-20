import { describe, expect, it } from 'vitest'
import type { PortfolioDocumentExtractPayload } from '@/api/onboardingDocumentExtract'
import {
  buildOnboardingExtractionReview,
  classifyOnboardingDocumentExtractRole,
  inferDocumentCategory,
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
  documentCategory: OnboardingUploadedDocument['documentCategory'],
): OnboardingUploadedDocument {
  return {
    id,
    fileName,
    fileType: fileName.split('.').pop() ?? 'pdf',
    fileSize: 12,
    documentCategory,
    categoryGroup:
      documentCategory === 'rent_roll' || documentCategory === 'resident_roster'
        ? 'financial'
        : 'resident',
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

describe('rent roll vs lease agreement source of truth', () => {
  it('1. rent roll creates properties, units, and residents', () => {
    const review = buildOnboardingExtractionReview([
      uploadedDoc(
        'roll',
        'rent-roll.xlsx',
        emptyPayload({
          properties: [
            {
              name: '109 S Grove St',
              streetAddress: '109 S Grove St',
              city: 'East Orange',
              state: 'NJ',
              zipCode: '07018',
              propertyType: 'multifamily',
              unitCount: 2,
              confidence: 95,
            },
          ],
          units: [
            { label: 'A', building: '109 S Grove St', confidence: 95 },
            { label: 'B', building: '109 S Grove St', confidence: 95 },
          ],
          residents: [
            {
              fullName: 'Saad Ahmed',
              unit: 'A',
              building: '109 S Grove St',
              phone: '555-0100',
              email: '',
              leaseStart: '',
              leaseEnd: '',
              monthlyRent: '1800',
              confidence: 95,
            },
          ],
        }),
        'rent_roll',
      ),
    ])

    expect(review.properties.some((row) => row.name.includes('Grove'))).toBe(true)
    expect(review.units.some((row) => /A/i.test(row.label))).toBe(true)
    expect(review.residents).toHaveLength(1)
    expect(review.residents[0]?.fullName).toMatch(/Saad/i)
  })

  it('2–3. lease only does not independently create residents, units, or properties', () => {
    const review = buildOnboardingExtractionReview([
      uploadedDoc(
        'lease',
        'Unit-B-Lease.pdf',
        emptyPayload({
          properties: [
            {
              name: '109 S Grove St',
              streetAddress: '109 S Grove St',
              city: 'East Orange',
              state: 'NJ',
              zipCode: '07018',
              propertyType: 'multifamily',
              unitCount: 1,
              confidence: 90,
            },
          ],
          units: [{ label: 'B', building: '109 S Grove St', confidence: 90 }],
          residents: [
            {
              fullName: 'John Smith',
              unit: 'B',
              building: '109 S Grove St',
              phone: '',
              email: '',
              leaseStart: '2026-01-01',
              leaseEnd: '2026-12-31',
              monthlyRent: '1700',
              confidence: 90,
            },
          ],
          leases: [
            {
              residentName: 'John Smith',
              unit: 'B',
              building: '109 S Grove St',
              leaseStart: '2026-01-01',
              leaseEnd: '2026-12-31',
              rentAmount: '1700',
              securityDeposit: '1700',
              confidence: 90,
            },
          ],
        }),
        'lease_agreement',
      ),
    ])

    expect(review.residents).toHaveLength(0)
    expect(review.properties).toHaveLength(0)
    expect(review.units).toHaveLength(0)
    expect(review.leases).toHaveLength(1)
    expect(review.leases[0]?.residentName).toMatch(/John/i)
    expect(
      review.needsReview.some((row) => row.dataType === 'unmatched_lease'),
    ).toBe(true)
  })

  it('4 + 7. same tenant on rent roll + lease merges into one enriched resident', () => {
    const review = buildOnboardingExtractionReview([
      uploadedDoc(
        'roll',
        'rent-roll.xlsx',
        emptyPayload({
          residents: [
            {
              fullName: 'Saad Ahmed',
              unit: 'A',
              building: '109 S Grove St',
              phone: '555-0100',
              email: '',
              leaseStart: '',
              leaseEnd: '',
              monthlyRent: '1800',
              confidence: 95,
            },
          ],
          units: [{ label: 'A', building: '109 S Grove St', confidence: 95 }],
        }),
        'rent_roll',
      ),
      uploadedDoc(
        'lease',
        'Saad-Ahmed-Lease.pdf',
        emptyPayload({
          residents: [
            {
              fullName: 'Saad Ahmed',
              unit: 'A',
              building: '109 S Grove St',
              phone: '',
              email: '',
              leaseStart: '2026-01-01',
              leaseEnd: '2026-12-31',
              monthlyRent: '1800',
              confidence: 92,
            },
          ],
          leases: [
            {
              residentName: 'Saad Ahmed',
              unit: 'A',
              building: '109 S Grove St',
              leaseStart: '2026-01-01',
              leaseEnd: '2026-12-31',
              rentAmount: '1800',
              securityDeposit: '1800',
              confidence: 92,
            },
          ],
        }),
        'lease_agreement',
      ),
    ])

    expect(review.residents).toHaveLength(1)
    expect(review.residents[0]?.fullName).toMatch(/Saad/i)
    expect(review.residents[0]?.leaseStart).toBe('2026-01-01')
    expect(review.residents[0]?.leaseEnd).toBe('2026-12-31')
    expect(review.residents[0]?.monthlyRent).toBe('1800')
    expect(review.leases).toHaveLength(1)
  })

  it('5. lease tenant not on rent roll is not added as a resident', () => {
    const review = buildOnboardingExtractionReview([
      uploadedDoc(
        'roll',
        'rent-roll.xlsx',
        emptyPayload({
          residents: [
            {
              fullName: 'Saad Ahmed',
              unit: 'A',
              building: '109 S Grove St',
              phone: '',
              email: '',
              leaseStart: '',
              leaseEnd: '',
              monthlyRent: '1800',
              confidence: 95,
            },
          ],
          units: [{ label: 'A', building: '109 S Grove St', confidence: 95 }],
        }),
        'rent_roll',
      ),
      uploadedDoc(
        'lease',
        'John-Smith-Lease.pdf',
        emptyPayload({
          residents: [
            {
              fullName: 'John Smith',
              unit: 'B',
              building: '109 S Grove St',
              phone: '',
              email: '',
              leaseStart: '2026-01-01',
              leaseEnd: '2026-12-31',
              monthlyRent: '1700',
              confidence: 90,
            },
          ],
          units: [{ label: 'B', building: '109 S Grove St', confidence: 90 }],
          leases: [
            {
              residentName: 'John Smith',
              unit: 'B',
              building: '109 S Grove St',
              leaseStart: '2026-01-01',
              leaseEnd: '2026-12-31',
              rentAmount: '1700',
              securityDeposit: '',
              confidence: 90,
            },
          ],
        }),
        'lease_agreement',
      ),
    ])

    expect(review.residents).toHaveLength(1)
    expect(review.residents[0]?.fullName).toMatch(/Saad/i)
    expect(review.residents.some((row) => /John/i.test(row.fullName))).toBe(false)
    expect(review.units.some((row) => /B/i.test(row.label))).toBe(false)
    expect(review.needsReview.some((row) => row.dataType === 'unmatched_lease')).toBe(true)
  })

  it('6. rent-roll resident without a lease remains valid', () => {
    const review = buildOnboardingExtractionReview([
      uploadedDoc(
        'roll',
        'rent-roll.xlsx',
        emptyPayload({
          residents: [
            {
              fullName: 'Saad Ahmed',
              unit: 'A',
              building: '109 S Grove St',
              phone: '555-0100',
              email: '',
              leaseStart: '',
              leaseEnd: '',
              monthlyRent: '1800',
              confidence: 95,
            },
          ],
        }),
        'rent_roll',
      ),
    ])

    expect(review.residents).toHaveLength(1)
    expect(review.residents[0]?.selected).toBe(true)
    expect(review.leases).toHaveLength(0)
  })

  it('8. minor name formatting differences still match with property/unit evidence', () => {
    const review = buildOnboardingExtractionReview([
      uploadedDoc(
        'roll',
        'rent-roll.xlsx',
        emptyPayload({
          residents: [
            {
              fullName: 'Smith, John',
              unit: 'Unit 2A',
              building: 'Oak Apartments',
              phone: '',
              email: '',
              leaseStart: '',
              leaseEnd: '',
              monthlyRent: '1600',
              confidence: 90,
            },
          ],
        }),
        'rent_roll',
      ),
      uploadedDoc(
        'lease',
        'Lease.pdf',
        emptyPayload({
          leases: [
            {
              residentName: 'John A. Smith',
              unit: '2A',
              building: '123 Oak Street',
              leaseStart: '2025-01-01',
              leaseEnd: '2025-12-31',
              rentAmount: '1600',
              securityDeposit: '',
              confidence: 90,
            },
          ],
        }),
        'lease_agreement',
      ),
    ])

    expect(review.residents).toHaveLength(1)
    expect(review.residents[0]?.leaseStart).toBe('2025-01-01')
    expect(review.residents[0]?.fullName.toLowerCase()).toContain('john')
  })

  it('9. same name at different units does not merge', () => {
    const review = buildOnboardingExtractionReview([
      uploadedDoc(
        'roll',
        'rent-roll.xlsx',
        emptyPayload({
          residents: [
            {
              fullName: 'John Smith',
              unit: '101',
              building: 'Oak',
              phone: '',
              email: '',
              leaseStart: '',
              leaseEnd: '',
              monthlyRent: '1500',
              confidence: 90,
            },
            {
              fullName: 'John Smith',
              unit: '102',
              building: 'Oak',
              phone: '',
              email: '',
              leaseStart: '',
              leaseEnd: '',
              monthlyRent: '1550',
              confidence: 90,
            },
          ],
        }),
        'rent_roll',
      ),
    ])

    expect(review.residents).toHaveLength(2)
  })

  it('10. conflicting rent amounts are surfaced instead of silently overwritten', () => {
    const review = buildOnboardingExtractionReview([
      uploadedDoc(
        'roll',
        'rent-roll.xlsx',
        emptyPayload({
          residents: [
            {
              fullName: 'Saad Ahmed',
              unit: 'A',
              building: '109 S Grove St',
              phone: '',
              email: '',
              leaseStart: '',
              leaseEnd: '',
              monthlyRent: '1800',
              confidence: 95,
            },
          ],
        }),
        'rent_roll',
      ),
      uploadedDoc(
        'lease',
        'Lease.pdf',
        emptyPayload({
          leases: [
            {
              residentName: 'Saad Ahmed',
              unit: 'A',
              building: '109 S Grove St',
              leaseStart: '2026-01-01',
              leaseEnd: '2026-12-31',
              rentAmount: '1650',
              securityDeposit: '',
              confidence: 90,
            },
          ],
        }),
        'lease_agreement',
      ),
    ])

    expect(review.residents).toHaveLength(1)
    expect(review.residents[0]?.monthlyRent).toBe('1800')
    expect(review.residents[0]?.leaseStart).toBe('2026-01-01')
    expect(review.residents[0]?.needsReview).toBe(true)
    const conflict = review.needsReview.find((row) => row.dataType === 'rent_amount_conflict')
    expect(conflict?.label).toMatch(/Rent amount differs/i)
    expect(conflict?.value).toContain('1800')
    expect(conflict?.value).toContain('1650')
  })

  it('11. multiple leases for one resident do not create duplicates', () => {
    const review = buildOnboardingExtractionReview([
      uploadedDoc(
        'roll',
        'rent-roll.xlsx',
        emptyPayload({
          residents: [
            {
              fullName: 'Saad Ahmed',
              unit: 'A',
              building: 'Grove',
              phone: '',
              email: '',
              leaseStart: '',
              leaseEnd: '',
              monthlyRent: '1800',
              confidence: 95,
            },
          ],
        }),
        'rent_roll',
      ),
      uploadedDoc(
        'lease-1',
        'Lease-Page-1.pdf',
        emptyPayload({
          leases: [
            {
              residentName: 'Saad Ahmed',
              unit: 'A',
              building: 'Grove',
              leaseStart: '2026-01-01',
              leaseEnd: '2026-12-31',
              rentAmount: '1800',
              securityDeposit: '',
              confidence: 90,
            },
          ],
        }),
        'lease_agreement',
      ),
      uploadedDoc(
        'lease-2',
        'Lease-Page-2.pdf',
        emptyPayload({
          leases: [
            {
              residentName: 'Saad Ahmed',
              unit: 'A',
              building: 'Grove',
              leaseStart: '2026-01-01',
              leaseEnd: '2026-12-31',
              rentAmount: '1800',
              securityDeposit: '1800',
              confidence: 88,
            },
          ],
        }),
        'lease_agreement',
      ),
    ])

    expect(review.residents).toHaveLength(1)
    expect(review.residents[0]?.leaseStart).toBe('2026-01-01')
  })

  it('12. each uploaded document is classified independently', () => {
    const roll = uploadedDoc('a', 'April-Rent-Roll.xlsx', emptyPayload(), 'unknown')
    const lease = uploadedDoc('b', 'Unit-4B-Lease-Agreement.pdf', emptyPayload(), 'unknown')
    const mystery = uploadedDoc('c', 'misc-notes.pdf', emptyPayload(), 'unknown')

    expect(classifyOnboardingDocumentExtractRole(roll)).toBe('rent_roll')
    expect(classifyOnboardingDocumentExtractRole(lease)).toBe('lease_agreement')
    expect(classifyOnboardingDocumentExtractRole(mystery)).toBe('unknown')
    expect(inferDocumentCategory('tenant roster.csv')).toBe('rent_roll')
  })

  it('13. unknown document type is flagged for review instead of creating portfolio rows', () => {
    const review = buildOnboardingExtractionReview([
      uploadedDoc(
        'mystery',
        'unclear-file.pdf',
        emptyPayload({
          residents: [
            {
              fullName: 'Ghost Tenant',
              unit: '9Z',
              building: 'Mystery Place',
              phone: '',
              email: '',
              leaseStart: '',
              leaseEnd: '',
              monthlyRent: '999',
              confidence: 80,
            },
          ],
          properties: [
            {
              name: 'Mystery Place',
              streetAddress: '1 Nowhere',
              city: 'Newark',
              state: 'NJ',
              zipCode: '07102',
              propertyType: 'multifamily',
              unitCount: 1,
              confidence: 80,
            },
          ],
          units: [{ label: '9Z', building: 'Mystery Place', confidence: 80 }],
        }),
        'unknown',
      ),
    ])

    expect(review.residents).toHaveLength(0)
    expect(review.properties).toHaveLength(0)
    expect(review.units).toHaveLength(0)
    expect(
      review.needsReview.some((row) => row.dataType === 'unknown_document_type'),
    ).toBe(true)
  })

  it('14–15. canonical rent-roll resident id is reused when lease enriches; no duplicates', () => {
    const review = buildOnboardingExtractionReview([
      uploadedDoc(
        'roll',
        'rent-roll.xlsx',
        emptyPayload({
          residents: [
            {
              fullName: 'Alex Rivera',
              unit: '1A',
              building: 'Maple Court',
              phone: '973-555-0100',
              email: '',
              leaseStart: '',
              leaseEnd: '',
              monthlyRent: '2000',
              confidence: 94,
            },
          ],
        }),
        'rent_roll',
      ),
      uploadedDoc(
        'lease',
        'Alex-Lease.pdf',
        emptyPayload({
          residents: [
            {
              fullName: 'Alex Rivera',
              unit: '1A',
              building: 'Maple Court',
              phone: '',
              email: '',
              leaseStart: '2024-02-01',
              leaseEnd: '2025-01-31',
              monthlyRent: '2000',
              confidence: 91,
            },
          ],
          leases: [
            {
              residentName: 'Alex Rivera',
              unit: '1A',
              building: 'Maple Court',
              leaseStart: '2024-02-01',
              leaseEnd: '2025-01-31',
              rentAmount: '2000',
              securityDeposit: '',
              confidence: 91,
            },
          ],
        }),
        'lease_agreement',
      ),
    ])

    expect(review.residents).toHaveLength(1)
    expect(review.residents[0]?.id).toMatch(/^ext-res-roll-/)
    expect(review.residents[0]?.phone).toContain('973')
    expect(review.residents[0]?.leaseStart).toBe('2024-02-01')
  })
})
