import { describe, expect, it } from 'vitest'
import { parseClassifierResponse, resolveTypedExtractKind } from '@shared/onboarding/typedDocumentExtract/classify'
import {
  classifyInsuranceDocumentType,
  findRelevantInsurancePages,
} from '@shared/onboarding/typedDocumentExtract/insuranceClassify'
import { parseAndMapTypedExtract } from '@shared/onboarding/typedDocumentExtract/parseAndMap'
import { formatInsurancePartyName, parseCoverageLimit } from '@shared/onboarding/typedDocumentExtract/parse'
import { DWELLING_POLICY_GROUND_TRUTH } from '@shared/onboarding/typedDocumentExtract/insurancePolicy'

const DWELLING_SNIPPET = `
POLICY DECLARATIONS
DWELLING POLICY DP-3
NAMED INSURED
IFUNANYA OKAFOR
MORTGAGEE
CMG MORTGAGE INC ISAOA ATIMA
LOCATION OF RESIDENCE PREMISES
Occupancy: Tenant
American Integrity Insurance Company
`

const COI_SNIPPET = `
CERTIFICATE OF LIABILITY INSURANCE
ACORD
CERTIFICATE HOLDER
PRODUCER
INSURED
Flex Plumbing LLC
`

describe('insurance document classification', () => {
  it('classifies a COI from ACORD markers', () => {
    expect(classifyInsuranceDocumentType(COI_SNIPPET, 'scan.pdf')).toBe(
      'certificate_of_liability_insurance',
    )
    expect(resolveTypedExtractKind('ACORD-COI.pdf', 'unknown')).toBe('insurance_certificate')
  })

  it('classifies DP-3 declarations as dwelling, not a COI', () => {
    expect(classifyInsuranceDocumentType(DWELLING_SNIPPET, 'policy.pdf')).toBe(
      'dwelling_policy_declarations',
    )
    expect(resolveTypedExtractKind('scan.pdf', 'insurance_certificate')).toBe('insurance')
    expect(resolveTypedExtractKind('DP3-declarations.pdf', 'unknown')).toBe(
      'dwelling_policy_declarations',
    )
  })

  it('classifies unknown insurance PDFs as unknown', () => {
    expect(
      classifyInsuranceDocumentType('This brochure describes optional flood coverage.', 'notes.pdf'),
    ).toBe('unknown')
  })

  it('does not treat generic insurance as a COI in the top-level classifier', () => {
    expect(parseClassifierResponse({ type: 'insurance' })).toBe('insurance')
    expect(parseClassifierResponse({ document_type: 'dwelling_policy_declarations' })).toBe(
      'dwelling_policy_declarations',
    )
  })
})

