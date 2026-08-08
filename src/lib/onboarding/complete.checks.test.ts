import { describe, expect, it } from 'vitest'
import {
  defaultOnboardingApprovalRules,
  validateOnboardingApprovalRules,
} from '@/lib/onboardingApprovalRules'
import { canCompleteOnboarding } from './complete'
import { validOnboardingState } from './testFixtures'

describe('canCompleteOnboarding', () => {
  it('passes when account, portfolio, approval rules, and payouts are ready', () => {
    const check = canCompleteOnboarding(validOnboardingState(), [], [], undefined, true)
    expect(check).toEqual({ ok: true, missing: [] })
  })

  it('lists missing company and contact', () => {
    const state = validOnboardingState({
      accountSetup: {
        companyName: '  ',
        contactName: '',
        email: '',
        phone: '',
        backupContactName: '',
        backupContactPhone: '',
      },
    })
    const check = canCompleteOnboarding(state, [], [], undefined, true)
    expect(check.ok).toBe(false)
    expect(check.missing).toContain('Company name')
    expect(check.missing).toContain('Contact name')
  })

  it('requires at least one property and unit', () => {
    const state = validOnboardingState({ properties: [] })
    const check = canCompleteOnboarding(state, [], [], undefined, true)
    expect(check.missing).toContain('At least one property')
    expect(check.missing).toContain('At least one unit')
  })

  it('restores empty emergency types via normalize so completion still passes', () => {
    const base = validOnboardingState()
    const state = validOnboardingState({
      approvalRules: { ...base.approvalRules, emergencyTypes: [] },
    })
    // canCompleteOnboarding normalizes rules first; empty emergency lists become defaults.
    expect(canCompleteOnboarding(state, [], [], undefined, true).ok).toBe(true)
  })

  it('allows completion when Stripe payouts are not set up yet', () => {
    const check = canCompleteOnboarding(validOnboardingState(), [], [], undefined, false)
    expect(check.ok).toBe(true)
    expect(check.missing).not.toContain('Payout account (Set up payouts)')
  })
})

describe('validateOnboardingApprovalRules', () => {
  it('flags missing emergency types and invalid thresholds before normalize', () => {
    const rules = defaultOnboardingApprovalRules()
    expect(
      validateOnboardingApprovalRules({ ...rules, emergencyTypes: [] }).missing,
    ).toContain('At least one emergency type')
    expect(
      validateOnboardingApprovalRules({ ...rules, autoApprovalThreshold: -1 }).missing,
    ).toContain('Auto-approval threshold')
  })
})
