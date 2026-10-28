import { describe, expect, it } from 'vitest'
import {
  isAlreadyTenantResolved,
  looksLikeTenantReportedFix,
  residentCloseKind,
  tenantResolvedTicketPatch,
} from './tenantReportedFix'

describe('looksLikeTenantReportedFix', () => {
  it('recognizes a tenant saying the repair is fixed', () => {
    for (const body of [
      'FIXED',
      'fixed',
      'I fixed it',
      'Never mind, I fixed it.',
      "It's fixed",
      'The faucet is fixed',
      'I already fixed the leak',
    ]) {
      expect(looksLikeTenantReportedFix(body)).toBe(true)
    }
  })

  it('leaves a cancellation as a cancellation', () => {
    for (const body of ['Cancel it', 'Please cancel the repair', 'Never mind']) {
      expect(looksLikeTenantReportedFix(body)).toBe(false)
    }
  })
})

describe('residentCloseKind', () => {
  it('keeps a named follow-up on the original fix', () => {
    expect(residentCloseKind({
      body: 'the kitchen faucet',
      pendingCloseAs: 'resolved',
    })).toBe('resolved')
  })

  it('does not treat a later cancel as a fix', () => {
    expect(residentCloseKind({
      body: 'Cancel it',
      pendingCloseAs: 'resolved',
    })).toBe('cancelled')
  })
})

describe('tenantResolvedTicketPatch', () => {
  it('uses completed for the request and the work order', () => {
    const patch = tenantResolvedTicketPatch('2026-10-28T14:00:00.000Z')
    expect(patch.status).toBe('completed')
    expect(patch.vendor_work_status).toBe('completed')
    expect(patch.resolution).toBe('tenant_self_fix')
    expect(patch.cancelled_at).toBeNull()
    expect(patch.assigned_vendor_id).toBeNull()
  })

  it('treats an existing completion as already closed', () => {
    expect(isAlreadyTenantResolved({
      status: 'open',
      vendorWorkStatus: 'completed',
    })).toBe(true)
    expect(isAlreadyTenantResolved({
      status: 'open',
      vendorWorkStatus: 'cancelled',
    })).toBe(false)
  })
})
