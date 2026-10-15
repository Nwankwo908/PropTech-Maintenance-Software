import { expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { LeaseScanSummary } from './LeaseScanSummary'
import { normalizeLeaseScan } from '@shared/onboarding/leaseScan'
import { leaseFixture } from '@shared/onboarding/leaseScan.fixtures'
it('shows readable details, original page references and confidence while recovery continues', () => {
  const raw = leaseFixture([1, 2, 3])
  raw.fields.monthly_rent.pages = [3]
  raw.fields.unit = { ...raw.fields.unit, value: null, status: 'not_stated' }
  raw.fields.lease_end = { ...raw.fields.lease_end, value: null, status: 'unreadable' }
  const { review } = normalizeLeaseScan(raw, ['', '', ''])
  const html = renderToStaticMarkup(<LeaseScanSummary review={review} processing />)
  expect(html).toContain('Morgan Tenant')
  expect(html).toContain('$1,500.00')
  expect(html).toContain('96% extraction confidence · p. 3')
  expect(html).toContain('checking remaining fields')
  expect(html).toContain('Not stated in document')
  expect(html.match(/Needs review/g)).toHaveLength(1)
})
it('distinguishes an unverified 100% reading from a validated field and shows its reason', () => {
  const raw = leaseFixture()
  raw.fields.monthly_rent.confidence = 100
  raw.fields.monthly_rent.quote = ''
  const { review } = normalizeLeaseScan(raw, [''])
  const html = renderToStaticMarkup(<LeaseScanSummary review={review} processing={false} />)
  expect(html).toContain('Unverified reading · reported confidence 100%')
  expect(html).toContain('The source page or supporting text is missing.')
})
it('lists unreviewed pages while leaving validated 100% field rows unflagged', () => {
  const raw = leaseFixture()
  for (const field of Object.values(raw.fields)) field.confidence = 100
  const { review } = normalizeLeaseScan(raw, ['', ''])
  const html = renderToStaticMarkup(<LeaseScanSummary review={review} processing={false} />)
  expect(html).toContain('Page coverage needs review: page 2 was not confirmed as read.')
  expect(html).not.toContain('Unverified reading')
  expect(html).not.toContain('Needs review')
})
