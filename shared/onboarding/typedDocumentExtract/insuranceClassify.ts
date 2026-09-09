import type { InsuranceDocumentType, TypedOrGenericExtractKind } from './types.ts'

export const INSURANCE_PAGE_MARKERS = [
  'POLICY DECLARATIONS',
  'POLICY DECLARATION',
  'DECLARATIONS PAGE',
  'RENEWAL DECLARATIONS',
  'DWELLING POLICY',
  'LOCATION OF RESIDENCE PREMISES',
  'CERTIFICATE OF LIABILITY INSURANCE',
  'ACORD',
  'COVERAGE A',
] as const

const COI_MARKERS = [
  'CERTIFICATE OF LIABILITY INSURANCE',
  'CERTIFICATE HOLDER',
]

const DWELLING_MARKERS = [
  'DWELLING POLICY',
  'DP-3',
  'DP3',
  'LOCATION OF RESIDENCE PREMISES',
  'INSURED LOCATION',
]

const HOMEOWNERS_MARKERS = ['HOMEOWNERS POLICY', 'HO-3', 'HO3', 'HO-6', 'HO6']

const COMMERCIAL_MARKERS = ['COMMERCIAL PROPERTY POLICY', 'COMMERCIAL PROPERTY DECLARATIONS']

export function insuranceDocumentTypeToKind(
  documentType: InsuranceDocumentType,
): TypedOrGenericExtractKind {
  if (documentType === 'certificate_of_liability_insurance') return 'insurance_certificate'
  if (documentType === 'dwelling_policy_declarations') return 'dwelling_policy_declarations'
  if (documentType === 'homeowners_policy_declarations') return 'homeowners_policy_declarations'
  if (documentType === 'commercial_property_policy') return 'commercial_property_policy'
  return 'insurance'
}

export function kindToInsuranceDocumentType(kind: TypedOrGenericExtractKind): InsuranceDocumentType {
  if (kind === 'insurance_certificate') return 'certificate_of_liability_insurance'
  if (kind === 'dwelling_policy_declarations') return 'dwelling_policy_declarations'
  if (kind === 'homeowners_policy_declarations') return 'homeowners_policy_declarations'
  if (kind === 'commercial_property_policy') return 'commercial_property_policy'
  return 'unknown'
}

function containsAny(haystack: string, markers: readonly string[]): boolean {
  return markers.some((marker) => haystack.includes(marker))
}

function classifyFromFileName(fileName: string): InsuranceDocumentType {
  const lower = fileName.toLowerCase()
  if (/\b(certificate of (liability )?insurance|\bcoi\b|acord)\b/.test(lower)) {
    return 'certificate_of_liability_insurance'
  }
  if (/\b(dp-?3|dwelling)\b/.test(lower)) return 'dwelling_policy_declarations'
  if (/\b(ho-?[346]|homeowners?)\b/.test(lower)) return 'homeowners_policy_declarations'
  if (/commercial\s+property/.test(lower)) return 'commercial_property_policy'
  return 'unknown'
}

/**
 * Classify insurance document type from extracted text before field extraction.
 * Do not treat every insurance PDF as a COI.
 */
export function classifyInsuranceDocumentType(
  text: string,
  fileName = '',
): InsuranceDocumentType {
  const upper = text.toUpperCase()
  const hasCoiTitle = upper.includes('CERTIFICATE OF LIABILITY INSURANCE')
  const hasAcord = upper.includes('ACORD') && upper.includes('CERTIFICATE HOLDER')
  const hasDwelling =
    containsAny(upper, DWELLING_MARKERS) ||
    ((upper.includes('POLICY DECLARATIONS') ||
      upper.includes('POLICY DECLARATION') ||
      upper.includes('RENEWAL DECLARATIONS') ||
      upper.includes('DECLARATIONS PAGE')) &&
      (upper.includes('NAMED INSURED') || upper.includes('MORTGAGEE')) &&
      !hasCoiTitle)
  const hasHomeowners = containsAny(upper, HOMEOWNERS_MARKERS)
  const hasCommercial = containsAny(upper, COMMERCIAL_MARKERS)

  if (hasCoiTitle || (hasAcord && !hasDwelling && !hasHomeowners)) {
    return 'certificate_of_liability_insurance'
  }
  if (hasDwelling && !hasCoiTitle) return 'dwelling_policy_declarations'
  if (hasHomeowners && !hasCoiTitle) return 'homeowners_policy_declarations'
  if (hasCommercial && !hasCoiTitle) return 'commercial_property_policy'

  const fromName = classifyFromFileName(fileName)
  if (fromName !== 'unknown') return fromName
  if (containsAny(upper, COI_MARKERS) && !hasDwelling) return 'certificate_of_liability_insurance'
  return 'unknown'
}

