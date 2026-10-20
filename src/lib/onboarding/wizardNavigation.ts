/**
 * Onboarding wizard step resolution and state merge helpers.
 */
import { coalesceOnboardingState } from './draftStorage'
import {
  normalizeOnboardingStep,
  resolveOnboardingStepForPath,
  resolveReviewEditStep,
} from './steps'
import type { LandlordOnboardingState, OnboardingSetupPath, OnboardingStep } from './types'

export const SETUP_COMPLETE_TRANSITION_MS = 5000
/** Brief hold on the setup spinner before Limited Alpha fades into You’re all set. */
export const ALL_SET_REVEAL_MS = 480

export function resolveWizardDisplayStep(input: {
  storedStep: unknown
  setupPath: OnboardingSetupPath
  onboardingStatus: LandlordOnboardingState['onboardingStatus']
  editingFromReview: boolean
  reviewEditStep: OnboardingStep | null
}): OnboardingStep {
  const stored = normalizeOnboardingStep(input.storedStep)
  if (input.editingFromReview && input.reviewEditStep != null) {
    if (stored !== 'review' && stored !== 'entry') {
      return resolveOnboardingStepForPath(stored, input.setupPath)
    }
    return resolveReviewEditStep(input.reviewEditStep, input.setupPath)
  }
  if (input.onboardingStatus === 'not_started') {
    return 'entry'
  }
  return resolveOnboardingStepForPath(stored, input.setupPath)
}

export function mergeOnboardingStep(
  prev: LandlordOnboardingState | null | undefined,
  nextStep: OnboardingStep,
  patch: Partial<LandlordOnboardingState> = {},
): LandlordOnboardingState {
  const base = coalesceOnboardingState(prev)
  return {
    ...base,
    ...patch,
    currentStep: nextStep,
    onboardingStatus:
      patch.onboardingStatus === 'completed'
        ? 'completed'
        : nextStep === 'entry' && patch.onboardingStatus == null
          ? base.onboardingStatus
          : patch.onboardingStatus ?? 'in_progress',
  }
}
