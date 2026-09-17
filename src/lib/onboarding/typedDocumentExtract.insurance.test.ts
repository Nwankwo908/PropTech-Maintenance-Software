import { describe, expect, it } from 'vitest'
import { parseClassifierResponse, resolveTypedExtractKind } from '@shared/onboarding/typedDocumentExtract/classify'
import {
  classifyInsuranceDocumentType,
  findRelevantInsurancePages,
} from '@shared/onboarding/typedDocumentExtract/insuranceClassify'
import { parseAndMapTypedExtract } from '@shared/onboarding/typedDocumentExtract/parseAndMap'
import { formatInsurancePartyName, parseCoverageLimit, parseMoney } from '@shared/onboarding/typedDocumentExtract/parse'
import {
  DWELLING_POLICY_GROUND_TRUTH,
  DWELLING_POLICY_NESTED_FIXTURE,
} from '@shared/onboarding/typedDocumentExtract/insurancePolicy'

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
  it('maps the nested Springdale declarations fixture', () => {
    const mapped = parseAndMapTypedExtract(
      'dwelling_policy_declarations',
      DWELLING_POLICY_NESTED_FIXTURE,
    )
    const policy = mapped.dwellingPolicy
    expect(policy?.named_insured_primary).toBe('Ifunanya Okafor')
    expect(policy?.insured_mailing_address).toBe(
      '6808 Piazza Grande Ave Apt 3205, Orlando, FL 32835-8786',
    )
    expect(policy?.insured_property_address).toBe('563 Springdale Cir, Palm Springs, FL 33461')
    expect(policy?.insured_mailing_address).not.toBe(policy?.insured_property_address)
    expect(policy?.coverage_c_personal_property_limit).toBe(0)
    expect(policy?.mortgagee_name).toBe('CMG Mortgage Inc ISAOA ATIMA')
    expect(policy?.date_issued).toBe('2026-05-04')
    expect(policy?.policy_effective_date).toBe('2026-06-27')
    expect(policy?.year_built).toBe(1980)
    expect(policy?.occupancy_type).toBe('Tenant')
    expect(policy?.claims_phone).toBe('1-866-277-9871')
    expect(mapped.residents).toHaveLength(0)
  })

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
    expect(policy?.producer_agency_address).toBe(
      '4722 NW 2nd Ave Ste C104, Boca Raton, FL 33431-4166',
    )
    expect(policy?.producer_agency_phone).toBe('(561) 998-0950')
    expect(policy?.insured_property_address).toBe('563 Springdale Cir, Palm Springs, FL 33461')
    expect(policy?.year_built).toBe(1980)
    expect(policy?.total_annual_premium).toBe(3792.53)
    expect(policy?.coverage_a_dwelling_limit).toBe(208400)
    expect(policy?.coverage_c_personal_property_limit).toBe(0)
    expect(policy?.coverage_d_fair_rental_value_limit).toBe(20840)
    expect(policy?.coverage_l_liability_limit).toBe(100000)
    expect(policy?.medical_payments_limit).toBe(2000)
    expect(policy?.deductible_all_other_perils).toBe(2500)
    expect(policy?.hurricane_deductible_percent).toBe(5)
    expect(policy?.hurricane_deductible_amount).toBe(10420)
    expect(policy?.mortgagee_name).toBe('CMG Mortgage Inc ISAOA ATIMA')
    expect(policy?.mortgagee_address).toBe('PO Box 2803, Daytona Beach, FL 32120-2803')
    expect(policy?.loan_number).toBe('0180951220')
    expect(policy?.occupancy_type).toBe('Tenant')
    expect(policy?.property_use).toBe('Rental Property')
    expect(policy?.claims_phone).toBe('1-866-277-9871')
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
    pages[0] = 'Dear Policyholder'
    pages[1] = 'Coverage checklist COVERAGE A Dwelling optional endorsements'
    pages[13] = 'State disclosures'
    pages[14] = 'POLICY DECLARATIONS\nDWELLING POLICY DP-3\nNAMED INSURED\n$208,400'
    pages[15] = 'Coverage A Dwelling'
    pages[16] = 'Mortgagee CMG'
    pages[17] = 'ISO form HO 00 03'
    const selected = findRelevantInsurancePages(pages)
    expect(selected).not.toContain(1)
    expect(selected).not.toContain(2)
    expect(selected).toEqual([14, 15, 16, 17, 18])
  })

  it('does not treat Coverage A checklist pages as the declarations page', () => {
    const pages = [
      'Dear Policyholder',
      'COVERAGE A checklist DWELLING POLICY comparison',
      'More disclosures ACORD notice',
    ]
    expect(findRelevantInsurancePages(pages)).toEqual([])
  })

  it('prefers the real declarations page over a table-of-contents mention', () => {
    const pages = Array.from({ length: 20 }, (_, i) => `Page ${i + 1}`)
    pages[2] = 'POLICY DECLARATIONS see page 15'
    pages[14] = 'POLICY DECLARATIONS NAMED INSURED MORTGAGEE $208,400 LOCATION OF RESIDENCE PREMISES'
    const selected = findRelevantInsurancePages(pages)
    expect(selected[0]).toBeGreaterThanOrEqual(14)
    expect(selected).toContain(15)
    expect(selected).not.toContain(1)
  })
})
