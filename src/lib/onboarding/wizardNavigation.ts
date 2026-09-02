/**
 * Onboarding wizard step resolution and state merge helpers.
 */
import {
  normalizeOnboardingStep,
  resolveOnboardingStepForPath,
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
    return input.reviewEditStep
  }
  if (input.onboardingStatus === 'not_started') {
    return 'entry'
  }
  return resolveOnboardingStepForPath(stored, input.setupPath)
}

export function mergeOnboardingStep(
  prev: LandlordOnboardingState,
  nextStep: OnboardingStep,
  patch: Partial<LandlordOnboardingState> = {},
): LandlordOnboardingState {
  return {
    ...prev,
    ...patch,
    currentStep: nextStep,
    onboardingStatus:
      patch.onboardingStatus === 'completed'
        ? 'completed'
        : nextStep === 'entry' && patch.onboardingStatus == null
          ? prev.onboardingStatus
          : patch.onboardingStatus ?? 'in_progress',
  }
}
