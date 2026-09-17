import type { InsuranceDocumentType, TypedOrGenericExtractKind } from './types.ts'

/** Titles that actually identify the declarations / COI page — not coverage checklists. */
export const DECLARATIONS_MARKERS = [
  'POLICY DECLARATIONS',
  'DECLARATIONS PAGE',
  'CERTIFICATE OF LIABILITY INSURANCE',
] as const

/** Extra declarations titles some carriers use (still not checklist copy). */
const DECLARATIONS_TITLE_ALIASES = [
  'POLICY DECLARATION',
  'RENEWAL DECLARATIONS',
] as const

export const INSURANCE_SELECTED_PAGES_MAX = 6
export const INSURANCE_PAGE_FALLBACK_MAX = 8

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

function hasDeclarationsTitle(upper: string): boolean {
  return containsAny(upper, DECLARATIONS_MARKERS) || containsAny(upper, DECLARATIONS_TITLE_ALIASES)
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
    (hasDeclarationsTitle(upper) &&
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

function declarationsPageScore(upper: string): number {
  if (!hasDeclarationsTitle(upper)) return 0
  let score = 1
  if (upper.includes('NAMED INSURED')) score += 2
  if (upper.includes('MORTGAGEE')) score += 1
  if (upper.includes('LOCATION OF RESIDENCE')) score += 1
  if (upper.includes('CERTIFICATE HOLDER')) score += 2
  if (upper.includes('COVERAGE A')) score += 1
  if (/\$\s*[\d,]+/.test(upper)) score += 2
  return score
}

function lastTightCluster(pages: number[]): number[] {
  if (pages.length === 0) return []
  const last = pages[pages.length - 1]!
  const cluster = [last]
  for (let index = pages.length - 2; index >= 0; index -= 1) {
    const page = pages[index]!
    if (cluster[0]! - page <= 2) cluster.unshift(page)
    else break
  }
  return cluster
}

function looksLikeDeclarationsContinuation(upper: string): boolean {
  if (hasDeclarationsTitle(upper)) return true
  const isoBoilerplate =
    /\b(ISO|HO 00|DP 00|COPYRIGHT|FORM SCHEDULE)\b/.test(upper) &&
    !/\b(NAMED INSURED|MORTGAGEE|COVERAGE A)\b/.test(upper)
  if (isoBoilerplate) return false
  const markers = [
    'NAMED INSURED',
    'MORTGAGEE',
    'COVERAGE A',
    'LOCATION OF RESIDENCE',
    'TOTAL PREMIUM',
    'POLICY PERIOD',
    'CLAIMSREPORTING',
    'CLAIMS REPORTING',
  ]
  const hits = markers.filter((marker) => upper.includes(marker)).length
  return hits >= 1
}

function expandDeclarationsRange(pageTexts: string[], titlePages: number[]): number[] {
  if (titlePages.length === 0) return []
  const first = titlePages[0]!
  const lastTitle = titlePages[titlePages.length - 1]!
  let last = lastTitle
  for (let page = lastTitle + 1; page <= pageTexts.length && page <= lastTitle + 3; page += 1) {
    if (!looksLikeDeclarationsContinuation((pageTexts[page - 1] ?? '').toUpperCase())) break
    last = page
  }
  const start = Math.max(1, first - 1)
  const end = Math.min(pageTexts.length, last + 1)
  const selected: number[] = []
  for (let page = start; page <= end; page += 1) {
    selected.push(page)
    if (selected.length >= INSURANCE_SELECTED_PAGES_MAX) break
  }
  return selected
}

/**
 * Locate declarations / COI pages, then include one page of buffer on each side.
 * Do not return early checklist pages that mention Coverage A without a declarations title.
 */
export function findRelevantInsurancePages(pageTexts: string[]): number[] {
  const scored: Array<{ page: number; score: number }> = []
  for (let index = 0; index < pageTexts.length; index += 1) {
    const score = declarationsPageScore((pageTexts[index] ?? '').toUpperCase())
    if (score > 0) scored.push({ page: index + 1, score })
  }
  if (scored.length === 0) return []

  const maxScore = Math.max(...scored.map((row) => row.score))
  const bestHits = scored.filter((row) => row.score === maxScore).map((row) => row.page)
  return expandDeclarationsRange(pageTexts, lastTightCluster(bestHits))
}

export function slicePageTexts(pageTexts: string[], pageNumbers: number[]): string {
  if (pageNumbers.length === 0) return pageTexts.join('\n\n')
  return pageNumbers
    .map((page) => pageTexts[page - 1] ?? '')
    .filter((text) => text.trim())
    .join('\n\n')
}

export function isInsuranceUploadHint(fileName: string, documentCategory: string): boolean {
  const category = documentCategory.trim().toLowerCase()
  if (category === 'insurance_certificate' || category === 'property_insurance') return true
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
  if (
    type === 'dwelling_policy_declarations' ||
    type === 'dwelling' ||
    type === 'property_insurance_policy'
  ) {
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
- certificate_of_liability_insurance: ACORD / CERTIFICATE OF LIABILITY INSURANCE with Certificate Holder. Named insured is the tenant or vendor. Has producer / certificate holder / additional insured. No mortgagee, no dwelling Coverage A limits.
- dwelling_policy_declarations: dwelling / DP-3 / landlord hazard policy declarations. Named Insured is the owner. Occupancy: Tenant is not a COI. Has dwelling limits and often a mortgagee. No certificate_holder.
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