describe('dwelling policy extraction', () => {
  it('maps the reference declarations ground truth', () => {
    const mapped = parseAndMapTypedExtract('dwelling_policy_declarations', {
      ...DWELLING_POLICY_GROUND_TRUTH,
      certificate_holder: 'Should not appear',
      tenant_name: 'Should not appear',
    })
    const policy = mapped.dwellingPolicy
    expect(mapped.extractKind).toBe('dwelling_policy_declarations')
    expect(mapped.insuranceCertificate).toBeNull()
    expect(policy?.document_type).toBe('dwelling_policy_declarations')
    expect(policy?.insurer_name).toBe('American Integrity Insurance Company')
    expect(policy?.policy_number).toBe('ADC0931778')
    expect(policy?.policy_form).toBe('DP3')
    expect(policy?.transaction_type).toBe('Renewal')
    expect(policy?.date_issued).toBe('2026-05-04')
    expect(policy?.policy_effective_date).toBe('2026-06-27')
    expect(policy?.policy_expiration_date).toBe('2027-06-27')
    expect(policy?.named_insured_primary).toBe('Ifunanya Okafor')
    expect(policy?.named_insured_secondary).toBeNull()
    expect(policy?.insured_mailing_address).toBe(
      '6808 Piazza Grande Ave Apt 3205, Orlando, FL 32835-8786',
    )
    expect(policy?.producer_agency_name).toBe('Kirstein Insurance Agency, LLC')
    expect(policy?.insured_property_address).toBe('563 Springdale Cir, Palm Springs, FL 33461-1533')
    expect(policy?.total_annual_premium).toBe(3792.53)
    expect(policy?.coverage_a_dwelling_limit).toBe(208400)
    expect(policy?.coverage_c_personal_property_limit).toBe(0)
    expect(policy?.coverage_d_fair_rental_value_limit).toBe(20840)
    expect(policy?.coverage_l_liability_limit).toBe(100000)
    expect(policy?.deductible_all_other_perils).toBe(2500)
    expect(policy?.hurricane_deductible_percent).toBe(5)
    expect(policy?.hurricane_deductible_amount).toBe(10420)
    expect(policy?.mortgagee_name).toBe('CMG Mortgage Inc ISAOA ATIMA')
    expect(policy?.mortgagee_address).toBe('PO Box 2803, Daytona Beach, FL 32120-2803')
    expect(policy?.loan_number).toBe('0180951220')
    expect(policy?.occupancy_type).toBe('Tenant')
    expect(policy?.property_use).toBe('Rental Property')
    expect(mapped.residents).toHaveLength(0)
    expect(mapped.roleFacts.some((row) => row.role === 'certificate_holder')).toBe(false)
  })

  it('maps named insured and occupancy without inventing a tenant', () => {
    const mapped = parseAndMapTypedExtract('dwelling_policy_declarations', {
      named_insured_primary: 'IFUNANYA OKAFOR',
      occupancy_type: 'Occupancy: Tenant',
      producer_agency_name: 'Kirstein Insurance Agency, LLC',
      mortgagee_name: 'CMG MORTGAGE INC ISAOA ATIMA',
      tenant_name: 'Tenant',
      confidence: 92,
    })
    expect(mapped.dwellingPolicy?.named_insured_primary).toBe('Ifunanya Okafor')
    expect(mapped.dwellingPolicy?.occupancy_type).toBe('Tenant')
    expect(mapped.dwellingPolicy?.producer_agency_name).not.toBe('Ifunanya Okafor')
    expect(mapped.dwellingPolicy?.mortgagee_name).toBe('CMG Mortgage Inc ISAOA ATIMA')
    expect(mapped.residents).toHaveLength(0)
    expect(mapped.roleFacts.some((row) => row.role === 'tenant_lessee')).toBe(false)
  })

  it('keeps issue, effective, and expiration dates independent', () => {
    const mapped = parseAndMapTypedExtract('dwelling_policy_declarations', {
      date_issued: '2026-05-04',
      policy_effective_date: '2026-06-27',
      policy_expiration_date: '2027-06-27',
      coverage_c_personal_property_limit: 0,
    })
    expect(mapped.dwellingPolicy?.date_issued).toBe('2026-05-04')
    expect(mapped.dwellingPolicy?.policy_effective_date).toBe('2026-06-27')
    expect(mapped.dwellingPolicy?.policy_expiration_date).toBe('2027-06-27')
  })

  it('treats excluded personal property as a valid zero', () => {
    expect(parseCoverageLimit(0)).toBe(0)
    expect(parseCoverageLimit('Excluded')).toBe(0)
    expect(parseCoverageLimit(null)).toBeNull()
    const mapped = parseAndMapTypedExtract('dwelling_policy_declarations', {
      coverage_c: 'Excluded',
    })
    expect(mapped.dwellingPolicy?.coverage_c_personal_property_limit).toBe(0)
  })

  it('preserves mortgagee ISAOA ATIMA suffixes', () => {
    expect(formatInsurancePartyName('CMG MORTGAGE INC ISAOA ATIMA')).toBe(
      'CMG Mortgage Inc ISAOA ATIMA',
    )
  })
})

describe('insurance page reduction', () => {
  it('selects the declarations page range instead of the whole policy', () => {
    const pages = Array.from({ length: 94 }, (_, i) => `Page ${i + 1} filler`)
    pages[14] = 'POLICY DECLARATIONS\nDWELLING POLICY DP-3\nNAMED INSURED'
    pages[15] = 'Coverage A Dwelling'
    pages[16] = 'Mortgagee'
    const selected = findRelevantInsurancePages(pages)
    expect(selected[0]).toBe(15)
    expect(selected).not.toContain(1)
    expect(selected).toContain(15)
    expect(selected.length).toBeLessThanOrEqual(5)
  })

  it('finds dwelling pages that say DWELLING POLICY without POLICY DECLARATIONS', () => {
    const pages = ['Cover letter', 'DWELLING POLICY DP-3\nNAMED INSURED\nCoverage A', 'Limits']
    expect(findRelevantInsurancePages(pages)).toEqual([2, 3])
  })
})
