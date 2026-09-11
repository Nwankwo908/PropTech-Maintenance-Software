import { describe, expect, it } from 'vitest'
import {
  orderLeaseDates,
  placeAccountFields,
  placeLandlordAndTenants,
  placePhoneEmail,
  placePropertyAddressFields,
} from '@shared/onboarding/typedDocumentExtract/placeFields'
import type { PortfolioDocumentExtractPayload } from '@/api/onboardingDocumentExtract'
import {
  buildOnboardingExtractionReview,
  type OnboardingUploadedDocument,
} from '../onboardingDocumentUpload'

function uploadedDoc(payload: Partial<PortfolioDocumentExtractPayload>): OnboardingUploadedDocument {
  return {
    id: 'lease',
    fileName: 'lease.pdf',
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
      ...payload,
    },
  }
}

describe('placePropertyAddressFields', () => {
  it('splits a full mailing line out of street into city, state, and ZIP', () => {
    expect(
      placePropertyAddressFields({
        name: 'Oak Apartments',
        streetAddress: '123 Oak Street, Newark NJ 07102',
      }),
    ).toEqual({
      name: 'Oak Apartments',
      streetAddress: '123 Oak Street',
      city: 'Newark',
      state: 'NJ',
      zipCode: '07102',
    })
  })

  it('maps New Jersey to NJ instead of NE', () => {
    expect(
      placePropertyAddressFields({
        name: '109 S Grove St',
        streetAddress: '109 S Grove St',
        city: 'Newark',
        state: 'New Jersey',
        zipCode: '07112',
      }).state,
    ).toBe('NJ')
  })

  it('swaps city and state when they were reversed', () => {
    const placed = placePropertyAddressFields({
      streetAddress: '100 Main St',
      city: 'NJ',
      state: 'Newark',
      zipCode: '07102',
    })
    expect(placed.city).toBe('Newark')
    expect(placed.state).toBe('NJ')
  })

  it('moves a state name out of the city field', () => {
    expect(
      placePropertyAddressFields({
        streetAddress: '123 Oak Street, Newark, NJ 07102',
        city: 'New Jersey',
        state: '',
        zipCode: '',
      }),
    ).toMatchObject({
      streetAddress: '123 Oak Street',
      city: 'Newark',
      state: 'NJ',
      zipCode: '07102',
    })
  })

  it('moves a state code out of the city field', () => {
    expect(
      placePropertyAddressFields({
        streetAddress: '100 Main St',
        city: 'NJ',
        state: '',
        zipCode: '07102',
      }),
    ).toMatchObject({
      city: '',
      state: 'NJ',
      zipCode: '07102',
    })
  })

  it('splits city when it contains city and state together', () => {
    expect(
      placePropertyAddressFields({
        streetAddress: '100 Main St',
        city: 'Newark, NJ',
        state: '',
        zipCode: '07102',
      }),
    ).toMatchObject({
      city: 'Newark',
      state: 'NJ',
    })
  })
})

describe('placeAccountFields', () => {
  it('does not copy an LLC into Your name', () => {
    expect(
      placeAccountFields({
        companyName: 'CEO Rentals NJ LLC',
        contactName: 'CEO Rentals NJ LLC',
      }),
    ).toEqual({
      companyName: 'CEO Rentals NJ LLC',
      contactName: '',
      email: '',
      phone: '',
    })
  })

  it('puts an individual landlord in Your name, not company', () => {
    expect(placeAccountFields({ companyName: 'Maria Chen' })).toEqual({
      companyName: '',
      contactName: 'Maria Chen',
      email: '',
      phone: '',
    })
  })

  it('swaps phone and email when they landed in each other', () => {
    expect(placePhoneEmail('owner@acme.com', '973-555-0100')).toEqual({
      phone: '973-555-0100',
      email: 'owner@acme.com',
    })
  })
})

describe('placeLandlordAndTenants', () => {
  it('swaps a person landlord with an LLC tenant', () => {
    expect(
      placeLandlordAndTenants({
        landlordName: 'Jane Smith',
        tenantNames: ['Grove Holdings LLC'],
      }),
    ).toEqual({
      landlordName: 'Grove Holdings LLC',
      tenantNames: ['Jane Smith'],
    })
  })

  it('keeps an LLC landlord and a person tenant', () => {
    expect(
      placeLandlordAndTenants({
        landlordName: 'Grove Holdings LLC',
        tenantNames: ['Jane Smith'],
      }),
    ).toEqual({
      landlordName: 'Grove Holdings LLC',
      tenantNames: ['Jane Smith'],
    })
  })
})

describe('orderLeaseDates', () => {
  it('swaps start and end when they were reversed', () => {
    expect(orderLeaseDates('2026-12-31', '2026-01-01')).toEqual({
      start: '2026-01-01',
      end: '2026-12-31',
    })
  })
})

describe('fast-track review field placement', () => {
  it('shows city, state, and ZIP in their own fields after extraction', () => {
    const review = buildOnboardingExtractionReview([
      uploadedDoc({
        properties: [
          {
            name: '123 Oak Street, Newark, NJ 07102',
            streetAddress: '123 Oak Street, Newark, NJ 07102',
            city: '',
            state: '',
            zipCode: '',
            propertyType: 'single_family_home',
            unitCount: 1,
            confidence: 90,
          },
        ],
      }),
    ])
    expect(review.properties[0]?.name).toBe('123 Oak Street')
    expect(review.properties[0]?.address).toBe('123 Oak Street')
    expect(review.properties[0]?.city).toBe('Newark')
    expect(review.properties[0]?.state).toBe('NJ')
    expect(review.properties[0]?.zipCode).toBe('07102')
  })

  it('puts the landlord company in the account and the person in the tenant row', () => {
    const review = buildOnboardingExtractionReview([
      uploadedDoc({
        account: {
          companyName: 'Jane Smith',
          contactName: 'Jane Smith',
          email: '',
          phone: '',
        },
        residents: [
          {
            fullName: 'Grove Holdings LLC',
            unit: '4B',
            building: '',
            phone: '',
            email: '',
            leaseStart: '2024-01-01',
            leaseEnd: '2024-12-31',
            monthlyRent: '1800',
            confidence: 90,
          },
        ],
        leases: [
          {
            residentName: 'Grove Holdings LLC',
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
    ])
    expect(review.account.companyName).toBe('Grove Holdings LLC')
    expect(review.account.contactName).toBe('')
    expect(review.residents.map((row) => row.fullName)).toEqual(['Jane Smith'])
    expect(review.leases.map((row) => row.residentName)).toEqual(['Jane Smith'])
  })
})
