/** Document-first extraction kinds. Generic onboarding extract stays separate. */
export type InsuranceDocumentType =
  | 'certificate_of_liability_insurance'
  | 'dwelling_policy_declarations'
  | 'homeowners_policy_declarations'
  | 'commercial_property_policy'
  | 'unknown'

export type TypedExtractKind =
  | 'rent_roll'
  | 'lease'
  | 'insurance_certificate'
  | 'dwelling_policy_declarations'
  | 'homeowners_policy_declarations'
  | 'commercial_property_policy'

/** `insurance` = insurance file whose subtype is not classified yet. */
export type TypedOrGenericExtractKind = TypedExtractKind | 'insurance' | 'generic' | 'unknown'

export function isPropertyPolicyKind(
  kind: string,
): kind is
  | 'dwelling_policy_declarations'
  | 'homeowners_policy_declarations'
  | 'commercial_property_policy' {
  return (
    kind === 'dwelling_policy_declarations' ||
    kind === 'homeowners_policy_declarations' ||
    kind === 'commercial_property_policy'
  )
}

export function isInsuranceTypedKind(kind: string): boolean {
  return kind === 'insurance_certificate' || isPropertyPolicyKind(kind)
}

export function isTypedExtractKind(kind: string): kind is TypedExtractKind {
  return kind === 'rent_roll' || kind === 'lease' || isInsuranceTypedKind(kind)
}

export type RentRollUnitStatus =
  | 'occupied'
  | 'vacant'
  | 'notice'
  | 'model'
  | 'offline'
  | 'other'

export type RentRollUnitRow = {
  unit: string | null
  tenant_names: string[]
  lease_start: string | null
  lease_end: string | null
  monthly_rent: number | null
  status: RentRollUnitStatus | null
  confidence: number
  skipReason: string | null
}

export type RentRollExtract = {
  property_name: string | null
  property_address: string | null
  rows: RentRollUnitRow[]
  warnings: string[]
}

export type LeaseExtract = {
  landlord_name: string | null
  tenant_names: string[]
  guarantor_names: string[]
  property_manager_name: string | null
  property_address: string | null
  unit: string | null
  lease_start: string | null
  lease_end: string | null
  monthly_rent: number | null
  security_deposit: number | null
  confidence: number
  warnings: string[]
}

export type InsuranceInsurerRow = {
  name: string
  policy_number: string | null
}

export type InsuranceCertificateExtract = {
  document_type: 'certificate_of_liability_insurance'
  named_insured: string | null
  certificate_holder: string | null
  additional_insured: string[]
  producer_agency: string | null
  insurers: InsuranceInsurerRow[]
  policy_number: string | null
  effective_date: string | null
  expiration_date: string | null
  certificate_date: string | null
  general_liability: string | null
  automobile_liability: string | null
  workers_compensation: string | null
  confidence: number
  warnings: string[]
}

export type DwellingPolicyDeclarations = {
  document_type:
    | 'dwelling_policy_declarations'
    | 'homeowners_policy_declarations'
    | 'commercial_property_policy'
  insurer_name: string | null
  policy_number: string | null
  policy_form: string | null
  transaction_type: string | null
  date_issued: string | null
  policy_effective_date: string | null
  policy_expiration_date: string | null
  named_insured_primary: string | null
  named_insured_secondary: string | null
  insured_mailing_address: string | null
  producer_agency_name: string | null
  insured_property_address: string | null
  total_annual_premium: number | null
  coverage_a_dwelling_limit: number | null
  coverage_c_personal_property_limit: number | null
  coverage_d_fair_rental_value_limit: number | null
  coverage_l_liability_limit: number | null
  deductible_all_other_perils: number | null
  hurricane_deductible_percent: number | null
  hurricane_deductible_amount: number | null
  mortgagee_name: string | null
  mortgagee_address: string | null
  loan_number: string | null
  occupancy_type: string | null
  property_use: string | null
  confidence: number
  warnings: string[]
}

export type ExtractRoleFact = {
  role:
    | 'landlord_lessor'
    | 'tenant_lessee'
    | 'guarantor'
    | 'property_manager'
    | 'named_insured'
    | 'certificate_holder'
    | 'additional_insured'
    | 'insurance_producer'
    | 'insurance_carrier'
    | 'mortgagee'
    | 'unit_row_needs_review'
  label: string
  value: string
  confidence: number
  needsReview: boolean
}

export const ROLE_LABELS: Record<ExtractRoleFact['role'], string> = {
  landlord_lessor: 'Landlord / Lessor',
  tenant_lessee: 'Tenant / Lessee',
  guarantor: 'Guarantor',
  property_manager: 'Property Manager',
  named_insured: 'Named Insured',
  certificate_holder: 'Certificate Holder',
  additional_insured: 'Additional Insured',
  insurance_producer: 'Insurance Producer',
  insurance_carrier: 'Insurance Carrier',
  mortgagee: 'Mortgagee',
  unit_row_needs_review: 'Rent roll row',
}