export function findRelevantInsurancePages(pageTexts: string[]): number[] {
  const hits: number[] = []
  for (let index = 0; index < pageTexts.length; index += 1) {
    const upper = (pageTexts[index] ?? '').toUpperCase()
    if (INSURANCE_PAGE_MARKERS.some((marker) => upper.includes(marker))) {
      hits.push(index + 1)
    }
  }
  if (hits.length === 0) return []
  const expanded = new Set<number>()
  for (const page of hits) {
    expanded.add(page)
    if (page + 1 <= pageTexts.length) expanded.add(page + 1)
    if (page + 2 <= pageTexts.length) expanded.add(page + 2)
  }
  return [...expanded].sort((a, b) => a - b).slice(0, 5)
}

export function slicePageTexts(pageTexts: string[], pageNumbers: number[]): string {
  if (pageNumbers.length === 0) return pageTexts.join('\n\n')
  return pageNumbers
    .map((page) => pageTexts[page - 1] ?? '')
    .filter((text) => text.trim())
    .join('\n\n')
}

export function isInsuranceUploadHint(fileName: string, documentCategory: string): boolean {
  if (documentCategory.trim().toLowerCase() === 'insurance_certificate') return true
  return /insurance|coi|acord|dwelling|dp-?3|homeowners|declarations|binder/i.test(fileName)
}

export function parseInsuranceTypeClassifierResponse(raw: unknown): InsuranceDocumentType {
  const root = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const type = String(root.document_type ?? root.type ?? root.kind ?? '')
    .trim()
    .toLowerCase()
  if (
    type === 'certificate_of_liability_insurance' ||
    type === 'insurance_certificate' ||
    type === 'coi'
  ) {
    return 'certificate_of_liability_insurance'
  }
  if (type === 'dwelling_policy_declarations' || type === 'dwelling') {
    return 'dwelling_policy_declarations'
  }
  if (type === 'homeowners_policy_declarations' || type === 'homeowners') {
    return 'homeowners_policy_declarations'
  }
  if (type === 'commercial_property_policy' || type === 'commercial_property') {
    return 'commercial_property_policy'
  }
  return 'unknown'
}

export const CLASSIFY_INSURANCE_SYSTEM_PROMPT = `You classify an insurance document. Return JSON only:
{"document_type":"certificate_of_liability_insurance"|"dwelling_policy_declarations"|"homeowners_policy_declarations"|"commercial_property_policy"|"unknown"}

Rules:
- certificate_of_liability_insurance: ACORD / CERTIFICATE OF LIABILITY INSURANCE with Certificate Holder.
- dwelling_policy_declarations: dwelling / DP-3 / landlord hazard policy declarations. Named Insured is the owner. Occupancy: Tenant is not a COI.
- homeowners_policy_declarations: HO-3 / homeowners declarations.
- commercial_property_policy: commercial property policy declarations.
- unknown: insurance-related but type is unclear.

Do not classify a dwelling or homeowners declarations page as a COI.
Do not extract fields.`

export function refineInsuranceExtractKind(
  kind: TypedOrGenericExtractKind,
  text: string,
  fileName: string,
): TypedOrGenericExtractKind {
  const looksInsurance =
    kind === 'insurance' ||
    kind === 'insurance_certificate' ||
    kind === 'dwelling_policy_declarations' ||
    kind === 'homeowners_policy_declarations' ||
    kind === 'commercial_property_policy'
  if (!looksInsurance) return kind
  const classified = classifyInsuranceDocumentType(text, fileName)
  if (classified !== 'unknown') return insuranceDocumentTypeToKind(classified)
  return kind
}
