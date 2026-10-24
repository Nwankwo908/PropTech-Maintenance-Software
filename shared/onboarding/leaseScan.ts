import { cleanExtractedName, parseIsoDate, parseMoney, parseRentDueDay, uniqueNames } from './typedDocumentExtract/parse.ts'
import type { LeaseExtract } from './typedDocumentExtract/types.ts'

export const LEASE_FIELD_LABELS = {
  tenant_names: 'Tenant names', property_address: 'Premises address', unit: 'Unit',
  lease_start: 'Lease start', lease_end: 'Lease end', monthly_rent: 'Monthly rent',
  security_deposit: 'Security deposit', rent_due_day: 'Rent due day',
} as const
export type LeaseFieldName = keyof typeof LEASE_FIELD_LABELS
export type LeaseFieldStatus = 'found' | 'not_stated' | 'unreadable' | 'uncertain' | 'conflict'
export type LeaseFieldEvidence = {
  value: string | number | string[] | null
  status: LeaseFieldStatus
  confidence: number
  pages: number[]
  quote: string
  source: 'embedded_text' | 'document_image'
  needsReview: boolean
  reviewReasons?: string[]
}
export type LeasePageCheck = { status: 'read' | 'blank' | 'unreadable'; summary: string }
export type LeaseScanReview = {
  pageChecks?: Record<string, LeasePageCheck>
  referenceKind?: 'page' | 'text_section'
  fields: Record<LeaseFieldName, LeaseFieldEvidence>
  pageCount: number
  pagesProvided: number[]
  pagesReviewed: number[]
  coverageComplete: boolean
  complete: boolean
  needsReview: boolean
  attempts: Array<{ provider: 'gemini' | 'openai'; model: string; phase: 'initial' | 'recovery' | 'backup'; pages: number[]; inputTokens: number; outputTokens: number; outcome: string; purpose?: 'fields' | 'coverage' }>
}
export type LeaseScanStage = 'reading' | 'checking' | 'recovering' | 'verifying_pages' | 'backup' | 'complete'
/** Fast Track reads only the opening pages so landlords can continue sooner. */
export const FAST_TRACK_LEASE_SCAN_PAGES = 4

/**
 * Keep the opening-page scan. When the file is longer, say so: later pages stay
 * unchecked, and a term missing from the pages that were read is not treated as
 * absent from the whole document.
 */
