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
  documentCategory: OnboardingUploadedDocument['documentCategory'] = 'lease_agreement',
): OnboardingUploadedDocument {
  return {
    id,
    fileName,
    fileType: fileName.split('.').pop() ?? 'pdf',
    fileSize: 12,
    documentCategory,
    categoryGroup: documentCategory === 'rent_roll' || documentCategory === 'resident_roster'
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

  it('keeps two people with the same unit number in different buildings', () => {
    const merged = dedupeOnboardingExtractedResidents([
      resident({ id: 'a', fullName: 'Amy Chen', unit: '1A', building: 'Oak Apartments' }),
      resident({ id: 'b', fullName: 'Ben Diaz', unit: '1A', building: 'Pine Court' }),
    ])
    expect(merged).toHaveLength(2)
  })

  it('keeps two people with the same name in different units', () => {
    const merged = dedupeOnboardingExtractedResidents([
      resident({ id: 'a', fullName: 'John Smith', unit: '101' }),
      resident({ id: 'b', fullName: 'John Smith', unit: '102' }),
    ])
    expect(merged).toHaveLength(2)
  })

  it('merges a rent-roll row with a lease row when building labels differ', () => {
    const merged = dedupeOnboardingExtractedResidents([
      resident({
        id: 'res-roll',
        fullName: 'Smith Jane',
        unit: 'Apt 4B',
        building: 'Oak Apartments',
        phone: '(555) 010-0100',
        sourceDocumentName: 'rent-roll.xlsx',
      }),
      resident({
        id: 'res-lease',
        fullName: 'Jane Smith',
        unit: '4-B',
        building: '123 Oak Street, Newark NJ',
        leaseStart: '2024-01-01',
        leaseEnd: '2025-01-01',
        monthlyRent: '1850',
        sourceDocumentName: 'Unit 4B Lease.pdf',
      }),
    ])

    expect(merged).toHaveLength(1)
    expect(merged[0]?.fullName.toLowerCase()).toContain('jane')
    expect(merged[0]?.fullName.toLowerCase()).toContain('smith')
    expect(merged[0]?.phone.replace(/\D/g, '')).toContain('5550100100')
    expect(merged[0]?.leaseStart).toBe('2024-01-01')
    expect(merged[0]?.monthlyRent).toBe('1850')
  })

  it('merges when the lease has no building and the rent roll does', () => {
    const merged = dedupeOnboardingExtractedResidents([
      resident({
        id: 'res-roll',
        fullName: 'Alex Rivera',
        unit: '1A',
        building: '12 Maple Ave',
        sourceDocumentName: 'rent-roll.xlsx',
      }),
      resident({
        id: 'res-lease',
        fullName: 'Alex Rivera',
        unit: '1A',
        building: '',
        sourceDocumentName: 'Lease.pdf',
      }),
    ])
    expect(merged).toHaveLength(1)
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
          leases: [
            {
              residentName: 'Jane Smith',
              unit: '4B',
              building: 'Oak',
              leaseStart: '2024-01-01',
              leaseEnd: '2024-12-31',
              rentAmount: '1800',
              securityDeposit: '',
              confidence: 80,
            },
          ],
        }),
        'rent_roll',
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
    expect(review.leases[0]?.sourceDocumentName).toBe('Lease.pdf')
    expect(review.leases[0]?.sourceDocumentName.toLowerCase()).not.toContain('rent-roll')
  })

  it('never uses rent-roll extracts as Lease Information Found rows', () => {
    const review = buildOnboardingExtractionReview([
      uploadedDoc(
        'doc-roll',
        'Portfolio-Rent-Roll.xlsx',
        emptyPayload({
          residents: [
            {
              fullName: 'Ikea Vandross',
              unit: '2A',
              building: 'Oak',
              phone: '555-0199',
              email: '',
              leaseStart: '2024-01-01',
              leaseEnd: '2024-12-31',
              monthlyRent: '1600',
              confidence: 90,
            },
          ],
          leases: [
            {
              residentName: 'Ikea Vandross',
              unit: '2A',
              building: 'Oak',
              leaseStart: '2024-01-01',
              leaseEnd: '2024-12-31',
              rentAmount: '1600',
              securityDeposit: '',
              confidence: 88,
            },
            {
              residentName: 'Someone Else',
              unit: '3B',
              building: 'Oak',
              leaseStart: '2023-06-01',
              leaseEnd: '2024-05-31',
              rentAmount: '1700',
              securityDeposit: '',
              confidence: 85,
            },
          ],
        }),
        'rent_roll',
      ),
    ])

    expect(review.leases).toHaveLength(0)
    expect(review.residents.some((row) => row.fullName.includes('Ikea'))).toBe(true)
  })

  it('collapses tenant and co-tenant lease rows from one lease PDF into one agreement', () => {
    const review = buildOnboardingExtractionReview([
      uploadedDoc(
        'doc-lease',
        'Unit4B-Lease.pdf',
        emptyPayload({
          leases: [
            {
              residentName: 'Jane Smith',
              unit: '4B',
              building: 'Oak',
              leaseStart: '2024-01-01',
              leaseEnd: '2024-12-31',
              rentAmount: '1800',
              securityDeposit: '1800',
              confidence: 92,
            },
            {
              residentName: 'John Smith',
              unit: '4B',
              building: 'Oak',
              leaseStart: '2024-01-01',
              leaseEnd: '2024-12-31',
              rentAmount: '1800',
              securityDeposit: '1800',
              confidence: 88,
            },
            {
              residentName: 'Oak Management LLC',
              unit: '',
              building: 'Oak',
              leaseStart: '2024-01-01',
              leaseEnd: '2024-12-31',
              rentAmount: '',
              securityDeposit: '',
              confidence: 70,
            },
          ],
        }),
      ),
    ])

    expect(review.leases).toHaveLength(1)
    expect(review.leases[0]?.residentName.toLowerCase()).toContain('jane')
    expect(review.leases[0]?.unit).toMatch(/4B/i)
  })

  it('keeps one lease row per lease agreement when many PDFs each extract two parties', () => {
    const docs = Array.from({ length: 13 }, (_, index) =>
      uploadedDoc(
        `doc-${index}`,
        `Lease-Unit-${index + 1}.pdf`,
        emptyPayload({
          leases: [
            {
              residentName: `Tenant ${index + 1} Alpha`,
              unit: String(index + 1),
              building: 'Main',
              leaseStart: '2024-01-01',
              leaseEnd: '2024-12-31',
              rentAmount: '1500',
              securityDeposit: '1500',
              confidence: 90,
            },
            {
              residentName: `Tenant ${index + 1} Beta`,
              unit: String(index + 1),
              building: 'Main',
              leaseStart: '2024-01-01',
              leaseEnd: '2024-12-31',
              rentAmount: '1500',
              securityDeposit: '1500',
              confidence: 85,
            },
          ],
        }),
      ),
    )

    const review = buildOnboardingExtractionReview(docs)
    expect(review.leases).toHaveLength(13)
  })

  it('does not put a roster tenant onto someone else lease just because the unit matches', () => {
    const review = buildOnboardingExtractionReview([
      uploadedDoc(
        'doc-roll',
        'rent-roll.xlsx',
        emptyPayload({
          residents: [
            {
              fullName: 'Ikea Vandross',
              unit: '4B',
              building: 'Oak',
              phone: '555-0199',
              email: '',
              leaseStart: '',
              leaseEnd: '',
              monthlyRent: '',
              confidence: 90,
            },
          ],
        }),
        'rent_roll',
      ),
      uploadedDoc(
        'doc-lease',
        'Real-Tenant-Lease.pdf',
        emptyPayload({
          leases: [
            {
              residentName: 'Jordan Lee',
              unit: '4B',
              building: 'Oak',
              leaseStart: '2024-01-01',
              leaseEnd: '2024-12-31',
              rentAmount: '1800',
              securityDeposit: '1800',
              confidence: 94,
            },
          ],
          residents: [
            {
              fullName: 'Jordan Lee',
              unit: '4B',
              building: 'Oak',
              phone: '',
              email: '',
              leaseStart: '2024-01-01',
              leaseEnd: '2024-12-31',
              monthlyRent: '1800',
              confidence: 94,
            },
          ],
        }),
      ),
    ])

    expect(review.leases).toHaveLength(1)
    expect(review.leases[0]?.residentName.toLowerCase()).toContain('jordan')
    expect(review.leases[0]?.residentName.toLowerCase()).not.toContain('ikea')

    expect(review.residents).toHaveLength(1)
    expect(review.residents.some((row) => /jordan/i.test(row.fullName))).toBe(false)

    const ikea = review.residents.find((row) =>
      row.fullName.toLowerCase().includes('ikea'),
    )
    expect(ikea).toBeTruthy()
    expect(ikea?.leaseStart).toBe('')
    expect(ikea?.leaseEnd).toBe('')
    expect(ikea?.monthlyRent).toBe('')
    expect(review.needsReview.some((row) => row.dataType === 'unmatched_lease')).toBe(true)
  })

  it('collapses a rent-roll tenant and a lease tenant when property labels differ', () => {
    const review = buildOnboardingExtractionReview([
      uploadedDoc(
        'doc-roll',
        'rent-roll.xlsx',
        emptyPayload({
          residents: [
            {
              fullName: 'Alex Rivera',
              unit: '1A',
              building: 'Maple Court Apartments',
              phone: '973-555-0100',
              email: '',
              leaseStart: '',
              leaseEnd: '',
              monthlyRent: '2100',
              confidence: 94,
            },
          ],
        }),
        'rent_roll',
      ),
      uploadedDoc(
        'doc-lease',
        'Alex Rivera Lease.pdf',
        emptyPayload({
          residents: [
            {
              fullName: 'Alexandra Rivera',
              unit: 'Unit 1A',
              building: '12 Maple Court, Newark NJ',
              phone: '',
              email: '',
              leaseStart: '2023-09-01',
              leaseEnd: '2024-08-31',
              monthlyRent: '2100',
              confidence: 90,
            },
          ],
          leases: [
            {
              residentName: 'Alexandra Rivera',
              unit: '1A',
              building: '12 Maple Court',
              leaseStart: '2023-09-01',
              leaseEnd: '2024-08-31',
              rentAmount: '2100',
              securityDeposit: '2100',
              confidence: 91,
            },
          ],
        }),
      ),
    ])

    expect(review.residents).toHaveLength(1)
    expect(review.residents[0]?.fullName.toLowerCase()).toContain('alex')
    expect(review.residents[0]?.leaseStart).toBe('2023-09-01')
    expect(review.residents[0]?.phone.replace(/\D/g, '')).toContain('9735550100')
    expect(review.leases).toHaveLength(1)
    expect(review.leases[0]?.sourceDocumentName.toLowerCase()).not.toContain('rent-roll')
  })
})
