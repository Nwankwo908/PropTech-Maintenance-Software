import { describe, expect, it } from 'vitest'
import {
  formatLandlordEscalationReason,
  isMaintenanceAdminVendorEscalationReason,
  looksLikeInternalEscalationCode,
  maintenanceAdminVendorAttentionMeta,
  maintenanceAdminVendorAttentionTitle,
  shouldSkipSlaReassignForNeedsAdminVendor,
} from '@/lib/maintenanceAdminVendor'

describe('maintenanceAdminVendor', () => {
  it('treats submit-with-no-vendor as an admin vendor escalation', () => {
    expect(isMaintenanceAdminVendorEscalationReason('no_vendor_available')).toBe(
      true,
    )
    expect(maintenanceAdminVendorAttentionTitle('no_vendor_available')).toBe(
      'Assign a vendor',
    )
    expect(
      maintenanceAdminVendorAttentionMeta('no_vendor_available', 'plumbing'),
    ).toMatch(/plumbers/i)
  })

  it('keeps SLA and decline reasons on the replacement path', () => {
    expect(
      isMaintenanceAdminVendorEscalationReason('sla_expired_no_vendor'),
    ).toBe(true)
    expect(
      maintenanceAdminVendorAttentionTitle('vendor_declined_no_vendor'),
    ).toBe('Find a Replacement Vendor')
    expect(isMaintenanceAdminVendorEscalationReason('unassigned')).toBe(false)
  })

  it('formats sla_expired_no_vendor in plain language', () => {
    expect(looksLikeInternalEscalationCode('sla_expired_no_vendor')).toBe(true)
    const plain = formatLandlordEscalationReason('sla_expired_no_vendor', 'appliance')
    expect(plain).toMatch(/response time has passed/i)
    expect(plain).not.toMatch(/sla_expired/i)
  })
})
