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
      rent_due_day: '1-31 or null',
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
- rent_due_day: day of the month (1–31) when the roll says rent is due. null if not stated. Do not use lease start as the due day.
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
  rent_due_day: '1-31 or null',
  confidence: '0-100',
  warnings: ['string'],
}

export const LEASE_SYSTEM_PROMPT = `You extract one residential lease or occupancy agreement.

Return JSON only matching this schema:
${JSON.stringify(LEASE_JSON_SCHEMA, null, 2)}

NAME ROLES:
- landlord_name: owner/lessor. May be an LLC, corporation, trust, or individual. One string. Do not split into first/last. Do not use the property manager or leasing agent as landlord.
- tenant_names: every explicitly named tenant/lessee. Do not include guarantors, co-signers, the landlord, or the management company.
- Occupant / Tenant / Lessee signature blocks are tenants, never landlord_name. Do not copy a lessee into landlord_name because they signed first or their name is large on the last page.
- Never put the same person in both landlord_name and tenant_names.
- If both parties are people, follow labeled roles (Landlord/Lessor vs Tenant/Lessee/Occupant). Do not swap them.
- If one party is an LLC/Inc/company and the other is a person, the company is landlord_name and the person is in tenant_names unless the document clearly labels the reverse.
- guarantor_names: guarantors and co-signers only. A guarantor next to a tenant is still not a tenant.
- property_manager_name: manager or leasing agent. Signing on behalf of the owner does not make them the landlord.

If a spelling mismatch exists, prefer the signed/signature-block version when it is clearly the same party and legible.
Do not merge two clearly different people because names are similar.
Do not invent missing parties. If a role is not clearly identified, return null or [].
Dates YYYY-MM-DD or null. Money as number or null.
rent_due_day: the calendar day rent is due each month when the lease states it (the 1st, first of each month, due on the 5th). Integer 1–31 or null. Do not use lease start as the due day. Do not guess.
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
  document_type: 'property_insurance_policy',
  carrier: {
    insurer_name: 'string',
    policy_type: 'string',
    policy_number: 'string',
    transaction_type: 'New | Renewal | Change',
    date_issued: 'YYYY-MM-DD or null',
    effective_date: 'YYYY-MM-DD',
    expiration_date: 'YYYY-MM-DD',
    claims_phone: 'string or null',
  },
  named_insured: {
    primary_name: 'string',
    secondary_name: 'string or null',
    mailing_address: 'string',
  },
  insured_property: {
    address: 'string',
    year_built: 'number or null',
    occupancy_type: 'string or null',
    property_use: 'string or null',
  },
  agent: {
    agency_name: 'string or null',
    agency_address: 'string or null',
    phone: 'string or null',
  },
  coverage: {
    dwelling_limit: 'number or null',
    personal_property_limit: 'number or null',
    fair_rental_value_limit: 'number or null',
    liability_limit: 'number or null',
    medical_payments_limit: 'number or null',
    deductible_all_other_perils: 'number or null',
    hurricane_deductible_percent: 'number or null',
    hurricane_deductible_amount: 'number or null',
    total_annual_premium: 'number',
  },
  mortgagee: {
    name: 'string or null',
    address: 'string or null',
    loan_number: 'string or null',
  },
  confidence: '0-100',
  warnings: ['string'],
}

export const PROPERTY_POLICY_SYSTEM_PROMPT = `You extract a property insurance declarations page (dwelling / landlord / homeowners / commercial property). This is NOT a Certificate of Liability Insurance (ACORD).

Return JSON only matching this schema:
${JSON.stringify(PROPERTY_POLICY_JSON_SCHEMA, null, 2)}

Rules:
- named_insured on a dwelling/landlord policy is the property owner, not a tenant. Do not put this name in a tenant or lease field. Occupancy: Tenant is a rating classification, not a person.
- named_insured.mailing_address and insured_property.address are commonly different. A landlord often does not live at the insured property. Do not copy one address into the other.
- occupancy_type and property_use (for example Occupancy: Tenant, Use: Rental Property) describe how the property is used. Never extract a person's name from these fields.
- personal_property_limit of 0 or Excluded is a correct, real value on a landlord policy — the owner does not insure the tenant's belongings. Do not treat zero as a failed extraction and do not substitute null.
- Mortgagee names commonly carry a suffix like ISAOA ATIMA. Keep it attached to mortgagee.name as printed.
- There are usually three distinct dates: date_issued (print/issue), effective_date, and expiration_date. Map each explicitly. Do not let "the date" default to whichever appears first.
- Claims reporting on a personal-lines dwelling policy is almost always a generic carrier hotline, not a named contact. Extract carrier.claims_phone when the declarations page prints Claims Reporting / ClaimsReporting. Do not invent a claims contact name — personal-lines carriers do not assign a named contact until a claim is filed.
- This schema has no certificate_holder, additional_insured, or producer-as-COI fields. If the document is a tenant-furnished ACORD certificate, do not fill this schema.

Producer/agent sold the policy. Insurer/carrier underwrites it. Mortgagee is the lender.

Return null when a requested value is absent. Do not hallucinate.`

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
  return `File: ${fileName}\nThis is a dwelling / landlord policy declarations page. Extract named insured (owner, not a tenant), mailing address (often different from the insured property), producer, insurer, mortgagee, occupancy type, dates, and coverage. Do not invent a certificate holder or tenant name.`
}
