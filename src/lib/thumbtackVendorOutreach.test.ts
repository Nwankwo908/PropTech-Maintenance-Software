import { describe, expect, it } from 'vitest'
import { buildThumbtackVendorOutreachMessage } from '@shared/externalVendor/thumbtackOutreachCopy'

describe('buildThumbtackVendorOutreachMessage', () => {
  it('uses the landlord default with job context', () => {
    const text = buildThumbtackVendorOutreachMessage({
      propertyAddress: '78 Maple Ave, Irvington, NJ 07111',
      jobCategory: 'appliance_repair',
      issueSummary: 'Oven is not heating',
      urgency: 'urgent',
      timeframe: 'this week',
    })
    expect(text).toContain('78 Maple Ave')
    expect(text).toMatch(/appliance/i)
    expect(text).toContain('Oven is not heating')
    expect(text).toContain('urgent')
    expect(text).toContain('this week')
    expect(text).toContain('Are you available to take this job?')
  })
})
