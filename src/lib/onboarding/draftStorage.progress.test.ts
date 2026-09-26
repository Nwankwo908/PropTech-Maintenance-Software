import { describe, expect, it } from 'vitest'
import { defaultOnboardingApprovalRules } from '@/lib/onboardingApprovalRules'
import {
  defaultOnboardingState,
  hasOnboardingDraft,
  hasSavedOnboardingUserProgress,
  propertyFormHasUserContent,
} from './draftStorage'

describe('hasSavedOnboardingUserProgress', () => {
  it('is false for a fresh empty wizard', () => {
    const state = defaultOnboardingState('landlord-1')
    state.onboardingStatus = 'in_progress'
    state.currentStep = 'account_setup'
    state.setupPath = 'guided'
    expect(hasOnboardingDraft(state)).toBe(false)
    expect(hasSavedOnboardingUserProgress({ state })).toBe(false)
  })

  it('is true after account fields are entered', () => {
    const state = defaultOnboardingState('landlord-1')
    state.accountSetup.companyName = 'Acme LLC'
    expect(hasSavedOnboardingUserProgress({ state })).toBe(true)
  })

  it('ignores blank starter property rows', () => {
    expect(
      propertyFormHasUserContent({
        name: '',
        address: '',
        city: '',
        state: '',
        zipCode: '',
        unitCount: '',
        propertyManagerName: '',
        propertyManagerPhone: '',
      }),
    ).toBe(false)
    expect(
      hasSavedOnboardingUserProgress({
        state: defaultOnboardingState('landlord-1'),
        propertyForms: [
          {
            name: '',
            address: '',
            city: '',
            state: '',
            zipCode: '',
            unitCount: '',
            propertyManagerName: '',
            propertyManagerPhone: '',
          },
        ],
      }),
    ).toBe(false)
  })

  it('is true when a live property form has content', () => {
    expect(
      hasSavedOnboardingUserProgress({
        state: defaultOnboardingState('landlord-1'),
        propertyForms: [
          {
            name: '14 Maple',
            address: '',
            city: '',
            state: '',
            zipCode: '',
            unitCount: '',
            propertyManagerName: '',
            propertyManagerPhone: '',
          },
        ],
      }),
    ).toBe(true)
  })

  it('is true when approval rules differ from defaults', () => {
    const state = defaultOnboardingState('landlord-1')
    state.approvalRules = {
      ...defaultOnboardingApprovalRules(),
      autoApprovalThreshold: 250,
    }
    expect(hasSavedOnboardingUserProgress({ state })).toBe(true)
  })
})