export function discloseFastTrackPartialScan(
  review: LeaseScanReview,
  originalPageCount: number,
  scannedPages: number[],
): LeaseScanReview {
  const scanned = [...new Set(scannedPages.filter((page) => Number.isInteger(page) && page > 0))].sort((a, b) => a - b)
  const pageCount = Math.max(originalPageCount, scanned.length, review.pageCount)
  if (!scanned.length || pageCount <= scanned.length) {
    const pagesReviewed = scanned.length ? scanned : review.pagesReviewed
    const complete = pagesReviewed.length > 0 && LEASE_FIELD_NAMES.every((name) => ['found', 'not_stated'].includes(review.fields[name].status))
    return {
      ...review,
      pageCount: pageCount || review.pageCount,
      pagesProvided: pagesReviewed,
      pagesReviewed,
      coverageComplete: pagesReviewed.length > 0 && pageCount <= pagesReviewed.length,
      complete,
      needsReview: !complete || LEASE_FIELD_NAMES.some((name) => review.fields[name].needsReview),
    }
  }
  const fields = { ...review.fields }
  for (const name of LEASE_FIELD_NAMES) {
    const field = fields[name]
    if (field.status !== 'not_stated') continue
    fields[name] = {
      ...field,
      value: null,
      status: 'unreadable',
      needsReview: true,
      reviewReasons: ['Not all document pages were confirmed as read, so this detail may still be present.'],
    }
  }
  return {
    ...review,
    fields,
    pageCount,
    pagesProvided: Array.from({ length: pageCount }, (_, index) => index + 1),
    pagesReviewed: scanned,
    coverageComplete: false,
    complete: false,
    needsReview: true,
  }
}
export const LEASE_FIELD_NAMES = Object.keys(LEASE_FIELD_LABELS) as LeaseFieldName[]
const record = (raw: unknown): Record<string, unknown> => raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {}
const percent = (raw: unknown) => typeof raw === 'number' && Number.isFinite(raw) ? Math.max(0, Math.min(100, raw)) : 0
// Normalize PDF typography without changing digits, amounts, or punctuation that distinguishes values.
const norm = (value: string) => value.normalize('NFKC').toLowerCase().replace(/\u00ad/g, '').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[\u2010-\u2014\u2212]/g, '-').replace(/\s+/g, ' ').trim()
const comparable = (value: LeaseFieldEvidence['value']) => Array.isArray(value) ? JSON.stringify(value.map(norm).sort()) : typeof value === 'string' ? norm(value) : value
function flagDateConflict(fields: LeaseScanReview['fields']) {
  if (fields.lease_start.status === 'found' && fields.lease_end.status === 'found' && typeof fields.lease_start.value === 'string' && typeof fields.lease_end.value === 'string' && fields.lease_start.value > fields.lease_end.value) {
    const reviewReasons = ['The lease end date is earlier than its start date.']
    fields.lease_start = { ...fields.lease_start, status: 'conflict', needsReview: true, reviewReasons }
    fields.lease_end = { ...fields.lease_end, status: 'conflict', needsReview: true, reviewReasons }
  }
}
export function validLeaseDate(value: unknown): string | null {
  const date = parseIsoDate(value)
  if (!date) return null
  const parsed = new Date(`${date}T12:00:00Z`)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date ? date : null
}
export function normalizeLeaseScan(raw: unknown, pageTexts: string[], pageNumbers?: number[]): { extract: LeaseExtract; review: LeaseScanReview } {
  const root = record(raw)
  const rawFields = record(root.fields)
  const provided = pageNumbers || pageTexts.map((_, i) => i + 1)
  const allowed = new Set(provided)
  const pagesReviewed = [...new Set((Array.isArray(root.pages_reviewed) ? root.pages_reviewed : []).filter((page): page is number => Number.isInteger(page) && allowed.has(page)))].sort((a,b) => a-b)
  const fields = {} as LeaseScanReview['fields']
  for (const name of LEASE_FIELD_NAMES) {
    const input = record(rawFields[name])
    let value: LeaseFieldEvidence['value'] = name === 'tenant_names' ? uniqueNames(input.value) : name === 'lease_start' || name === 'lease_end' ? validLeaseDate(input.value) : name === 'monthly_rent' || name === 'security_deposit' ? parseMoney(input.value) : name === 'rent_due_day' ? parseRentDueDay(input.value) : cleanExtractedName(input.value)
    if (typeof value === 'number' && value < 0) value = null
    const hasValue = value !== null && (!Array.isArray(value) || value.length > 0)
    const pages = [...new Set((Array.isArray(input.pages) ? input.pages : []).filter((page): page is number => Number.isInteger(page) && allowed.has(page)))].sort((a,b) => a-b)
    const quote = typeof input.quote === 'string' ? input.quote.trim().slice(0, 1000) : ''
    let status: LeaseFieldStatus = ['found','not_stated','unreadable','uncertain','conflict'].includes(String(input.status)) ? input.status as LeaseFieldStatus : 'unreadable'
    const reviewReasons: string[] = []
    const confidence = percent(input.confidence)
    if (status === 'found' && !hasValue) { status = 'unreadable'; reviewReasons.push('The extracted value is missing or invalid.') }
    if (status === 'found' && (!pages.length || !quote)) { status = 'unreadable'; reviewReasons.push('The source page or supporting text is missing.') }
    if (status === 'found' && confidence < 85) { status = 'uncertain'; reviewReasons.push('The reading confidence is below 85%.') }
    const matchingText = pages.some(page => pageTexts[page-1]?.trim() && norm(pageTexts[page-1]).includes(norm(quote)))
    const citedTextPages = pages.filter(page => (pageTexts[page-1] || '').trim().length >= 100)
    if (status === 'found' && citedTextPages.length === pages.length && !matchingText) { status = 'uncertain'; reviewReasons.push('The supporting text could not be matched to the cited page. Check the source text below.') }
    if (status === 'not_stated') value = null
    if (status === 'not_stated' && provided.some(page => !pagesReviewed.includes(page))) { status = 'unreadable'; reviewReasons.push('Not all document pages were confirmed as read, so this detail may still be present.') }
    const needsReview = !['found','not_stated'].includes(status) || (status === 'not_stated' && ['tenant_names','property_address','lease_start','monthly_rent'].includes(name))
    if (needsReview && !reviewReasons.length) reviewReasons.push(status === 'not_stated' ? 'The document does not state this required detail.' : status === 'conflict' ? 'The document contains conflicting readings for this detail.' : status === 'uncertain' ? 'The reading is uncertain; check the supporting source text.' : 'This detail could not be read reliably.')
    fields[name] = { value, status, confidence, pages, quote, source: matchingText ? 'embedded_text' : 'document_image', needsReview, ...(reviewReasons.length ? { reviewReasons } : {}) }
  }
  flagDateConflict(fields)
  const accepted = (name: LeaseFieldName) => fields[name].status === 'found' ? fields[name].value : null
  const found = LEASE_FIELD_NAMES.filter(name => fields[name].status === 'found')
  const extract: LeaseExtract = {
    landlord_name: cleanExtractedName(root.landlord_name), tenant_names: accepted('tenant_names') as string[] || [],
    guarantor_names: uniqueNames(root.guarantor_names), property_manager_name: cleanExtractedName(root.property_manager_name),
    property_address: accepted('property_address') as string | null, unit: accepted('unit') as string | null,
    lease_start: accepted('lease_start') as string | null, lease_end: accepted('lease_end') as string | null,
    monthly_rent: accepted('monthly_rent') as number | null, security_deposit: accepted('security_deposit') as number | null,
    rent_due_day: accepted('rent_due_day') as number | null,
    confidence: found.length ? Math.min(...found.map(name => fields[name].confidence)) : 0,
    warnings: uniqueNames(root.warnings),
  }
  const coverageComplete = provided.every(page => pagesReviewed.includes(page))
  const complete = coverageComplete && LEASE_FIELD_NAMES.every(name => ['found','not_stated'].includes(fields[name].status))
  return { extract, review: { fields, pageCount: pageTexts.length, pagesProvided: provided, pagesReviewed, coverageComplete, complete, needsReview: !complete || LEASE_FIELD_NAMES.some(name=>fields[name].needsReview), attempts: [] } }
}

