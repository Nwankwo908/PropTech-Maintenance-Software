import {
  clampConfidence,
  cleanExtractedName,
  formatInsurancePartyName,
  parseCoverageLimit,
  parseIsoDate,
  parseYearBuilt,
  uniqueNames,
} from './parse.ts'
import type { DwellingPolicyDeclarations, TypedExtractKind } from './types.ts'

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function documentTypeFromKind(
  kind: TypedExtractKind,
): DwellingPolicyDeclarations['document_type'] {
  if (kind === 'homeowners_policy_declarations') return 'homeowners_policy_declarations'
  if (kind === 'commercial_property_policy') return 'commercial_property_policy'
  return 'dwelling_policy_declarations'
}

function parseOccupancyType(value: unknown): string | null {
  const text = cleanExtractedName(value)
  if (!text) return null
  const stripped = text.replace(/^occupancy\s*:\s*/i, '').trim()
  if (!stripped) return null
  if (/^(tenant|owner|owner[- ]occupied|vacant|unoccupied|seasonal|rental)$/i.test(stripped)) {
    return stripped.replace(/\b\w/g, (ch) => ch.toUpperCase()).replace(/Occupied/i, 'Occupied')
  }
  if (/tenant/i.test(stripped) && stripped.length < 24) return 'Tenant'
  return stripped
}

function parsePropertyUse(value: unknown): string | null {
  const text = cleanExtractedName(value)
  if (!text) return null
  return text.replace(/^use\s*:\s*/i, '').trim() || null
}

function looksLikePersonName(value: string | null): boolean {
  if (!value) return false
  if (
    /\b(rental|property|occupancy|tenant|owner|vacant|seasonal|dwelling|residential)\b/i.test(
      value,
    )
  ) {
    return false
  }
  const parts = value.trim().split(/\s+/).filter(Boolean)
  return parts.length >= 2 && !/llc|inc|agency|insurance|mortgage/i.test(value)
}

function pick(...values: unknown[]): unknown {
  for (const value of values) {
    if (value === undefined || value === null) continue
    if (typeof value === 'string' && !value.trim()) continue
    return value
  }
  return undefined
}

