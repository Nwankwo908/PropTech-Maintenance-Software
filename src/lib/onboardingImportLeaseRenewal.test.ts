import { describe, expect, it } from 'vitest'
import { isOnboardingImportLeaseRenewalRun } from '@/lib/onboardingImportLeaseRenewal'

describe('isOnboardingImportLeaseRenewalRun', () => {
  it('matches Fast Track dummy runs tagged onboarding_import', () => {
    expect(
      isOnboardingImportLeaseRenewalRun('lease_renewal', { source: 'onboarding_import' }),
    ).toBe(true)
  })

  it('matches dummy runs stored as lease_document when no resident matched', () => {
    expect(isOnboardingImportLeaseRenewalRun('lease_renewal', {}, 'lease_document')).toBe(
      true,
    )
  })

  it('does not match real cron lease renewals', () => {
    expect(
      isOnboardingImportLeaseRenewalRun('lease_renewal', {
        cron_source: 'check-lease-renewals',
        lease_end_date: '2026-10-01',
      }, 'user'),
    ).toBe(false)
  })

  it('does not match maintenance import runs', () => {
    expect(
      isOnboardingImportLeaseRenewalRun('maintenance_intake', {
        source: 'onboarding_import',
      }),
    ).toBe(false)
  })
})