/** Preserve readable fields. Disagreement is surfaced, never silently replaced. */
export function mergeLeaseScans(first: LeaseScanReview, next: LeaseScanReview, names: LeaseFieldName[] = LEASE_FIELD_NAMES): LeaseScanReview {
  const fields = { ...first.fields }
  for (const name of names) {
    const previous = fields[name], candidate = next.fields[name]
    if (previous.status === 'found' && candidate.status === 'found' && comparable(previous.value) !== comparable(candidate.value)) {
      fields[name] = { ...previous, status: 'conflict', needsReview: true, reviewReasons: ['Different readings disagree on this value. Check the source text below.'], confidence: Math.min(previous.confidence, candidate.confidence), pages: [...new Set([...previous.pages,...candidate.pages])], quote: `${previous.quote}\nConflicting reading: ${candidate.quote}`.slice(0,1000) }
    } else if (previous.status !== 'found' && previous.status !== 'conflict' && ['found','not_stated'].includes(candidate.status) && (candidate.status !== 'not_stated' || first.pagesProvided.every(page=>next.pagesProvided.includes(page)))) fields[name] = candidate
  }
  flagDateConflict(fields)
  const pagesReviewed = [...new Set([...first.pagesReviewed, ...next.pagesReviewed])].sort((a,b)=>a-b)
  const coverageComplete = first.pagesProvided.every(page => pagesReviewed.includes(page))
  const complete = coverageComplete && LEASE_FIELD_NAMES.every(name => ['found','not_stated'].includes(fields[name].status))
  return { ...first, fields, pagesReviewed, pageChecks: { ...first.pageChecks, ...next.pageChecks }, coverageComplete, complete, needsReview: !complete || LEASE_FIELD_NAMES.some(name=>fields[name].needsReview), attempts: next.attempts }
}
export function leaseScanToExtract(review: LeaseScanReview, parties: LeaseExtract): LeaseExtract {
  const accepted = (name: LeaseFieldName) => review.fields[name].status === 'found' ? review.fields[name].value : null
  return { ...parties, tenant_names: accepted('tenant_names') as string[] || [], property_address: accepted('property_address') as string | null, unit: accepted('unit') as string | null, lease_start: accepted('lease_start') as string | null, lease_end: accepted('lease_end') as string | null, monthly_rent: accepted('monthly_rent') as number | null, security_deposit: accepted('security_deposit') as number | null, rent_due_day: accepted('rent_due_day') as number | null }
}
export function leaseRecoveryFields(review: LeaseScanReview): LeaseFieldName[] {
  return LEASE_FIELD_NAMES.filter(name => review.fields[name].needsReview || (['tenant_names','property_address','lease_start','lease_end','monthly_rent'].includes(name) && review.fields[name].status === 'not_stated'))
}
export function selectLeaseRecoveryPages(fields: LeaseFieldName[], texts: string[], review: LeaseScanReview): number[] {
  const patterns: Record<LeaseFieldName, RegExp> = { tenant_names: /tenant|lessee|occupant|signature/i, property_address: /premises|address|property|located/i, unit: /unit|apt|apartment|suite/i, lease_start: /term|commenc|start|effective/i, lease_end: /term|expir|end|month.to.month/i, monthly_rent: /rent|monthly|payment/i, security_deposit: /deposit|security/i, rent_due_day: /rent|due|payable/i }
  const selected = new Set<number>()
  for (let i=0;i<texts.length;i++) if (texts[i].trim().length < 100 || fields.some(name => patterns[name].test(texts[i]))) selected.add(i+1)
  for (const name of fields) for (const page of review.fields[name].pages) selected.add(page)
  if (!selected.size) for (const page of review.pagesProvided) selected.add(page)
  return [...selected].sort((a,b)=>a-b)
}
