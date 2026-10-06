import { describe, expect, it } from 'vitest'
import {
  formatLandlordEscalationReason,
  isMaintenanceAdminVendorEscalationReason,
  isStalePendingAcceptNeedsAdminVendor,
  looksLikeInternalEscalationCode,
  maintenanceAdminVendorAttentionMeta,
  maintenanceAdminVendorAttentionTitle,
  shouldSkipSlaReassignForNeedsAdminVendor,
  STALE_PENDING_ACCEPT_NEEDS_ADMIN_STATUS_LABEL,
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

  it('flags sticky needs_admin + stale pending_accept as unresponsive, not ordinary waiting', () => {
    expect(
      isStalePendingAcceptNeedsAdminVendor({
        vendorWorkStatus: 'pending_accept',
        assignedVendorId: 'vendor-1',
        autoReassignLastOutcome: 'needs_admin_vendor|sla_expired',
      }),
    ).toBe(true)
    expect(
      isStalePendingAcceptNeedsAdminVendor({
        vendorWorkStatus: 'pending_accept',
        assignedVendorId: 'vendor-1',
        autoReassignLastOutcome: null,
        workflowNeedsAdminVendor: true,
      }),
    ).toBe(true)
    expect(
      isStalePendingAcceptNeedsAdminVendor({
        vendorWorkStatus: 'pending_accept',
        assignedVendorId: 'vendor-1',
        autoReassignLastOutcome: null,
        workflowNeedsAdminVendor: false,
      }),
    ).toBe(false)
    expect(
      isStalePendingAcceptNeedsAdminVendor({
        vendorWorkStatus: 'pending_accept',
        assignedVendorId: null,
        autoReassignLastOutcome: 'needs_admin_vendor|stall_follow_up',
      }),
    ).toBe(false)
    expect(STALE_PENDING_ACCEPT_NEEDS_ADMIN_STATUS_LABEL).toMatch(/unresponsive/i)
  })
})
