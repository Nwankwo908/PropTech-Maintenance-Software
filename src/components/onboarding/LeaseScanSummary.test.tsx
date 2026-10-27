import { expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { LeaseScanSummary } from './LeaseScanSummary'
import { normalizeLeaseScan } from '@shared/onboarding/leaseScan'
import { leaseFixture } from '@shared/onboarding/leaseScan.fixtures'

it('waits until the scan finishes before saying the lease is ready', () => {
  const raw = leaseFixture([1, 2, 3])
  raw.fields.monthly_rent.pages = [3]
  raw.fields.unit = { ...raw.fields.unit, value: null, status: 'not_stated' }
  raw.fields.lease_end = { ...raw.fields.lease_end, value: null, status: 'unreadable' }
  const { review } = normalizeLeaseScan(raw, ['', '', ''])
  const html = renderToStaticMarkup(<LeaseScanSummary review={review} processing />)
  expect(html).toContain('Checking this lease')
  expect(html).toContain('3 of 3 pages checked')
  expect(html).not.toContain('detail')
  expect(html).not.toContain('Morgan Tenant')
})

it('tells you a finished scan is ready for review', () => {
  const raw = leaseFixture()
  raw.fields.monthly_rent.confidence = 100
  raw.fields.monthly_rent.quote = ''
  const { review } = normalizeLeaseScan(raw, [''])
  const html = renderToStaticMarkup(<LeaseScanSummary review={review} processing={false} />)
  expect(html).toContain('Your lease is ready for review')
  expect(html).toContain('Check the extracted details on the next step.')
  expect(html).not.toContain('Lease scanned')
  expect(html).not.toContain('1 of 1 page checked')
  expect(html).not.toContain('to review')
  expect(html).not.toContain('Morgan Tenant')
  expect(html).not.toContain('Unverified reading')
  expect(html).not.toContain('$1,500.00')
  expect(html).not.toContain('confirm or correct')
})

it('says when only the opening pages of a longer lease were checked', () => {
  const { review } = normalizeLeaseScan(leaseFixture([1, 2, 3, 4]), ['', '', '', ''])
  review.pageCount = 12
  review.pagesProvided = Array.from({ length: 12 }, (_, index) => index + 1)
  review.pagesReviewed = [1, 2, 3, 4]
  review.coverageComplete = false
  const html = renderToStaticMarkup(<LeaseScanSummary review={review} processing={false} />)
  expect(html).toContain('Your lease is ready for review')
  expect(html).toContain('Check the extracted details on the next step.')
  expect(html).not.toContain('4 of 12 pages checked')
  expect(html).not.toContain('12 of 12')
  expect(html).not.toContain('Morgan Tenant')
  expect(html).not.toContain('1500')
})

it('counts every page that was checked and does not turn a coverage gap into a field list', () => {
  const raw = leaseFixture()
  for (const field of Object.values(raw.fields)) field.confidence = 100
  const { review } = normalizeLeaseScan(raw, ['', ''])
  const html = renderToStaticMarkup(<LeaseScanSummary review={review} processing={false} />)
  expect(html).toContain('Your lease is ready for review')
  expect(html).toContain('Check the extracted details on the next step.')
  expect(html).not.toContain('1 of 2 pages checked')
  expect(html).not.toContain('to review')
  expect(html).not.toContain('Page coverage needs review')
  expect(html).not.toContain('Unverified reading')
})