/** Accept nested declarations JSON or the older flat field names. */
function flattenPropertyPolicyRaw(raw: unknown): Record<string, unknown> {
  const root = asRecord(raw)
  const carrier = asRecord(root.carrier)
  const named = asRecord(root.named_insured)
  const property = asRecord(root.insured_property)
  const agent = asRecord(root.agent)
  const coverage = asRecord(root.coverage)
  const mortgagee = asRecord(root.mortgagee)

  return {
    ...root,
    insurer_name: pick(
      root.insurer_name,
      carrier.insurer_name,
      typeof root.carrier === 'string' ? root.carrier : undefined,
      root.insurer,
    ),
    policy_form: pick(root.policy_form, root.policyForm, carrier.policy_type),
    policy_number: pick(root.policy_number, root.policyNumber, carrier.policy_number),
    transaction_type: pick(root.transaction_type, root.transactionType, carrier.transaction_type),
    date_issued: pick(
      root.date_issued,
      root.dateIssued,
      root.issue_date,
      carrier.date_issued,
    ),
    policy_effective_date: pick(
      root.policy_effective_date,
      root.effective_date,
      root.policyEffectiveDate,
      carrier.effective_date,
    ),
    policy_expiration_date: pick(
      root.policy_expiration_date,
      root.expiration_date,
      root.policyExpirationDate,
      carrier.expiration_date,
    ),
    claims_phone: pick(
      root.claims_phone,
      carrier.claims_phone,
      root.claimsPhone,
      root.claims_reporting,
    ),
    named_insured_primary: pick(
      root.named_insured_primary,
      named.primary_name,
      typeof root.named_insured === 'string' ? root.named_insured : undefined,
      root.namedInsured,
    ),
    named_insured_secondary: pick(root.named_insured_secondary, named.secondary_name),
    insured_mailing_address: pick(
      root.insured_mailing_address,
      named.mailing_address,
      root.mailing_address,
    ),
    producer_agency_name: pick(
      root.producer_agency_name,
      root.producer_agency,
      root.producer,
      agent.agency_name,
    ),
    producer_agency_address: pick(root.producer_agency_address, agent.agency_address),
    producer_agency_phone: pick(root.producer_agency_phone, agent.phone),
    insured_property_address: pick(
      root.insured_property_address,
      property.address,
      root.property_address,
      root.location_of_residence_premises,
    ),
    year_built: pick(root.year_built, property.year_built),
    occupancy_type: pick(root.occupancy_type, root.occupancy, property.occupancy_type),
    property_use: pick(root.property_use, property.property_use),
    total_annual_premium: pick(
      root.total_annual_premium,
      root.premium,
      coverage.total_annual_premium,
    ),
    coverage_a_dwelling_limit: pick(
      root.coverage_a_dwelling_limit,
      root.coverage_a,
      coverage.dwelling_limit,
    ),
    coverage_c_personal_property_limit: pick(
      root.coverage_c_personal_property_limit,
      root.coverage_c,
      coverage.personal_property_limit,
    ),
    coverage_d_fair_rental_value_limit: pick(
      root.coverage_d_fair_rental_value_limit,
      root.coverage_d,
      coverage.fair_rental_value_limit,
    ),
    coverage_l_liability_limit: pick(
      root.coverage_l_liability_limit,
      root.coverage_l,
      coverage.liability_limit,
    ),
    medical_payments_limit: pick(root.medical_payments_limit, coverage.medical_payments_limit),
    deductible_all_other_perils: pick(
      root.deductible_all_other_perils,
      coverage.deductible_all_other_perils,
    ),
    hurricane_deductible_percent: pick(
      root.hurricane_deductible_percent,
      coverage.hurricane_deductible_percent,
    ),
    hurricane_deductible_amount: pick(
      root.hurricane_deductible_amount,
      coverage.hurricane_deductible_amount,
    ),
    mortgagee_name: pick(
      root.mortgagee_name,
      mortgagee.name,
      typeof root.mortgagee === 'string' ? root.mortgagee : undefined,
    ),
    mortgagee_address: pick(root.mortgagee_address, mortgagee.address),
    loan_number: pick(root.loan_number, root.loanNumber, mortgagee.loan_number),
  }
}

