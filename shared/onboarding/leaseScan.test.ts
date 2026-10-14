import { describe, expect, it } from 'vitest'
import { leaseScanToExtract, mergeLeaseScans, normalizeLeaseScan, selectLeaseRecoveryPages } from './leaseScan'
import { leaseFixture } from './leaseScan.fixtures'
describe('lease evidence and completeness', () => {
  it('accepts explicit zero deposit and distinguishes unreadable from absent terms', () => {
    const raw = leaseFixture()
    raw.fields.unit = { ...raw.fields.unit, value: null, status: 'not_stated' }
    raw.fields.lease_end = { ...raw.fields.lease_end, value: null, status: 'unreadable' }
    const { extract, review } = normalizeLeaseScan(raw, [''])
    expect(extract.security_deposit).toBe(0)
    expect(review.fields.unit.needsReview).toBe(false)
    expect(review.fields.lease_end.needsReview).toBe(true)
    expect(review.needsReview).toBe(true)
  })
  it('requires coverage before claiming a term is absent', () => {
    const raw = leaseFixture()
    raw.fields.security_deposit = { ...raw.fields.security_deposit, value: null, status: 'not_stated' }
    const { review } = normalizeLeaseScan(raw, ['', ''])
    expect(review.coverageComplete).toBe(false)
    expect(review.fields.security_deposit.status).toBe('unreadable')
  })
  it('requires readable citations and keeps low-confidence guesses out of portfolio records', () => {
    const raw = leaseFixture()
    raw.fields.monthly_rent.confidence = 70
    raw.fields.tenant_names.quote = ''
    const { extract, review } = normalizeLeaseScan(raw, [''])
    expect(extract.monthly_rent).toBeNull()
    expect(extract.tenant_names).toEqual([])
    expect(review.fields.monthly_rent.value).toBe(1500)
  })
  it('checks verbatim embedded-text citations', () => {
    const { review } = normalizeLeaseScan(leaseFixture(), ['Completely different embedded text '.repeat(10)])
    expect(review.fields.monthly_rent.status).toBe('uncertain')
    const matching = normalizeLeaseScan(leaseFixture(), ['Lease terms '.repeat(20)])
    expect(matching.review.fields.monthly_rent.source).toBe('embedded_text')
  })
  it('rejects impossible dates, negative rent and invalid due days', () => {
    const raw = leaseFixture()
    raw.fields.lease_start.value = '2026-02-30'
    raw.fields.monthly_rent.value = -50
    raw.fields.rent_due_day.value = 32
    const { extract } = normalizeLeaseScan(raw, [''])
    expect(extract.lease_start).toBeNull()
    expect(extract.monthly_rent).toBeNull()
    expect(extract.rent_due_day).toBeNull()
  })
  it('does not silently swap reversed lease dates', () => {
    const raw = leaseFixture()
    raw.fields.lease_end.value = '2025-12-31'
    const { extract, review } = normalizeLeaseScan(raw, [''])
    expect(review.fields.lease_start.status).toBe('conflict')
    expect(extract.lease_start).toBeNull()
    expect(extract.lease_end).toBeNull()
  })
  it('keeps late pages and mixed scan pages in targeted recovery', () => {
    const texts = Array.from({ length: 12 }, () => 'Other lease information '.repeat(10))
    texts[4] = ''
    texts[11] = 'Monthly rent is payable '.repeat(10)
    const { review } = normalizeLeaseScan(leaseFixture(texts.map((_, i) => i + 1)), texts)
    expect(selectLeaseRecoveryPages(['monthly_rent'], texts, review)).toEqual([1, 5, 12])
  })
  it('does not accept a scoped reread as proof of absence throughout the document', () => {
    const raw = leaseFixture([1, 2])
    raw.fields.unit.status = 'unreadable'
    const first = normalizeLeaseScan(raw, ['', ''])
    const retry = leaseFixture([2])
    retry.fields.unit = { ...retry.fields.unit, status: 'not_stated', value: null }
    const next = normalizeLeaseScan(retry, ['', ''], [2])
    const merged = mergeLeaseScans(first.review, next.review, ['unit'])
    expect(merged.fields.unit.status).toBe('unreadable')
  })
  it('surfaces disagreement and normalizes harmless case/name ordering differences', () => {
    const first = normalizeLeaseScan(leaseFixture(), [''])
    const raw = leaseFixture()
    raw.fields.tenant_names.value = ['MORGAN TENANT']
    raw.fields.monthly_rent.value = 1600
    const next = normalizeLeaseScan(raw, [''])
    const merged = mergeLeaseScans(first.review, next.review)
    expect(merged.fields.tenant_names.status).toBe('found')
    expect(merged.fields.monthly_rent.status).toBe('conflict')
    expect(leaseScanToExtract(merged, first.extract).monthly_rent).toBeNull()
  })
  it('checks chronology again when recovery fills a missing end date', () => {
    const raw = leaseFixture()
    raw.fields.lease_end = { ...raw.fields.lease_end, value: null, status: 'unreadable' }
    const first = normalizeLeaseScan(raw, [''])
    const nextRaw = leaseFixture()
    nextRaw.fields.lease_end.value = '2025-12-31'
    nextRaw.fields.lease_start.status = 'unreadable'
    const next = normalizeLeaseScan(nextRaw, [''])
    const merged = mergeLeaseScans(first.review, next.review, ['lease_end'])
    expect(merged.fields.lease_start.status).toBe('conflict')
  })
})
