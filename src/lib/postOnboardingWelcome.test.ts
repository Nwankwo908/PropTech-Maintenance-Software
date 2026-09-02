import { describe, expect, it, beforeEach } from 'vitest'
import { LIMITED_ALPHA_1_LANDLORD_ID } from '@shared/landlordCapabilities'
import { EMPTY_LANDLORD_ID } from '@/lib/activeLandlord'
import {
  clearLimitedAlphaPostOnboardingWelcomeSeen,
  markLimitedAlphaPostOnboardingWelcomeSeen,
  shouldShowLimitedAlphaPostOnboardingWelcome,
} from './postOnboardingWelcome'

const memory = new Map<string, string>()

const localStorageMock = {
  getItem: (key: string) => memory.get(key) ?? null,
  setItem: (key: string, value: string) => {
    memory.set(key, value)
  },
  removeItem: (key: string) => {
    memory.delete(key)
  },
  clear: () => {
    memory.clear()
  },
}

Object.defineProperty(globalThis, 'window', {
  value: { localStorage: localStorageMock },
  configurable: true,
})

describe('postOnboardingWelcome', () => {
  beforeEach(() => {
    memory.clear()
  })

  it('shows the all-set screen for Limited Alpha 1 after setup until dismissed', () => {
    expect(
      shouldShowLimitedAlphaPostOnboardingWelcome(true, LIMITED_ALPHA_1_LANDLORD_ID),
    ).toBe(true)
    markLimitedAlphaPostOnboardingWelcomeSeen(LIMITED_ALPHA_1_LANDLORD_ID)
    expect(
      shouldShowLimitedAlphaPostOnboardingWelcome(true, LIMITED_ALPHA_1_LANDLORD_ID),
    ).toBe(false)
  })

  it('does not show before setup is complete or for other accounts', () => {
    expect(
      shouldShowLimitedAlphaPostOnboardingWelcome(false, LIMITED_ALPHA_1_LANDLORD_ID),
    ).toBe(false)
    expect(shouldShowLimitedAlphaPostOnboardingWelcome(true, EMPTY_LANDLORD_ID)).toBe(false)
  })

  it('shows again after reset clears the seen flag', () => {
    markLimitedAlphaPostOnboardingWelcomeSeen(LIMITED_ALPHA_1_LANDLORD_ID)
    clearLimitedAlphaPostOnboardingWelcomeSeen(LIMITED_ALPHA_1_LANDLORD_ID)
    expect(
      shouldShowLimitedAlphaPostOnboardingWelcome(true, LIMITED_ALPHA_1_LANDLORD_ID),
    ).toBe(true)
  })
})
