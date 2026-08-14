import { describe, expect, it } from 'vitest'
import {
  phoneChanged,
  phoneNewlyAdded,
  shouldOfferRestartTenantOnboarding,
} from '@/api/tenantActivation'

describe('tenant phone change / restart onboarding', () => {
  it('treats formatted US numbers as the same phone', () => {
    expect(phoneChanged('+15551234567', '(555) 123-4567')).toBe(false)
  })

  it('detects a different tenant number', () => {
    expect(phoneChanged('+15551234567', '(555) 999-0000')).toBe(true)
  })

  it('does not treat clearing the phone as a restart offer', () => {
    expect(shouldOfferRestartTenantOnboarding('+15551234567', '')).toBe(false)
    expect(phoneChanged('+15551234567', '')).toBe(false)
  })

  it('offers restart when replacing a number after onboarding', () => {
    expect(shouldOfferRestartTenantOnboarding('+15551234567', '5559990000')).toBe(true)
  })

  it('does not offer restart when adding the first number', () => {
    expect(phoneNewlyAdded(null, '5559990000')).toBe(true)
    expect(shouldOfferRestartTenantOnboarding(null, '5559990000')).toBe(false)
  })
})
