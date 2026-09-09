import { describe, expect, it } from 'vitest'
import {
  applyCurrentAutoApprovalDefault,
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

  it('lists missing contact name', () => {
    const state = validOnboardingState({
      accountSetup: {
        companyName: '  ',
        contactName: '',
        email: '',
        phone: '',
        backupContactName: '',
        backupContactPhone: '',
        backupContactEmail: '',
      },
    })
    const check = canCompleteOnboarding(state, [], [], undefined, true)
    expect(check.ok).toBe(false)
    expect(check.missing).not.toContain('Company name')
    expect(check.missing).toContain('Contact name')
  })

  it('allows completion without a company name', () => {
    const base = validOnboardingState()
    const check = canCompleteOnboarding(
      validOnboardingState({
        accountSetup: {
          ...base.accountSetup,
          companyName: '',
        },
      }),
      [],
      [],
      undefined,
      true,
    )
    expect(check.ok).toBe(true)
    expect(check.missing).toEqual([])
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
    ).toContain('Automatic Approval Limit')
  })
})

describe('applyCurrentAutoApprovalDefault', () => {
  it('replaces the legacy $250 default with $100', () => {
    expect(applyCurrentAutoApprovalDefault(250)).toBe(100)
    expect(applyCurrentAutoApprovalDefault(100)).toBe(100)
    expect(applyCurrentAutoApprovalDefault(500)).toBe(500)
  })
})
