/**
 * Guided onboarding — Account setup step.
 */
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { checkboxInputClassName } from '@/components/TableCheckbox'
import { PRIVACY_POLICY_PATH } from '@/lib/legal/privacyPolicyContent'
import {
  NOTIFICATION_PREFERENCE_OPTIONS,
  type NotificationPreferenceId,
  type OnboardingApprovalRules,
} from '@/lib/onboardingApprovalRules'
import type { OnboardingAccountSetup } from '@/lib/onboarding'
import {
  OnboardingContinueButton,
  OnboardingStepNav,
} from './OnboardingStepChrome'
import { onboardingInputClass } from './onboardingFieldStyles'
import {
  hasOnboardingSmsConsent,
  saveOnboardingAccountSetupStep,
  type SaveOnboardingAccountSetupStepInput,
} from './onboardingAccountForm'

export type OnboardingAccountSetupStepSaveDeps = Omit<
  SaveOnboardingAccountSetupStepInput,
  'accountSetup' | 'approvalRules' | 'smsConsentAccepted' | 'landlordId'
>

export type OnboardingAccountSetupStepProps = {
  accountSetup: OnboardingAccountSetup
  approvalRules: OnboardingApprovalRules
  smsConsentAccepted: boolean
  setSmsConsentAccepted: (value: boolean) => void
  smsConsentCheckboxId: string
  landlordId: string
  updateAccountSetup: (patch: Partial<OnboardingAccountSetup>) => void
  updateApprovalRules: (patch: Partial<OnboardingApprovalRules>) => void
  setError: (value: string | null | ((prev: string | null) => string | null)) => void
  saveDeps: OnboardingAccountSetupStepSaveDeps
  showBackButton: boolean
  saving: boolean
  editContinueLabel?: string
  onBack: () => void
}