export function normalizePropertyPolicyExtract(
  raw: unknown,
  kind: TypedExtractKind = 'dwelling_policy_declarations',
): DwellingPolicyDeclarations {
  const root = flattenPropertyPolicyRaw(raw)
  const rawType = String(root.document_type ?? '').trim().toLowerCase()
  const documentType: DwellingPolicyDeclarations['document_type'] =
    rawType === 'homeowners_policy_declarations' ||
    rawType === 'commercial_property_policy' ||
    rawType === 'dwelling_policy_declarations'
      ? rawType
      : documentTypeFromKind(kind)

  return {
    document_type: documentType,
    insurer_name: formatInsurancePartyName(root.insurer_name),
    policy_number: cleanExtractedName(root.policy_number),
    policy_form: cleanExtractedName(root.policy_form),
    transaction_type: cleanExtractedName(root.transaction_type),
    date_issued: parseIsoDate(root.date_issued),
    policy_effective_date: parseIsoDate(root.policy_effective_date),
    policy_expiration_date: parseIsoDate(root.policy_expiration_date),
    named_insured_primary: formatInsurancePartyName(root.named_insured_primary),
    named_insured_secondary: formatInsurancePartyName(root.named_insured_secondary),
    insured_mailing_address: cleanExtractedName(root.insured_mailing_address),
    producer_agency_name: formatInsurancePartyName(root.producer_agency_name),
    producer_agency_address: cleanExtractedName(root.producer_agency_address),
    producer_agency_phone: cleanExtractedName(root.producer_agency_phone),
    insured_property_address: cleanExtractedName(root.insured_property_address),
    year_built: parseYearBuilt(root.year_built),
    total_annual_premium: parseCoverageLimit(root.total_annual_premium),
    coverage_a_dwelling_limit: parseCoverageLimit(root.coverage_a_dwelling_limit),
    coverage_c_personal_property_limit: parseCoverageLimit(root.coverage_c_personal_property_limit),
    coverage_d_fair_rental_value_limit: parseCoverageLimit(root.coverage_d_fair_rental_value_limit),
    coverage_l_liability_limit: parseCoverageLimit(root.coverage_l_liability_limit),
    medical_payments_limit: parseCoverageLimit(root.medical_payments_limit),
    deductible_all_other_perils: parseCoverageLimit(root.deductible_all_other_perils),
    hurricane_deductible_percent: parseCoverageLimit(root.hurricane_deductible_percent),
    hurricane_deductible_amount: parseCoverageLimit(root.hurricane_deductible_amount),
    mortgagee_name: formatInsurancePartyName(root.mortgagee_name),
    mortgagee_address: cleanExtractedName(root.mortgagee_address),
    loan_number: cleanExtractedName(root.loan_number),
    occupancy_type: parseOccupancyType(root.occupancy_type),
    property_use: parsePropertyUse(root.property_use),
    claims_phone: cleanExtractedName(root.claims_phone),
    confidence: clampConfidence(root.confidence),
    warnings: uniqueNames(root.warnings),
  }
}

export function validatePropertyPolicyExtract(
  extract: DwellingPolicyDeclarations,
): DwellingPolicyDeclarations {
  const warnings = [...extract.warnings]
  let namedPrimary = extract.named_insured_primary
  let occupancy = extract.occupancy_type
  const producer = extract.producer_agency_name
  const mortgagee = extract.mortgagee_name
  const insurer = extract.insurer_name

  if (occupancy && namedPrimary && namedPrimary.toLowerCase() === occupancy.toLowerCase()) {
    namedPrimary = null
    warnings.push('Occupancy was not used as the named insured.')
  }
  if (namedPrimary && occupancy && /^(tenant)$/i.test(namedPrimary)) {
    namedPrimary = null
    warnings.push('Occupancy: Tenant is not a tenant name or named insured.')
  }
  if (producer && namedPrimary && producer.toLowerCase() === namedPrimary.toLowerCase()) {
    namedPrimary = null
    warnings.push('Named insured matched the producer and was cleared.')
  }
  if (mortgagee && namedPrimary && mortgagee.toLowerCase() === namedPrimary.toLowerCase()) {
    namedPrimary = null
    warnings.push('Named insured matched the mortgagee and was cleared.')
  }
  if (insurer && namedPrimary && insurer.toLowerCase() === namedPrimary.toLowerCase()) {
    namedPrimary = null
    warnings.push('Named insured matched the insurer and was cleared.')
  }
  if (looksLikePersonName(occupancy)) {
    occupancy = null
    warnings.push('Occupancy type looked like a person name and was cleared.')
  }
  if (looksLikePersonName(extract.property_use)) {
    warnings.push('Property use looked like a person name and was cleared.')
  }

  const mailing = extract.insured_mailing_address
  const propertyAddress = extract.insured_property_address
  if (mailing && propertyAddress && mailing.toLowerCase() === propertyAddress.toLowerCase()) {
    warnings.push(
      'Mailing address and insured property address were identical. On landlord policies they are often different cities.',
    )
  }

  let effective = extract.policy_effective_date
  let issued = extract.date_issued
  if (issued && effective && issued === effective) {
    // Keep both only when they truly match; do not copy issued into effective when effective is missing.
  }
  if (!effective && issued) {
    warnings.push('Issue date is present but was not used as the policy effective date.')
  }

  if (extract.coverage_c_personal_property_limit === 0) {
    // Excluded coverage is a valid 0 — do not treat as a failed extraction.
  }

  return {
    ...extract,
    named_insured_primary: namedPrimary,
    occupancy_type: occupancy,
    property_use: looksLikePersonName(extract.property_use) ? null : extract.property_use,
    date_issued: issued,
    policy_effective_date: effective,
    warnings,
  }
}

