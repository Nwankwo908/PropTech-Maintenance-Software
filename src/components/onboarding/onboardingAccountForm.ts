/**
 * Account setup step save — moved from AdminOnboardingDashboard (behavior unchanged).
 */
import {
  persistLandlordAccountProfile,
  type LandlordOnboardingState,
  type OnboardingAccountSetup,
  type OnboardingStep,
} from '@/lib/onboarding'
import type { OnboardingApprovalRules } from '@/lib/onboardingApprovalRules'

export type SaveOnboardingAccountSetupStepInput = {
  accountSetup: OnboardingAccountSetup
  approvalRules: OnboardingApprovalRules
  smsConsentAccepted: boolean
  landlordId: string
  editingFromReview: boolean
  setSaving: (value: boolean) => void
  setError: (value: string | null) => void
  setSmsConsentAccepted: (value: boolean) => void
  returnToReviewAfterEdit: (patch?: Partial<LandlordOnboardingState>) => Promise<void>
  goTo: (
    nextStep: OnboardingStep,
    patch?: Partial<LandlordOnboardingState>,
  ) => Promise<void>
}

export async function saveOnboardingAccountSetupStep(
  input: SaveOnboardingAccountSetupStepInput,
): Promise<void> {
  const {
    accountSetup: accountSetupInput,
    approvalRules,
    smsConsentAccepted,
    landlordId,
    editingFromReview,
    setSaving,
    setError,
    setSmsConsentAccepted,
    returnToReviewAfterEdit,
    goTo,
  } = input

  if (!accountSetupInput.companyName.trim() || !accountSetupInput.contactName.trim()) {
    setError('Enter your company and contact name.')
    return
  }
  if (!smsConsentAccepted && !accountSetupInput.smsConsentAcceptedAt) {
    setError('Please agree to the SMS terms to continue.')
    return
  }

  const accountSetup: OnboardingAccountSetup = {
    ...accountSetupInput,
    smsConsentAcceptedAt:
      accountSetupInput.smsConsentAcceptedAt ||
      (smsConsentAccepted ? new Date().toISOString() : null),
  }

  setSaving(true)
  setError(null)
  const profile = await persistLandlordAccountProfile(landlordId, accountSetup)
  if (!profile.ok) {
    setSaving(false)
    setError(profile.error ?? 'Could not save account details.')
    return
  }
  if (accountSetup.smsConsentAcceptedAt) {
    setSmsConsentAccepted(true)
  }

  if (editingFromReview) {
    await returnToReviewAfterEdit({
      accountSetup,
      approvalRules,
    })
    setSaving(false)
    return
  }
  await goTo('property', {
    accountSetup,
    approvalRules,
  })
  setSaving(false)
}