export function OnboardingAccountSetupStep({
  accountSetup,
  approvalRules,
  smsConsentAccepted,
  setSmsConsentAccepted,
  smsConsentCheckboxId,
  landlordId,
  updateAccountSetup,
  updateApprovalRules,
  setError,
  saveDeps,
  showBackButton,
  saving,
  editContinueLabel,
  onBack,
}: OnboardingAccountSetupStepProps) {
  // Chrome paints the signed-in Google account into type=email even when React
  // state is empty — unlock on focus so factory-reset Account Setup stays blank.
  const [emailFieldUnlocked, setEmailFieldUnlocked] = useState(false)

  function handleContinue() {
    void saveOnboardingAccountSetupStep({
      accountSetup,
      approvalRules,
      smsConsentAccepted,
      landlordId,
      ...saveDeps,
    })
  }

  return (
        <section className="sa-surface rounded-[10px] border border-[#e5e7eb] bg-white p-6 shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)]">
          <h2 className="text-[18px] font-semibold text-[#101828]">Account setup</h2>
          <p className="mt-1 text-[14px] text-[#6a7282]">
            Tell us about your organization before adding properties and people.
          </p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <input
              className={`${onboardingInputClass} sm:col-span-2`}
              value={accountSetup.companyName}
              onChange={(e) => updateAccountSetup({ companyName: e.target.value })}
              placeholder="Company name (optional)"
              aria-label="Company name (optional)"
              autoComplete="organization"
              name="ulo-onboarding-company"
            />
            <input
              className={onboardingInputClass}
              value={accountSetup.contactName}
              onChange={(e) => updateAccountSetup({ contactName: e.target.value })}
              placeholder="Enter your name"
              aria-label="Enter your name"
              autoComplete="name"
              name="ulo-onboarding-contact-name"
            />
            <input
              className={onboardingInputClass}
              type="email"
              value={accountSetup.email}
              onChange={(e) => updateAccountSetup({ email: e.target.value })}
              onFocus={() => setEmailFieldUnlocked(true)}
              readOnly={!emailFieldUnlocked}
              placeholder="Enter your email"
              aria-label="Email"
              // Block Chrome from painting the signed-in Google login into Support email.
              autoComplete="off"
              name="ulo-onboarding-support-email"
              data-1p-ignore
              data-lpignore="true"
              data-form-type="other"
            />
            <div className="flex flex-col gap-2 sm:col-span-2">
              <input
                className={onboardingInputClass}
                type="tel"
                autoComplete="tel"
                value={accountSetup.phone}
                onChange={(e) => updateAccountSetup({ phone: e.target.value })}
                placeholder="(555) 123-4567"
                aria-label="Phone"
                aria-describedby={`${smsConsentCheckboxId}-disclosure`}
              />
              <p
                id={`${smsConsentCheckboxId}-disclosure`}
                className="text-[12px] leading-[18px] tracking-[-0.01em] text-[#6a7282]"
              >
                By signing up, you agree to receive recurring SMS messages from Ulo related to
                account verification, maintenance requests, vendor coordination, work order
                updates, appointment reminders, and other property management notifications.
                Consent is not a condition of purchase. Reply STOP to opt out. Reply HELP for
                help. Message frequency varies. Message and data rates may apply.                   View our{' '}
                <Link
                  to={PRIVACY_POLICY_PATH}
                  className="font-medium text-[#9E439F] underline underline-offset-2 hover:text-[#7f3680]"
                >
                  Privacy Policy
                </Link>{' '}
                and{' '}
                <Link
                  to="/terms"
                  className="font-medium text-[#9E439F] underline underline-offset-2 hover:text-[#7f3680]"
                >
                  Terms of Service
                </Link>
                .
              </p>
              <label
                htmlFor={smsConsentCheckboxId}
                className="flex cursor-pointer items-start gap-2.5 pt-1"
              >
                <input
                  id={smsConsentCheckboxId}
                  type="checkbox"
                  checked={hasOnboardingSmsConsent(
                    smsConsentAccepted,
                    accountSetup.smsConsentAcceptedAt,
                  )}
                  onChange={(e) => {
                    setSmsConsentAccepted(e.target.checked)
                    if (e.target.checked) {
                      setError((prev) =>
                        prev === 'Please agree to the SMS terms to continue.' ? null : prev,
                      )
                      updateAccountSetup({
                        smsConsentAcceptedAt:
                          accountSetup.smsConsentAcceptedAt || new Date().toISOString(),
                      })
                    } else {
                      updateAccountSetup({ smsConsentAcceptedAt: null })
                    }
                  }}
                  aria-describedby={`${smsConsentCheckboxId}-disclosure`}
                  className={`${checkboxInputClassName} mt-0.5 accent-[#611879]`}
                />
                <span className="text-[12px] leading-[18px] text-[#364153]">
                  I agree to receive SMS messages as described above.
                </span>
              </label>
            </div>

            <div className="sm:col-span-2">
              <div className="mb-3 flex items-baseline justify-between gap-3">
                <h3 className="text-[15px] font-semibold text-[#101828]">Team member</h3>
                <span className="text-[12px] font-medium text-[#9ca3af]">Optional</span>
              </div>
              <p className="mb-3 text-[13px] leading-5 text-[#6a7282]">
                They can sign in to this account and receive the same operational texts you do.
              </p>
              <div className="grid gap-4 sm:grid-cols-2">
                <input
                  className={onboardingInputClass}
                  value={accountSetup.backupContactName}
                  onChange={(e) => updateAccountSetup({ backupContactName: e.target.value })}
                  placeholder="Team member name"
                  aria-label="Team member name"
                  autoComplete="off"
                />
                <input
                  className={onboardingInputClass}
                  type="tel"
                  autoComplete="tel"
                  value={accountSetup.backupContactPhone}
                  onChange={(e) => updateAccountSetup({ backupContactPhone: e.target.value })}
                  placeholder="Team member phone number"
                  aria-label="Team member phone number"
                />
                <input
                  className={`${onboardingInputClass} sm:col-span-2`}
                  type="email"
                  autoComplete="email"
                  value={accountSetup.backupContactEmail}
                  onChange={(e) => updateAccountSetup({ backupContactEmail: e.target.value })}
                  placeholder="Team member email"
                  aria-label="Team member email"
                />
              </div>
            </div>
          </div>

          <div className="mt-8 space-y-6 border-t border-[#e5e7eb] pt-6">
            <div>
              <h3 className="text-[15px] font-semibold text-[#101828]">Notification preference</h3>
              <p className="mt-1 text-[13px] leading-5 text-[#6a7282]">
                How often should we notify you about maintenance?
              </p>
              <div className="mt-3 grid gap-2 sm:grid-cols-3">
                {NOTIFICATION_PREFERENCE_OPTIONS.map((option) => {
                  const selected = approvalRules.notificationPreference === option.id
                  return (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() =>
                        updateApprovalRules({
                          notificationPreference: option.id as NotificationPreferenceId,
                        })
                      }
                      className={[
                        'rounded-[12px] border px-3 py-3 text-left transition-colors',
                        selected
                          ? 'border-[#186179] bg-[#f0f7fa] ring-1 ring-[#186179]/30'
                          : 'border-[#e5e7eb] bg-white hover:border-[#cfd4dc] hover:bg-[#f9fafb]',
                      ].join(' ')}
                      aria-pressed={selected}
                    >
                      <p className="text-[14px] font-semibold text-[#101828]">{option.label}</p>
                      {option.description ? (
                        <p className="mt-1 text-[12px] leading-4 text-[#6a7282]">
                          {option.description}
                        </p>
                      ) : null}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>

          <OnboardingStepNav
            showBack={showBackButton}
            onBack={onBack}
            saving={saving}
          >
            <OnboardingContinueButton
              disabled={
                saving ||
                !hasOnboardingSmsConsent(smsConsentAccepted, accountSetup.smsConsentAcceptedAt)
              }
              onClick={handleContinue}
            >
              {editContinueLabel ?? 'Continue'}
            </OnboardingContinueButton>
          </OnboardingStepNav>
        </section>

  )
}
