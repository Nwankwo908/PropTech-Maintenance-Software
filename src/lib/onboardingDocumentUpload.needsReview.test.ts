import { describe, expect, it } from 'vitest'
import {
  buildFlaggedExtractionReviewItems,
  emptyExtractionReview,
  listNeedsReviewSectionItems,
  toggleExtractionReviewItem,
} from './onboardingDocumentUpload'

describe('buildFlaggedExtractionReviewItems', () => {
  it('includes extracted entities marked needsReview', () => {
    const review = {
      ...emptyExtractionReview(),
      properties: [
        {
          id: 'ext-prop-doc-0',
          name: 'Oak Apartments',
          address: '123 Main',
          city: '',
          state: '',
          zipCode: '',
          propertyType: 'multifamily',
          unitCount: 2,
          unitLabels: '',
          propertyManagerName: '',
          propertyManagerPhone: '',
          sourceDocumentName: 'rent-roll.xlsx',
          confidence: 60,
          selected: false,
          needsReview: true,
        },
      ],
      residents: [
        {
          id: 'ext-res-doc-1',
          fullName: 'Jamie Tenant',
          unit: '',
          building: 'Oak Apartments',
          phone: '',
          email: '',
          leaseStart: '',
          leaseEnd: '',
          monthlyRent: '',
          rentDueDay: '',
          occupancyStatus: 'active' as const,
          maintenanceResponsibilitiesClause: '',
          sourceDocumentName: 'rent-roll.xlsx',
          confidence: 90,
          selected: false,
          needsReview: true,
        },
      ],
    }

    const flagged = buildFlaggedExtractionReviewItems(review)
    expect(flagged).toHaveLength(2)
    expect(flagged.map((item) => item.dataType)).toEqual(['flagged_property', 'flagged_resident'])
  })

  it('includes low-confidence units and extraction warnings in the needs review section list', () => {
    const review = {
      ...emptyExtractionReview(),
      units: [
        {
          id: 'ext-unit-doc-0',
          label: '101',
          building: 'Oak Apartments',
          sourceDocumentName: 'rent-roll.xlsx',
          confidence: 50,
          selected: false,
        },
      ],
      needsReview: [
        {
          id: 'ext-warn-doc-0',
          uploadedDocumentId: 'doc',
          sourceDocumentName: 'rent-roll.xlsx',
          dataType: 'warning',
          label: 'Extraction note',
          value: 'Some rows were partially illegible.',
          confidence: 100,
          includeInImport: false,
          needsReview: true,
        },
      ],
    }

    const combined = listNeedsReviewSectionItems(review)
    expect(combined).toHaveLength(2)
    expect(combined.map((item) => item.dataType)).toEqual(['warning', 'flagged_unit'])
  })
})

describe('toggleExtractionReviewItem', () => {
  it('toggles selected on flagged entity rows', () => {
    const review = {
      ...emptyExtractionReview(),
      residents: [
        {
          id: 'ext-res-doc-0',
          fullName: 'Jamie Tenant',
          unit: '101',
          building: 'Oak Apartments',
          phone: '',
          email: '',
          leaseStart: '',
          leaseEnd: '',
          monthlyRent: '',
          rentDueDay: '',
          occupancyStatus: 'active' as const,
          maintenanceResponsibilitiesClause: '',
          sourceDocumentName: 'rent-roll.xlsx',
          confidence: 60,
          selected: false,
          needsReview: true,
        },
      ],
    }

    const next = toggleExtractionReviewItem(review, 'ext-res-doc-0')
    expect(next.residents[0]?.selected).toBe(true)
  })
})
