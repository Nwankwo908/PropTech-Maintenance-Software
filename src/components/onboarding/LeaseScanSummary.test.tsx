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
  expect(html).toContain('96% confidence · p. 3')
  expect(html).toContain('checking remaining fields')
  expect(html).toContain('Not stated in document')
  expect(html.match(/Needs review/g)).toHaveLength(1)
})
