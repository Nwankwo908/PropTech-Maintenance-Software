import { describe, expect, it } from 'vitest'
import {
  buildVendorInsuranceRequestSms,
  buildVendorVerificationRequestSms,
  vendorVerificationRequestTitle,
} from './vendorInsuranceRequestSms'

describe('buildVendorVerificationRequestSms', () => {
  it('addresses the vendor by name and includes company + link', () => {
    const body = buildVendorInsuranceRequestSms({
      vendorLabel: 'Flex Plumbing',
      companyName: 'Maple Properties',
      renewalLink: 'https://www.ulohome.io/v/token',
    })
    expect(body).toContain('Hi Flex Plumbing,')
    expect(body).toContain('property management team at Maple Properties')
    expect(body).toContain('updated certificate of insurance')
    expect(body).toContain('https://www.ulohome.io/v/token')
  })

  it('falls back when name or company is missing', () => {
    const body = buildVendorInsuranceRequestSms({
      vendorLabel: '',
      renewalLink: 'https://www.ulohome.io/v/…',
    })
    expect(body).toContain('Hi there,')
    expect(body).toContain('This is the property management team.')
  })

  it('builds kind-specific copy for license and w9', () => {
    expect(
      buildVendorVerificationRequestSms({
        itemId: 'license',
        vendorLabel: 'Apex',
        renewalLink: 'https://www.ulohome.io/v/t',
      }),
    ).toContain('updated state license')
    expect(
      buildVendorVerificationRequestSms({
        itemId: 'w9',
        vendorLabel: 'Apex',
        renewalLink: 'https://www.ulohome.io/v/t',
      }),
    ).toContain('W-9 details')
    expect(vendorVerificationRequestTitle('trade_categories')).toBe(
      'Request trade categories',
    )
  })
})
