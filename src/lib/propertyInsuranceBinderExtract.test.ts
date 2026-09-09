import { describe, expect, it } from 'vitest'
import { mapPortfolioInsuranceToPropertyFields } from './propertyInsuranceBinderExtract'
import type { PortfolioDocumentExtractPayload } from '@/api/onboardingDocumentExtract'

function emptyPayload(
  patch: Partial<PortfolioDocumentExtractPayload>,
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

describe('mapPortfolioInsuranceToPropertyFields', () => {
  it('maps a dwelling policy without treating it as a COI', () => {
    const extracted = mapPortfolioInsuranceToPropertyFields(
      emptyPayload({
        extractKind: 'dwelling_policy_declarations',
        dwellingPolicy: {
          document_type: 'dwelling_policy_declarations',
          insurer_name: 'American Integrity Insurance Company',
          policy_number: 'ADC0931778',
          producer_agency_name: 'Kirstein Insurance Agency, LLC',
          named_insured_primary: 'Ifunanya Okafor',
          occupancy_type: 'Tenant',
          mortgagee_name: 'CMG Mortgage Inc ISAOA ATIMA',
          insured_property_address: '563 Springdale Cir, Palm Springs, FL 33461-1533',
          date_issued: '2026-05-04',
          policy_effective_date: '2026-06-27',
          policy_expiration_date: '2027-06-27',
          coverage_c_personal_property_limit: 0,
        },
        insuranceCertificate: {
          named_insured: 'Ifunanya Okafor',
          certificate_holder: 'Should not be used',
          additional_insured: ['Someone'],
          producer_agency: 'Kirstein Insurance Agency, LLC',
          insurers: [{ name: 'Wrong COI Carrier', policy_number: 'COI-1' }],
          policy_number: 'COI-1',
          effective_date: '2026-01-01',
          expiration_date: '2027-01-01',
          certificate_date: '2026-05-04',
          confidence: 90,
          warnings: [],
        },
      }),
    )
    expect(extracted.carrier).toBe('American Integrity Insurance Company')
    expect(extracted.policyNumber).toBe('ADC0931778')
    expect(extracted.coverageStartDate).toBe('2026-06-27')
    expect(extracted.coverageEndDate).toBe('2027-06-27')
    expect(extracted.coverageStartDate).not.toBe('2026-05-04')
    expect(extracted.additionalInsured).toBe(false)
    expect(extracted.claimsContactName).toBe('')
  })

  it('maps a COI using policy dates, not the certificate issue date', () => {
    const extracted = mapPortfolioInsuranceToPropertyFields(
      emptyPayload({
        extractKind: 'insurance_certificate',
        insuranceCertificate: {
          named_insured: 'Flex Plumbing LLC',
          certificate_holder: 'Ulo Home Inc',
          additional_insured: ['Ulo Home Inc'],
          producer_agency: 'Harbor Agency',
          insurers: [{ name: 'Hartford', policy_number: 'GL-1' }],
          policy_number: null,
          effective_date: '2026-01-01',
          expiration_date: '2027-01-01',
          certificate_date: '2026-03-15',
          confidence: 90,
          warnings: [],
        },
      }),
    )
    expect(extracted.carrier).toBe('Hartford')
    expect(extracted.policyNumber).toBe('GL-1')
    expect(extracted.coverageStartDate).toBe('2026-01-01')
    expect(extracted.coverageEndDate).toBe('2027-01-01')
    expect(extracted.additionalInsured).toBe(true)
  })

  it('does not keep an empty COI over dwelling policy fields', () => {
    const extracted = mapPortfolioInsuranceToPropertyFields(
      emptyPayload({
        extractKind: 'insurance_certificate',
        insuranceCertificate: {
          named_insured: null,
          certificate_holder: null,
          additional_insured: [],
          producer_agency: null,
          insurers: [],
          policy_number: null,
          effective_date: null,
          expiration_date: null,
          certificate_date: null,
          confidence: 40,
          warnings: [],
        },
        dwellingPolicy: {
          document_type: 'dwelling_policy_declarations',
          insurer_name: 'American Integrity Insurance Company',
          policy_number: 'ADC0931778',
          named_insured_primary: 'Ifunanya Okafor',
          occupancy_type: 'Tenant',
          mortgagee_name: null,
          insured_property_address: null,
          date_issued: '2026-05-04',
          policy_effective_date: '2026-06-27',
          policy_expiration_date: '2027-06-27',
          coverage_c_personal_property_limit: 0,
        },
      }),
    )
    expect(extracted.carrier).toBe('American Integrity Insurance Company')
    expect(extracted.coverageStartDate).toBe('2026-06-27')
  })
})
