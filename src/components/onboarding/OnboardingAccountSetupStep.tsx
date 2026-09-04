/**
 * Guided onboarding — Account setup step.
 */
import { Link } from 'react-router-dom'
import { checkboxInputClassName } from '@/components/TableCheckbox'
import { PRIVACY_POLICY_PATH } from '@/lib/legal/privacyPolicyContent'
import {
  NOTIFICATION_CHANNEL_OPTIONS,
  NOTIFICATION_PREFERENCE_OPTIONS,
  QUIET_HOURS_TIME_OPTIONS,
  type NotificationChannelId,
  type NotificationPreferenceId,
  type OnboardingApprovalRules,
} from '@/lib/onboardingApprovalRules'
import type { OnboardingAccountSetup } from '@/lib/onboarding'
import {
  OnboardingContinueButton,
  OnboardingStepNav,
} from './OnboardingStepChrome'
import {
  onboardingFieldLabelClass,
  onboardingInputClass,
  onboardingSelectClass,
} from './onboardingFieldStyles'
import {
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
              placeholder="Company name"
              aria-label="Company name"
            />
            <input
              className={onboardingInputClass}
              value={accountSetup.contactName}
              onChange={(e) => updateAccountSetup({ contactName: e.target.value })}
              placeholder="Your name"
              aria-label="Your name"
            />
            <input
              className={onboardingInputClass}
              type="email"
              value={accountSetup.email}
              onChange={(e) => updateAccountSetup({ email: e.target.value })}
              placeholder="Support email"
              aria-label="Support email"
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
                  checked={
                    smsConsentAccepted || Boolean(accountSetup.smsConsentAcceptedAt)
                  }
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
                <h3 className="text-[15px] font-semibold text-[#101828]">Backup contact</h3>
                <span className="text-[12px] font-medium text-[#9ca3af]">Optional</span>
              </div>
              <p className="mb-3 text-[13px] leading-5 text-[#6a7282]">
                Someone we can reach if we can’t get ahold of you for urgent issues.
              </p>
              <div className="grid gap-4 sm:grid-cols-2">
                <input
                  className={onboardingInputClass}
                  value={accountSetup.backupContactName}
                  onChange={(e) => updateAccountSetup({ backupContactName: e.target.value })}
                  placeholder="Backup contact name"
                  aria-label="Backup contact name"
                  autoComplete="off"
                />
                <input
                  className={onboardingInputClass}
                  type="tel"
                  autoComplete="tel"
                  value={accountSetup.backupContactPhone}
                  onChange={(e) => updateAccountSetup({ backupContactPhone: e.target.value })}
                  placeholder="Backup contact number"
                  aria-label="Backup contact number"
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

            <div>
              <h3 className="text-[15px] font-semibold text-[#101828]">Channel preference</h3>
              <p className="mt-1 text-[13px] leading-5 text-[#6a7282]">
                Where should we send those alerts? SMS, email, and the Ulo Activity Feed are available.
              </p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {NOTIFICATION_CHANNEL_OPTIONS.map((option) => {
                  const selected = approvalRules.notificationChannel === option.id
                  return (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() =>
                        updateApprovalRules({
                          notificationChannel: option.id as NotificationChannelId,
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

            <div>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="text-[15px] font-semibold text-[#101828]">Quiet hours</h3>
                  <p className="mt-1 text-[13px] leading-5 text-[#6a7282]">
                    Pause non-emergency alerts overnight. Emergencies still come through.
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={approvalRules.quietHoursEnabled}
                  onClick={() =>
                    updateApprovalRules({
                      quietHoursEnabled: !approvalRules.quietHoursEnabled,
                    })
                  }
                  className={[
                    'relative h-6 w-11 shrink-0 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-[#186179]/30 focus-visible:ring-offset-2',
                    approvalRules.quietHoursEnabled ? 'bg-[#611879]' : 'bg-[#e5e7eb]',
                  ].join(' ')}
                >
                  <span
                    className={[
                      'pointer-events-none absolute top-1 left-1 size-4 rounded-full bg-white shadow-sm transition-transform',
                      approvalRules.quietHoursEnabled ? 'translate-x-5' : 'translate-x-0',
                    ].join(' ')}
                  />
                </button>
              </div>
              {approvalRules.quietHoursEnabled ? (
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <label className="block">
                    <span className={onboardingFieldLabelClass}>From</span>
                    <div className="relative">
                      <select
                        className={onboardingSelectClass}
                        value={approvalRules.quietHoursStart}
                        onChange={(e) =>
                          updateApprovalRules({ quietHoursStart: e.target.value })
                        }
                        aria-label="Quiet hours start"
                      >
                        {QUIET_HOURS_TIME_OPTIONS.map((time) => (
                          <option key={time} value={time}>
                            {time}
                          </option>
                        ))}
                      </select>
                      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[#6a7282]">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="size-4" aria-hidden>
                          <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </span>
                    </div>
                  </label>
                  <label className="block">
                    <span className={onboardingFieldLabelClass}>To</span>
                    <div className="relative">
                      <select
                        className={onboardingSelectClass}
                        value={approvalRules.quietHoursEnd}
                        onChange={(e) => updateApprovalRules({ quietHoursEnd: e.target.value })}
                        aria-label="Quiet hours end"
                      >
                        {QUIET_HOURS_TIME_OPTIONS.map((time) => (
                          <option key={time} value={time}>
                            {time}
                          </option>
                        ))}
                      </select>
                      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[#6a7282]">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="size-4" aria-hidden>
                          <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </span>
                    </div>
                  </label>
                  <p className="text-[12px] leading-4 text-[#6a7282] sm:col-span-2">
                    Example: no alerts 10:00 PM–7:00 AM except emergencies.
                  </p>
                </div>
              ) : null}
            </div>
          </div>

          <OnboardingStepNav
            showBack={showBackButton}
            onBack={onBack}
            saving={saving}
          >
            <OnboardingContinueButton
              disabled={saving || !smsConsentAccepted}
              onClick={handleContinue}
            >
              {editContinueLabel ?? 'Continue'}
            </OnboardingContinueButton>
          </OnboardingStepNav>
        </section>

  )
}
