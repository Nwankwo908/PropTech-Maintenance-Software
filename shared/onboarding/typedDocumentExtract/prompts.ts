export const RENT_ROLL_JSON_SCHEMA = {
  property_name: 'string or null',
  property_address: 'string or null',
  rows: [
    {
      unit: 'string or null',
      tenant_names: ['string'],
      lease_start: 'YYYY-MM-DD or null',
      lease_end: 'YYYY-MM-DD or null',
      monthly_rent: 'number or null',
      status: 'occupied|vacant|notice|model|offline|other or null',
      confidence: '0-100',
    },
  ],
  warnings: ['string'],
}

export const RENT_ROLL_SYSTEM_PROMPT = `You extract a rent roll / occupancy roster as a table of unit rows.

Return JSON only matching this schema:
${JSON.stringify(RENT_ROLL_JSON_SCHEMA, null, 2)}

Rules:
- Return one object per actual unit/property row. Do not flatten the roll into one tenant object.
- Extract ALL explicitly listed tenants/co-tenants for a unit into tenant_names. Do not keep only one name.
- Vacant, notice, model, offline, or similar units still produce a row. tenant_names must be [].
- Do not invent a tenant. Do not skip a legitimate vacant unit.
- Ignore subtotal, building total, property total, occupancy summary, repeated header, footer, and financial summary rows. They are not units.
- Match columns by meaning, not position. Unit/Unit #/Apt/Apartment/Suite are the same. Tenant/Resident/Occupant/Lease Name/Resident Name are the same. Rent/Monthly Rent/Current Rent/Scheduled Rent/Gross Rent are the same. Lease Start/Start Date/Move In/Lease From are the same. Lease End/End Date/Expiration/Lease To are the same. Status/Occupancy/Unit Status are the same.
- Never infer a tenant from surrounding text, a building name, or a subtotal label.
- Preserve rows even if some fields are null.
- Dates: YYYY-MM-DD when clear; otherwise null. Do not guess.
- monthly_rent: number or null. Strip $ and commas only when the value is clearly money.
- Do not hallucinate.`

export const LEASE_JSON_SCHEMA = {
  landlord_name: 'string or null',
  tenant_names: ['string'],
  guarantor_names: ['string'],
  property_manager_name: 'string or null',
  property_address: 'string or null',
  unit: 'string or null',
  lease_start: 'YYYY-MM-DD or null',
  lease_end: 'YYYY-MM-DD or null',
  monthly_rent: 'number or null',
  security_deposit: 'number or null',
  confidence: '0-100',
  warnings: ['string'],
}

export const LEASE_SYSTEM_PROMPT = `You extract one residential lease or occupancy agreement.

Return JSON only matching this schema:
${JSON.stringify(LEASE_JSON_SCHEMA, null, 2)}

NAME ROLES:
- landlord_name: owner/lessor. May be an LLC, corporation, trust, or individual. One string. Do not split into first/last. Do not use the property manager or leasing agent as landlord.
- tenant_names: every explicitly named tenant/lessee. Do not include guarantors, co-signers, the landlord, or the management company.
- If one party is an LLC/Inc/company and the other is a person, the company is landlord_name and the person is in tenant_names unless the document clearly labels the reverse.
- guarantor_names: guarantors and co-signers only. A guarantor next to a tenant is still not a tenant.
- property_manager_name: manager or leasing agent. Signing on behalf of the owner does not make them the landlord.

If a spelling mismatch exists, prefer the signed/signature-block version when it is clearly the same party and legible.
Do not merge two clearly different people because names are similar.
Do not invent missing parties. If a role is not clearly identified, return null or [].
Dates YYYY-MM-DD or null. Money as number or null.
Do not hallucinate.`

export const INSURANCE_JSON_SCHEMA = {
  document_type: 'certificate_of_liability_insurance',
  named_insured: 'string or null',
  certificate_holder: 'string or null',
  additional_insured: ['string'],
  producer_agency: 'string or null',
  insurers: [{ name: 'string', policy_number: 'string or null' }],
  policy_number: 'string or null',
  effective_date: 'YYYY-MM-DD or null',
  expiration_date: 'YYYY-MM-DD or null',
  certificate_date: 'YYYY-MM-DD or null',
  general_liability: 'string or null',
  automobile_liability: 'string or null',
  workers_compensation: 'string or null',
  confidence: '0-100',
  warnings: ['string'],
}

