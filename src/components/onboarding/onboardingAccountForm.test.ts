import { describe, expect, it } from 'vitest'
import { hasOnboardingSmsConsent } from './onboardingAccountForm'

describe('hasOnboardingSmsConsent', () => {
  it('is true when the checkbox was ticked this session', () => {
    expect(hasOnboardingSmsConsent(true, null)).toBe(true)
  })

  it('is true when consent was already stored (fast-track AI review)', () => {
    expect(hasOnboardingSmsConsent(false, '2026-09-11T12:00:00.000Z')).toBe(true)
  })

  it('is false until the landlord agrees', () => {
    expect(hasOnboardingSmsConsent(false, null)).toBe(false)
    expect(hasOnboardingSmsConsent(false, '')).toBe(false)
  })
})
