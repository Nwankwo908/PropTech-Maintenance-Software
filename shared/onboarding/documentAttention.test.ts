import { expect, it } from 'vitest'
import { documentAttention, leaseAttentionMessage, leaseReviewIssues } from './documentAttention'
import { normalizeLeaseScan } from './leaseScan'
import { leaseFixture } from './leaseScan.fixtures'
const confident = (pages = [1]) => {
  const raw = leaseFixture(pages)
  for (const field of Object.values(raw.fields)) field.confidence = 100
  return raw
}
it('does not flag a fully validated 100% lease because of unrelated generic warnings or stale aggregate flags', () => {
  const { review } = normalizeLeaseScan(confident(), [''])
  review.needsReview = true
  const result = documentAttention({ hasData: true, extracted: { leaseReview: review, warnings: ['Some signatures are not parsed. Upload PDF if you want those read.'] } })
  expect(result).toEqual({ needsAttention: false, attentionReasons: [] })
})
it('names unread pages without implying the validated fields need review', () => {
  const { review } = normalizeLeaseScan(confident(), ['', '', ''])
  const issues = leaseReviewIssues(review)
  expect(issues.fields).toEqual([])
  expect(issues.pages).toEqual([2, 3])
  expect(leaseAttentionMessage(review)).toBe('Page coverage needs review: pages 2, 3 were not confirmed as read.')
})
it('explains a failed evidence check despite reported 100% confidence', () => {
  const raw = confident()
  const { review } = normalizeLeaseScan(raw, ['A different source text '.repeat(20)])
  expect(review.fields.monthly_rent.confidence).toBe(100)
  expect(documentAttention({ extracted: { leaseReview: review, warnings: [] }, hasData: true }).attentionReasons).toContain('Monthly rent: The supporting text could not be matched to the cited page. Check the source text below.')
})
it('does not treat 100% confidence as permission to accept impossible dates', () => {
  const raw = confident()
  raw.fields.lease_start.value = '2026-02-30'
  const { review, extract } = normalizeLeaseScan(raw, [''])
  expect(extract.lease_start).toBeNull()
  expect(leaseReviewIssues(review).fields).toContain('lease_start')
  expect(review.fields.lease_start.reviewReasons).toEqual(['The extracted value is missing or invalid.'])
})
it('keeps legacy attention rules for documents without structured lease review', () => {
  expect(documentAttention({ hasData: true, extracted: { warnings: ['Spreadsheet not supported'] } }).needsAttention).toBe(true)
})