export const INSURANCE_SYSTEM_PROMPT = `You extract a Certificate of Liability Insurance (ACORD-style when labels are present).

Return JSON only matching this schema:
${JSON.stringify(INSURANCE_JSON_SCHEMA, null, 2)}

First confirm this is a Certificate of Liability Insurance. If it is a dwelling, homeowners, or commercial property declarations page, do not fill this schema — return certificate_holder null and a warning that the document is not a COI.

Anchor to literal field labels when available.

ROLES:
- named_insured: the policyholder as labeled NAMED INSURED / INSURED. Do not copy producer or insurer here.
- certificate_holder: only from Certificate Holder. Do not invent a certificate holder.
- additional_insured: only when explicitly identified.
- producer_agency: insurance agency/broker.
- insurers: Insurer(s) Affording Coverage / carriers.
- policy_number / effective_date / expiration_date: from the policy coverage rows, not the certificate issue date.
- certificate_date: certificate/issue date if printed. Do not copy it into effective_date.
- general_liability / automobile_liability / workers_compensation: labeled limits or "N/A" as printed.

If a role is missing, return null or []. Do not hallucinate. Do not convert one party role into another.`

export const PROPERTY_POLICY_JSON_SCHEMA = {
  document_type:
    'dwelling_policy_declarations | homeowners_policy_declarations | commercial_property_policy',
  insurer_name: 'string or null',
  policy_number: 'string or null',
  policy_form: 'string or null',
  transaction_type: 'string or null',
  date_issued: 'YYYY-MM-DD or null',
  policy_effective_date: 'YYYY-MM-DD or null',
  policy_expiration_date: 'YYYY-MM-DD or null',
  named_insured_primary: 'string or null',
  named_insured_secondary: 'string or null',
  insured_mailing_address: 'string or null',
  producer_agency_name: 'string or null',
  insured_property_address: 'string or null',
  total_annual_premium: 'number or null',
  coverage_a_dwelling_limit: 'number or null',
  coverage_c_personal_property_limit: 'number or null',
  coverage_d_fair_rental_value_limit: 'number or null',
  coverage_l_liability_limit: 'number or null',
  deductible_all_other_perils: 'number or null',
  hurricane_deductible_percent: 'number or null',
  hurricane_deductible_amount: 'number or null',
  mortgagee_name: 'string or null',
  mortgagee_address: 'string or null',
  loan_number: 'string or null',
  occupancy_type: 'string or null',
  property_use: 'string or null',
  confidence: '0-100',
  warnings: ['string'],
}

export const PROPERTY_POLICY_SYSTEM_PROMPT = `You extract a property insurance declarations page (dwelling / homeowners / commercial property). This is NOT a Certificate of Liability Insurance.

Return JSON only matching this schema:
${JSON.stringify(PROPERTY_POLICY_JSON_SCHEMA, null, 2)}

First identify the insurance document type.

Do not infer roles from isolated words.

"Named Insured" on a dwelling or homeowners policy usually refers to the property owner.

"Occupancy: Tenant" describes how the property is occupied and is not a tenant's name. Put it in occupancy_type only. Do not invent a tenant name when none is explicitly present.

Do not invent a certificate holder. This schema has no certificate_holder field.

Producer or agency is the agency that sold the policy. Insurer/carrier underwrites the policy. Mortgagee is the lender. Keep mortgagee clause suffixes such as ISAOA ATIMA.

Keep issue date, effective date, and expiration date separate. Do not let the print/issue date overwrite policy_effective_date.

A coverage explicitly marked Excluded may legitimately have a numeric limit of 0. 0 is valid. Return null when a requested value is absent. Do not substitute another nearby value merely to fill the schema.

Do not hallucinate.`

export function typedExtractSystemPrompt(
  kind: import('./types.ts').TypedExtractKind,
): string {
  if (kind === 'rent_roll') return RENT_ROLL_SYSTEM_PROMPT
  if (kind === 'lease') return LEASE_SYSTEM_PROMPT
  if (kind === 'insurance_certificate') return INSURANCE_SYSTEM_PROMPT
  return PROPERTY_POLICY_SYSTEM_PROMPT
}

export function typedExtractIntro(
  kind: import('./types.ts').TypedExtractKind,
  fileName: string,
): string {
  if (kind === 'rent_roll') {
    return `File: ${fileName}\nThis is a rent roll or occupancy roster. Extract unit rows only.`
  }
  if (kind === 'lease') {
    return `File: ${fileName}\nThis is a residential lease or occupancy agreement. Extract landlord, tenants, guarantors, manager, premises, and money terms by role.`
  }
  if (kind === 'insurance_certificate') {
    return `File: ${fileName}\nThis is a Certificate of Liability Insurance. Extract named insured, certificate holder, additional insured, producer, and insurers by labeled role. Do not treat it as a dwelling policy.`
  }
  if (kind === 'homeowners_policy_declarations') {
    return `File: ${fileName}\nThis is a homeowners policy declarations page. Extract named insured, producer, insurer, mortgagee, dates, and coverage. Occupancy is not a tenant name.`
  }
  if (kind === 'commercial_property_policy') {
    return `File: ${fileName}\nThis is a commercial property policy. Extract named insured, producer, insurer, location, dates, and coverage. Do not invent a certificate holder.`
  }
  return `File: ${fileName}\nThis is a dwelling / landlord policy declarations page. Extract named insured (owner), producer, insurer, mortgagee, occupancy type, dates, and coverage. Do not invent a certificate holder or tenant name.`
}
