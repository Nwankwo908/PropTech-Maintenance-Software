/**
 * Onboarding wizard step order and navigation helpers.
 */
import type { OnboardingSetupPath, OnboardingStep } from './types'

export const GUIDED_ONBOARDING_STEPS: { id: OnboardingStep; label: string }[] = [
  { id: 'entry', label: 'Welcome' },
  { id: 'account_setup', label: 'Account setup' },
  { id: 'property', label: 'Property' },
  { id: 'vendors', label: 'Vendors' },
  { id: 'residents', label: 'Residents' },
  { id: 'approval', label: 'Approval rules' },
  { id: 'payouts', label: 'Payouts' },
  { id: 'review', label: 'Review' },
]

export const FAST_TRACK_ONBOARDING_STEPS: { id: OnboardingStep; label: string }[] = [
  { id: 'entry', label: 'Welcome' },
  { id: 'document_upload', label: 'Upload documents' },
  { id: 'ai_review', label: 'AI review' },
  { id: 'approval', label: 'Approval rules' },
  { id: 'payouts', label: 'Payouts' },
  { id: 'review', label: 'Review' },
]

const GUIDED_STEP_ORDER: OnboardingStep[] = [
  'entry',
  'account_setup',
  'property',
  'vendors',
  'residents',
  'approval',
  'payouts',
  'review',
]

const FAST_TRACK_STEP_ORDER: OnboardingStep[] = [
  'entry',
  'document_upload',
  'ai_review',
  'approval',
  'payouts',
  'review',
]

const ALL_ONBOARDING_STEP_IDS = new Set<OnboardingStep>([
  ...GUIDED_STEP_ORDER,
  ...FAST_TRACK_STEP_ORDER,
])

const LEGACY_STEP_MAP: Record<string, OnboardingStep> = {
  property_setup: 'account_setup',
  document_upload: 'document_upload',
  extraction_review: 'ai_review',
  phone_activation: 'ai_review',
  resident_announcement: 'residents',
  maintenance_rules: 'approval',
  completion: 'review',
}

export function getOnboardingStepsForPath(
  setupPath: OnboardingSetupPath,
): { id: OnboardingStep; label: string }[] {
  return setupPath === 'fast_track' ? FAST_TRACK_ONBOARDING_STEPS : GUIDED_ONBOARDING_STEPS
}

export function getOnboardingStepOrder(setupPath: OnboardingSetupPath = null): OnboardingStep[] {
  return setupPath === 'fast_track' ? FAST_TRACK_STEP_ORDER : GUIDED_STEP_ORDER
}

/** Map legacy fast-track step ids to the current flow. */
export function resolveOnboardingStepForPath(
  step: OnboardingStep,
  setupPath: OnboardingSetupPath,
): OnboardingStep {
  if (setupPath !== 'fast_track') return step
  if (step === 'property') return 'document_upload'
  if (step === 'vendors' || step === 'residents') return 'ai_review'
  return step
}

export function normalizeOnboardingStep(step: unknown): OnboardingStep {
  if (typeof step === 'string' && LEGACY_STEP_MAP[step]) {
    return LEGACY_STEP_MAP[step]
  }
  if (typeof step === 'string' && ALL_ONBOARDING_STEP_IDS.has(step as OnboardingStep)) {
    return step as OnboardingStep
  }
  return 'entry'
}

export function getPreviousOnboardingStep(
  current: OnboardingStep | string,
  setupPath: OnboardingSetupPath = null,
): OnboardingStep | null {
  const step = resolveOnboardingStepForPath(normalizeOnboardingStep(current), setupPath)
  const order = getOnboardingStepOrder(setupPath)
  const idx = order.indexOf(step)
  if (idx <= 0) return null
  return order[idx - 1]!
}

export function getActiveOnboardingStepIndex(
  step: OnboardingStep,
  setupPath: OnboardingSetupPath = null,
): number {
  const resolved = resolveOnboardingStepForPath(normalizeOnboardingStep(step), setupPath)
  return getOnboardingStepOrder(setupPath).indexOf(resolved)
}
