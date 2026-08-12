import { describe, expect, it } from 'vitest'
import { resolveVendorCapacityChip, countUnactivatedVendors } from './vendorStatusChip'

describe('resolveVendorCapacityChip', () => {
  it('shows Not started when the vendor has no verification row yet', () => {
    const chip = resolveVendorCapacityChip({ verificationStatus: null })
    expect(chip.status).toBe('not_started')
    expect(chip.label).toBe('Not started')
    expect(chip.matchable).toBe(false)
  })

  it('shows Waiting for vendor after an invite is sent', () => {
    const chip = resolveVendorCapacityChip({ verificationStatus: 'invited' })
    expect(chip.status).toBe('pending')
    expect(chip.label).toBe('Waiting for vendor')
    expect(chip.matchable).toBe(false)
  })

  it('shows Active only when verified and accepting work', () => {
    const chip = resolveVendorCapacityChip({
      verificationStatus: 'verified',
      vendorActive: true,
      availability: 'active',
    })
    expect(chip.status).toBe('active')
    expect(chip.matchable).toBe(true)
  })
})

describe('countUnactivatedVendors', () => {
  it('counts vendors who are not Active for dispatch', () => {
    expect(
      countUnactivatedVendors([
        { verificationStatus: null },
        { verificationStatus: 'invited' },
        {
          verificationStatus: 'verified',
          vendorActive: true,
          availability: 'active',
        },
      ]),
    ).toBe(2)
  })
})
