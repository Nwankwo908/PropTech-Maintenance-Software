import {
  clampConfidence,
  cleanExtractedName,
  formatInsurancePartyName,
  parseCoverageLimit,
  parseIsoDate,
  parseMoney,
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

function looksLikePersonName(value: string | null): boolean {
  if (!value) return false
  const parts = value.trim().split(/\s+/).filter(Boolean)
  return parts.length >= 2 && !/llc|inc|agency|insurance|mortgage/i.test(value)
}

export function normalizePropertyPolicyExtract(
  raw: unknown,
  kind: TypedExtractKind = 'dwelling_policy_declarations',
): DwellingPolicyDeclarations {
  const root = asRecord(raw)
  const rawType = String(root.document_type ?? '').trim().toLowerCase()
  const documentType: DwellingPolicyDeclarations['document_type'] =
    rawType === 'homeowners_policy_declarations' ||
    rawType === 'commercial_property_policy' ||
    rawType === 'dwelling_policy_declarations'
      ? rawType
      : documentTypeFromKind(kind)

  return {
    document_type: documentType,
    insurer_name: formatInsurancePartyName(root.insurer_name ?? root.carrier ?? root.insurer),
    policy_number: cleanExtractedName(root.policy_number ?? root.policyNumber),
    policy_form: cleanExtractedName(root.policy_form ?? root.policyForm),
    transaction_type: cleanExtractedName(root.transaction_type ?? root.transactionType),
    date_issued: parseIsoDate(root.date_issued ?? root.dateIssued ?? root.issue_date),
    policy_effective_date: parseIsoDate(
      root.policy_effective_date ?? root.effective_date ?? root.policyEffectiveDate,
    ),
    policy_expiration_date: parseIsoDate(
      root.policy_expiration_date ?? root.expiration_date ?? root.policyExpirationDate,
    ),
    named_insured_primary: formatInsurancePartyName(
      root.named_insured_primary ?? root.named_insured ?? root.namedInsured,
    ),
    named_insured_secondary: formatInsurancePartyName(root.named_insured_secondary),
    insured_mailing_address: cleanExtractedName(
      root.insured_mailing_address ?? root.mailing_address,
    ),
    producer_agency_name: formatInsurancePartyName(
      root.producer_agency_name ?? root.producer_agency ?? root.producer,
    ),
    insured_property_address: cleanExtractedName(
      root.insured_property_address ?? root.property_address ?? root.location_of_residence_premises,
    ),
    total_annual_premium: parseMoney(root.total_annual_premium ?? root.premium),
    coverage_a_dwelling_limit: parseCoverageLimit(
      root.coverage_a_dwelling_limit ?? root.coverage_a,
    ),
    coverage_c_personal_property_limit: parseCoverageLimit(
      root.coverage_c_personal_property_limit ?? root.coverage_c,
    ),
    coverage_d_fair_rental_value_limit: parseCoverageLimit(
      root.coverage_d_fair_rental_value_limit ?? root.coverage_d,
    ),
    coverage_l_liability_limit: parseCoverageLimit(
      root.coverage_l_liability_limit ?? root.coverage_l,
    ),
    deductible_all_other_perils: parseCoverageLimit(root.deductible_all_other_perils),
    hurricane_deductible_percent: parseCoverageLimit(root.hurricane_deductible_percent),
    hurricane_deductible_amount: parseCoverageLimit(root.hurricane_deductible_amount),
    mortgagee_name: formatInsurancePartyName(root.mortgagee_name ?? root.mortgagee),
    mortgagee_address: cleanExtractedName(root.mortgagee_address),
    loan_number: cleanExtractedName(root.loan_number ?? root.loanNumber),
    occupancy_type: parseOccupancyType(root.occupancy_type ?? root.occupancy),
    property_use: cleanExtractedName(root.property_use),
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
    date_issued: issued,
    policy_effective_date: effective,
    warnings,
  }
}

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
  insured_property_address: '563 Springdale Cir, Palm Springs, FL 33461-1533',
  total_annual_premium: 3792.53,
  coverage_a_dwelling_limit: 208400,
  coverage_c_personal_property_limit: 0,
  coverage_d_fair_rental_value_limit: 20840,
  coverage_l_liability_limit: 100000,
  deductible_all_other_perils: 2500,
  hurricane_deductible_percent: 5,
  hurricane_deductible_amount: 10420,
  mortgagee_name: 'CMG Mortgage Inc ISAOA ATIMA',
  mortgagee_address: 'PO Box 2803, Daytona Beach, FL 32120-2803',
  loan_number: '0180951220',
  occupancy_type: 'Tenant',
  property_use: 'Rental Property',
  confidence: 95,
  warnings: [],
}