export const DWELLING_POLICY_NESTED_FIXTURE = {
  document_type: 'property_insurance_policy',
  carrier: {
    insurer_name: 'American Integrity Insurance Company',
    policy_type: 'DP3',
    policy_number: 'ADC0931778',
    transaction_type: 'Renewal',
    date_issued: '2026-05-04',
    effective_date: '2026-06-27',
    expiration_date: '2027-06-27',
    claims_phone: '1-866-277-9871',
  },
  named_insured: {
    primary_name: 'Ifunanya Okafor',
    secondary_name: null,
    mailing_address: '6808 Piazza Grande Ave Apt 3205, Orlando, FL 32835-8786',
  },
  insured_property: {
    address: '563 Springdale Cir, Palm Springs, FL 33461',
    year_built: 1980,
    occupancy_type: 'Tenant',
    property_use: 'Rental Property',
  },
  agent: {
    agency_name: 'Kirstein Insurance Agency, LLC',
    agency_address: '4722 NW 2nd Ave Ste C104, Boca Raton, FL 33431-4166',
    phone: '(561) 998-0950',
  },
  coverage: {
    dwelling_limit: 208400,
    personal_property_limit: 0,
    fair_rental_value_limit: 20840,
    liability_limit: 100000,
    medical_payments_limit: 2000,
    deductible_all_other_perils: 2500,
    hurricane_deductible_percent: 5,
    hurricane_deductible_amount: 10420,
    total_annual_premium: 3792.53,
  },
  mortgagee: {
    name: 'CMG Mortgage Inc ISAOA ATIMA',
    address: 'PO Box 2803, Daytona Beach, FL 32120-2803',
    loan_number: '0180951220',
  },
} as const

export const DWELLING_POLICY_GROUND_TRUTH: DwellingPolicyDeclarations = {
  document_type: 'dwelling_policy_declarations',
  insurer_name: 'American Integrity Insurance Company',
  policy_number: 'ADC0931778',
  policy_form: 'DP3',
  transaction_type: 'Renewal',
  date_issued: '2026-05-04',
  policy_effective_date: '2026-06-27',
  policy_expiration_date: '2027-06-27',
  named_insured_primary: 'Ifunanya Okafor',
  named_insured_secondary: null,
  insured_mailing_address: '6808 Piazza Grande Ave Apt 3205, Orlando, FL 32835-8786',
  producer_agency_name: 'Kirstein Insurance Agency, LLC',
  producer_agency_address: '4722 NW 2nd Ave Ste C104, Boca Raton, FL 33431-4166',
  producer_agency_phone: '(561) 998-0950',
  insured_property_address: '563 Springdale Cir, Palm Springs, FL 33461',
  year_built: 1980,
  total_annual_premium: 3792.53,
  coverage_a_dwelling_limit: 208400,
  coverage_c_personal_property_limit: 0,
  coverage_d_fair_rental_value_limit: 20840,
  coverage_l_liability_limit: 100000,
  medical_payments_limit: 2000,
  deductible_all_other_perils: 2500,
  hurricane_deductible_percent: 5,
  hurricane_deductible_amount: 10420,
  mortgagee_name: 'CMG Mortgage Inc ISAOA ATIMA',
  mortgagee_address: 'PO Box 2803, Daytona Beach, FL 32120-2803',
  loan_number: '0180951220',
  occupancy_type: 'Tenant',
  property_use: 'Rental Property',
  claims_phone: '1-866-277-9871',
  confidence: 95,
  warnings: [],
}
