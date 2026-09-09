import {
  classifyInsuranceDocumentType,
  insuranceDocumentTypeToKind,
} from './insuranceClassify.ts'
import type { TypedExtractKind, TypedOrGenericExtractKind } from './types.ts'

const KNOWN_CATEGORY: Record<string, TypedOrGenericExtractKind> = {
  rent_roll: 'rent_roll',
  resident_roster: 'rent_roll',
  lease_agreement: 'lease',
  move_in_document: 'lease',
  insurance_certificate: 'insurance',
  property_insurance: 'insurance',
}

export function resolveTypedExtractKind(
  fileName: string,
  documentCategory: string,
): TypedOrGenericExtractKind {
  const category = documentCategory.trim().toLowerCase()
  if (KNOWN_CATEGORY[category]) return KNOWN_CATEGORY[category]

  const lower = fileName.toLowerCase()
  if (/rent\s*roll|tenant\s*roster|resident\s*roster|tenant\s*list|resident\s*list/.test(lower)) {
    return 'rent_roll'
  }
  if (/lease|tenancy|rental\s+agreement|occupancy\s+agreement/.test(lower)) {
    return 'lease'
  }
  if (/\b(certificate of (liability )?insurance|\bcoi\b|acord)\b/.test(lower)) {
    return 'insurance_certificate'
  }
  if (/\b(dp-?3|dwelling)\b/.test(lower)) return 'dwelling_policy_declarations'
  if (/\b(ho-?[346]|homeowners?)\b/.test(lower)) return 'homeowners_policy_declarations'
  if (/commercial\s+property/.test(lower)) return 'commercial_property_policy'
  if (/insurance|declarations|binder/.test(lower)) return 'insurance'
  if (category === 'unknown' || !category) return 'unknown'
  return 'generic'
}

export function parseClassifierResponse(raw: unknown): TypedOrGenericExtractKind {
  const root = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const type = String(root.type ?? root.document_type ?? root.kind ?? '')
    .trim()
    .toLowerCase()
  if (type === 'rent_roll') return 'rent_roll'
  if (type === 'lease' || type === 'lease_agreement') return 'lease'
  if (
    type === 'insurance_certificate' ||
    type === 'coi' ||
    type === 'certificate_of_liability_insurance'
  ) {
    return 'insurance_certificate'
  }
  if (type === 'dwelling_policy_declarations' || type === 'dwelling') {
    return 'dwelling_policy_declarations'
  }
  if (type === 'homeowners_policy_declarations' || type === 'homeowners') {
    return 'homeowners_policy_declarations'
  }
  if (type === 'commercial_property_policy') return 'commercial_property_policy'
  if (type === 'insurance') return 'insurance'
  return 'unknown'
}

export function classifyInsuranceFromSnippet(snippet: string, fileName: string): TypedExtractKind | 'insurance' {
  const documentType = classifyInsuranceDocumentType(snippet, fileName)
  const kind = insuranceDocumentTypeToKind(documentType)
  return kind === 'insurance' ? 'insurance' : kind
}

export const CLASSIFY_SYSTEM_PROMPT = `You classify a property-management document.

Return JSON only: {"type":"rent_roll"|"lease"|"insurance"|"unknown"}

Rules:
- rent_roll: unit/tenant table, occupancy roster, rent schedule
- lease: residential lease or occupancy agreement
- insurance: any insurance document (COI, dwelling/homeowners/commercial declarations, binder). Do not assume it is a COI.
- unknown: anything else (vendor roster, W-9, invoice, inspection, P&L)

Do not extract fields. Do not guess beyond those four types.`
