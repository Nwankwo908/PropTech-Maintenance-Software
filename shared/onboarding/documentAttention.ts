import { LEASE_FIELD_LABELS, LEASE_FIELD_NAMES, type LeaseFieldEvidence, type LeaseFieldName, type LeaseScanReview } from './leaseScan.ts'

export function leaseFieldReviewReasons(field: LeaseFieldEvidence): string[] {
  if (!field.needsReview && ['found', 'not_stated'].includes(field.status)) return []
  if (field.reviewReasons?.length) return field.reviewReasons
  if (field.status === 'conflict') return ['Conflicting readings need to be checked against the document.']
  if (field.status === 'not_stated') return ['This required detail was not found in the document.']
  if (field.status === 'unreadable' || field.value == null) return ['This detail could not be read reliably.']
  if (!field.pages.length || !field.quote) return ['The source page or supporting text is missing.']
  if (field.confidence < 85) return ['The reading confidence is below 85%.']
  return ['This reading has not passed source verification. Check the supporting text.']
}

export function leaseReviewIssues(review: LeaseScanReview): { fields: LeaseFieldName[]; pages: number[]; reasons: string[] } {
  const fields = LEASE_FIELD_NAMES.filter(name => leaseFieldReviewReasons(review.fields[name]).length > 0)
  const pages = Array.from({ length: review.pageCount }, (_, i) => i + 1).filter(page => !review.pagesProvided.includes(page) || !review.pagesReviewed.includes(page))
  const reasons = fields.flatMap(name => leaseFieldReviewReasons(review.fields[name]).map(reason => `${LEASE_FIELD_LABELS[name]}: ${reason}`))
  if (pages.length) reasons.unshift(`Page coverage needs review: ${pages.length === 1 ? 'page' : 'pages'} ${pages.join(', ')} ${pages.length === 1 ? 'was' : 'were'} not confirmed as read.`)
  if (!review.pageCount) reasons.unshift('The document page count could not be verified.')
  return { fields, pages, reasons }
}

export function documentAttention(input: { extracted: { leaseReview?: LeaseScanReview; warnings: string[] }; hasData: boolean }) {
  if (input.extracted.leaseReview) {
    const issues = leaseReviewIssues(input.extracted.leaseReview)
    if (!input.hasData && !issues.reasons.length) issues.reasons.push('No property, tenant or lease records were extracted.')
    return { needsAttention: issues.reasons.length > 0, attentionReasons: issues.reasons }
  }
  const attentionReasons = input.extracted.warnings.filter(warning => /not supported|not parsed|upload pdf|upload csv/i.test(warning))
  if (!input.hasData) attentionReasons.unshift('No property, tenant, vendor or lease records were extracted.')
  return { needsAttention: attentionReasons.length > 0, attentionReasons }
}

export function leaseAttentionMessage(review: LeaseScanReview): string | null {
  const { fields, reasons } = leaseReviewIssues(review)
  if (!reasons.length) return null
  if (!fields.length) return reasons[0]
  const names = fields.map(name => LEASE_FIELD_LABELS[name])
  return `Review ${names.length > 3 ? `${names.length} flagged lease fields` : names.join(', ')}. The reason is shown beside each flagged detail below.`
}
