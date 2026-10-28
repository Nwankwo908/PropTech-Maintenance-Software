import { describe, expect, it } from 'vitest'
import { adminRequestStatusFromDb } from './adminRequestStatus'

describe('adminRequestStatusFromDb', () => {
  it('shows a tenant-reported fix as completed', () => {
    expect(adminRequestStatusFromDb({
      status: 'completed',
      vendorWorkStatus: 'completed',
    })).toBe('completed')
  })

  it('does not show a completed request as a cancellation', () => {
    expect(adminRequestStatusFromDb({
      status: 'completed',
      vendorWorkStatus: 'cancelled',
    })).toBe('completed')
  })

  it('still shows an open request whose work order was cancelled', () => {
    expect(adminRequestStatusFromDb({
      status: 'open',
      vendorWorkStatus: 'cancelled',
    })).toBe('cancelled')
  })

  it('shows an open request as assigned when no work-order status is set', () => {
    expect(adminRequestStatusFromDb({ status: 'open', vendorWorkStatus: null })).toBe('assigned')
  })
})
