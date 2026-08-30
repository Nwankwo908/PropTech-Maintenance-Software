import { describe, expect, it } from 'vitest'
import {
  canShowStartVendorOnboarding,
  countUnactivatedVendors,
  resolveVendorCapacityChip,
} from './vendorStatusChip'

describe('resolveVendorCapacityChip', () => {
  it('shows Not activated when the vendor has no verification row yet', () => {
    const chip = resolveVendorCapacityChip({ verificationStatus: null })
    expect(chip.status).toBe('not_started')
    expect(chip.label).toBe('Not activated')
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

  it('shows Active when onboarding is overridden without verification docs', () => {
    const chip = resolveVendorCapacityChip({
      verificationStatus: null,
      onboardingOverriddenAt: '2026-08-27T14:00:00.000Z',
    })
    expect(chip.status).toBe('active')
    expect(chip.matchable).toBe(true)
  })

  it('hides Start onboarding after verification or override', () => {
    expect(
      canShowStartVendorOnboarding({
        hasContact: true,
        verificationStatus: null,
      }),
    ).toBe(true)
    expect(
      canShowStartVendorOnboarding({
        hasContact: true,
        verificationStatus: 'verified',
      }),
    ).toBe(false)
    expect(
      canShowStartVendorOnboarding({
        hasContact: true,
        verificationStatus: 'submitted',
      }),
    ).toBe(false)
    expect(
      canShowStartVendorOnboarding({
        hasContact: true,
        verificationStatus: null,
        onboardingOverriddenAt: '2026-08-27T14:00:00.000Z',
      }),
    ).toBe(false)
    expect(
      canShowStartVendorOnboarding({
        hasContact: false,
        verificationStatus: null,
      }),
    ).toBe(false)
  })

  it('keeps pause and platform holds after onboarding override', () => {
    expect(
      resolveVendorCapacityChip({
        verificationStatus: null,
        onboardingOverriddenAt: '2026-08-27T14:00:00.000Z',
        availability: 'paused',
      }).status,
    ).toBe('paused')
    expect(
      resolveVendorCapacityChip({
        verificationStatus: null,
        onboardingOverriddenAt: '2026-08-27T14:00:00.000Z',
        rosterStatus: 'suspended',
      }).status,
    ).toBe('suspended')
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
        {
          verificationStatus: null,
          onboardingOverriddenAt: '2026-08-27T14:00:00.000Z',
        },
      ]),
    ).toBe(2)
  })
})
