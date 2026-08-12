import { useMemo, useState } from 'react'
import { checkboxInputClassName } from '@/components/TableCheckbox'
import {
  buildCommunicationStylePreview,
  COMMUNICATION_STYLE_OPTIONS,
  type CommunicationStyle,
} from '@/lib/communicationStyle'
import {
  AFTER_HOURS_RULE_OPTIONS,
  DEFAULT_AUTO_APPROVAL_THRESHOLD,
  EMERGENCY_TYPE_OPTIONS,
  MARKETPLACE_PREFERENCE_OPTIONS,
  NOTIFICATION_CHANNEL_OPTIONS,
  NOTIFICATION_PREFERENCE_OPTIONS,
  QUIET_HOURS_TIME_OPTIONS,
  normalizeOnboardingApprovalRules,
  validateOnboardingApprovalRules,
  type AfterHoursRuleId,
  type EmergencyTypeId,
  type MarketplacePreferenceId,
  type NotificationChannelId,
  type NotificationPreferenceId,
  type OnboardingApprovalRules,
} from '@/lib/onboardingApprovalRules'
import {
  onboardingBtnPrimaryClass,
  onboardingBtnSecondaryClass,
} from './onboardingFieldStyles'

const btnSecondary = onboardingBtnSecondaryClass

const btnContinue = onboardingBtnPrimaryClass

function ChoiceCard({
  selected,
  title,
  description,
  onSelect,
}: {
  selected: boolean
  title: string
  description?: string
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={[
        'sa-press sa-surface w-full rounded-[12px] border px-4 py-3 text-left',
        selected
          ? 'border-[#186179] bg-[#f0f7fa] ring-1 ring-[#186179]/30'
          : 'border-[#e5e7eb] bg-white hover:border-[#cfd4dc] hover:bg-[#f9fafb]',
      ].join(' ')}
    >
      <p className="text-[14px] font-semibold text-[#111827]">{title}</p>
      {description ? (
        <p className="mt-1 text-[13px] leading-5 text-[#6b7280]">{description}</p>
      ) : null}
    </button>
  )
}

export type OnboardingApprovalRulesStepProps = {
  initialRules: OnboardingApprovalRules
  saving: boolean
  showBack: boolean
  /** Fast-track skips account setup, so surface notification prefs here. */
  showNotificationPreferences?: boolean
  continueLabel?: string
  onBack: () => void
  onContinue: (rules: OnboardingApprovalRules) => void
}

export function OnboardingApprovalRulesStep({
  initialRules,
  saving,
  showBack,
  showNotificationPreferences = false,
  continueLabel = 'Continue',
  onBack,
  onContinue,
}: OnboardingApprovalRulesStepProps) {
  const [rules, setRules] = useState<OnboardingApprovalRules>(() =>
    normalizeOnboardingApprovalRules(initialRules),
  )
  const [error, setError] = useState<string | null>(null)
  const [previewTab, setPreviewTab] = useState<'sms' | 'email'>('sms')
  const stylePreview = useMemo(
    () => buildCommunicationStylePreview(rules.communicationStyle),
    [rules.communicationStyle],
  )

  function patch(next: Partial<OnboardingApprovalRules>) {
    setRules((prev) => ({ ...prev, ...next }))
    setError(null)
  }

  function toggleEmergency(id: EmergencyTypeId) {
    setRules((prev) => {
      const has = prev.emergencyTypes.includes(id)
      const emergencyTypes = has
        ? prev.emergencyTypes.filter((item) => item !== id)
        : [...prev.emergencyTypes, id]
      return { ...prev, emergencyTypes }
    })
    setError(null)
  }

  function handleContinue() {
    const normalized = normalizeOnboardingApprovalRules(rules)
    const check = validateOnboardingApprovalRules(normalized)
    if (!check.ok) {
      setError(`Please set: ${check.missing.join(', ')}.`)
      return
    }
    onContinue(normalized)
  }

  const thresholdDisplay =
    Number.isFinite(rules.autoApprovalThreshold) && rules.autoApprovalThreshold >= 0
      ? String(rules.autoApprovalThreshold)
      : String(DEFAULT_AUTO_APPROVAL_THRESHOLD)

  return (
    <section className="sa-surface mx-auto w-full max-w-[640px]">
      <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[#186179]">
        Required · about 2 minutes
      </p>
      <h2 className="mt-2 text-[22px] font-semibold tracking-[-0.3px] text-[#111827]">
        Maintenance approval rules
      </h2>
      <p className="mt-2 text-[14px] leading-6 text-[#6b7280]">
        Tell Ulo when to schedule repairs automatically, what counts as an emergency, and how to
        handle after-hours work. Smart defaults are selected — change anything that doesn’t fit your
        portfolio.
      </p>

      <div className="mt-8 space-y-8">
        <div>
          <h3 className="text-[15px] font-semibold text-[#111827]">Auto-approval threshold</h3>
          <p className="mt-1 text-[13px] leading-5 text-[#6b7280]">
            Repairs under this amount can be scheduled automatically without waiting on you.
          </p>
          <div className="relative mt-3 max-w-[200px]">
            <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[14px] text-[#6a7282]">
              $
            </span>
            <input
              type="number"
              min={0}
              step={50}
              value={thresholdDisplay}
              onChange={(e) => {
                const next = Number(e.target.value)
                patch({
                  autoApprovalThreshold: Number.isFinite(next) ? Math.max(0, Math.round(next)) : 0,
                })
              }}
              className="h-11 w-full rounded-[10px] border border-[#e5e7eb] bg-white pl-7 pr-3 text-[15px] text-[#111827] outline-none focus:border-[#186179] focus:ring-2 focus:ring-[#186179]/20"
            />
          </div>
          <p className="mt-2 text-[12px] text-[#9ca3af]">Suggested default: $250</p>
        </div>

        <div>
          <h3 className="text-[15px] font-semibold text-[#111827]">Emergency definition</h3>
          <p className="mt-1 text-[13px] leading-5 text-[#6b7280]">
            Select which situations Ulo should treat as emergencies.
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {EMERGENCY_TYPE_OPTIONS.map((option) => {
              const checked = rules.emergencyTypes.includes(option.id)
              return (
                <label
                  key={option.id}
                  className={[
                    'flex cursor-pointer items-center gap-3 rounded-[10px] border px-3 py-2.5',
                    checked ? 'border-[#186179]/40 bg-[#f0f7fa]' : 'border-[#e5e7eb] bg-white',
                  ].join(' ')}
                >
                  <input
                    type="checkbox"
                    className={checkboxInputClassName}
                    checked={checked}
                    onChange={() => toggleEmergency(option.id)}
                  />
                  <span className="text-[14px] font-medium text-[#111827]">{option.label}</span>
                </label>
              )
            })}
          </div>
        </div>

        <div>
          <h3 className="text-[15px] font-semibold text-[#111827]">After-hours authorization</h3>
          <p className="mt-1 text-[13px] leading-5 text-[#6b7280]">
            What should happen when a request comes in outside business hours?
          </p>
          <div className="mt-3 space-y-2">
            {AFTER_HOURS_RULE_OPTIONS.map((option) => (
              <ChoiceCard
                key={option.id}
                selected={rules.afterHoursRule === option.id}
                title={option.label}
                description={option.description}
                onSelect={() => patch({ afterHoursRule: option.id as AfterHoursRuleId })}
              />
            ))}
          </div>
        </div>

        <div>
          <h3 className="text-[15px] font-semibold text-[#111827]">Marketplace preference</h3>
          <p className="mt-1 text-[13px] leading-5 text-[#6b7280]">
            Choose who Ulo can assign work to.
          </p>
          <div className="mt-3 space-y-2">
            {MARKETPLACE_PREFERENCE_OPTIONS.map((option) => (
              <ChoiceCard
                key={option.id}
                selected={rules.marketplacePreference === option.id}
                title={option.label}
                description={option.description}
                onSelect={() =>
                  patch({ marketplacePreference: option.id as MarketplacePreferenceId })
                }
              />
            ))}
          </div>
        </div>

        <div>
          <h3 className="text-[15px] font-semibold text-[#111827]">Communication Style</h3>
          <p className="mt-1 text-[13px] leading-5 text-[#6b7280]">
            Choose how Ulo should communicate with residents, vendors, and your property team. This
            affects the tone of automated text messages and emails, but not the meaning or required
            legal language.
          </p>
          <div className="mt-3 space-y-2">
            {COMMUNICATION_STYLE_OPTIONS.map((option) => {
              const selected = rules.communicationStyle === option.id
              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() =>
                    patch({ communicationStyle: option.id as CommunicationStyle })
                  }
                  className={[
                    'sa-press sa-surface w-full rounded-[12px] border px-4 py-3.5 text-left',
                    selected
                      ? 'border-[#186179] bg-[#f0f7fa] ring-1 ring-[#186179]/30'
                      : 'border-[#e5e7eb] bg-white hover:border-[#cfd4dc] hover:bg-[#f9fafb]',
                  ].join(' ')}
                  aria-pressed={selected}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-[14px] font-semibold text-[#111827]">{option.label}</p>
                    {option.recommended ? (
                      <span className="rounded-full bg-[#C4E5C9] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-[#187930]">
                        Recommended
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1 text-[13px] leading-5 text-[#6b7280]">{option.description}</p>
                  <div className="mt-3 space-y-1.5 rounded-[8px] bg-[#f8fafc] px-3 py-2.5">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[#64748b]">
                      SMS example
                    </p>
                    <p className="text-[12px] leading-5 text-[#364153]">{option.smsExample}</p>
                    <p className="pt-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-[#64748b]">
                      Email subject
                    </p>
                    <p className="text-[12px] leading-5 text-[#364153]">
                      {option.emailSubjectExample}
                    </p>
                  </div>
                </button>
              )
            })}
          </div>

          <div className="mt-4 overflow-hidden rounded-[12px] border border-[#e5e7eb] bg-white">
            <div className="flex border-b border-[#e5e7eb]">
              {(
                [
                  { id: 'sms' as const, label: 'SMS Preview' },
                  { id: 'email' as const, label: 'Email Preview' },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setPreviewTab(tab.id)}
                  className={[
                    'sa-press flex-1 px-3 py-2.5 text-[13px] font-semibold',
                    previewTab === tab.id
                      ? 'border-b-2 border-[#186179] text-[#186179]'
                      : 'text-[#6a7282] hover:text-[#101828]',
                  ].join(' ')}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <div className="bg-[#f8fafc] px-4 py-4">
              {previewTab === 'sms' ? (
                <div className="mx-auto max-w-[320px] rounded-[18px] border border-[#e5e7eb] bg-white px-4 py-3 shadow-sm">
                  <p className="text-[11px] font-medium text-[#9ca3af]">Text message</p>
                  <p className="mt-2 whitespace-pre-wrap text-[13px] leading-5 text-[#101828]">
                    {stylePreview.sms}
                  </p>
                </div>
              ) : (
                <div className="rounded-[10px] border border-[#e5e7eb] bg-white px-4 py-3 shadow-sm">
                  <p className="text-[11px] font-medium text-[#9ca3af]">Subject</p>
                  <p className="mt-1 text-[14px] font-semibold text-[#101828]">
                    {stylePreview.emailSubject}
                  </p>
                  <p className="mt-3 text-[11px] font-medium text-[#9ca3af]">Body</p>
                  <p className="mt-1 whitespace-pre-wrap text-[13px] leading-5 text-[#364153]">
                    {stylePreview.emailBody}
                  </p>
                </div>
              )}
            </div>
          </div>
          <p className="mt-2 text-[12px] leading-4 text-[#6a7282]">
            You can change this later in Settings.
          </p>
        </div>

        {showNotificationPreferences ? (
          <>
            <div>
              <h3 className="text-[15px] font-semibold text-[#111827]">Notification preference</h3>
              <p className="mt-1 text-[13px] leading-5 text-[#6b7280]">
                How often should we notify you about maintenance?
              </p>
              <div className="mt-3 grid gap-2 sm:grid-cols-3">
                {NOTIFICATION_PREFERENCE_OPTIONS.map((option) => (
                  <ChoiceCard
                    key={option.id}
                    selected={rules.notificationPreference === option.id}
                    title={option.label}
                    description={option.description}
                    onSelect={() =>
                      patch({ notificationPreference: option.id as NotificationPreferenceId })
                    }
                  />
                ))}
              </div>
            </div>

            <div>
              <h3 className="text-[15px] font-semibold text-[#111827]">Channel preference</h3>
              <p className="mt-1 text-[13px] leading-5 text-[#6b7280]">
                Where should we send those alerts? SMS, email, and the Ulo Activity Feed are available.
              </p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {NOTIFICATION_CHANNEL_OPTIONS.map((option) => (
                  <ChoiceCard
                    key={option.id}
                    selected={rules.notificationChannel === option.id}
                    title={option.label}
                    description={option.description}
                    onSelect={() =>
                      patch({ notificationChannel: option.id as NotificationChannelId })
                    }
                  />
                ))}
              </div>
            </div>

            <div>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="text-[15px] font-semibold text-[#111827]">Quiet hours</h3>
                  <p className="mt-1 text-[13px] leading-5 text-[#6b7280]">
                    Pause non-emergency alerts overnight. Emergencies still come through.
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={rules.quietHoursEnabled}
                  onClick={() => patch({ quietHoursEnabled: !rules.quietHoursEnabled })}
                  className={[
                    'relative h-6 w-11 shrink-0 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-[#186179]/30 focus-visible:ring-offset-2',
                    rules.quietHoursEnabled ? 'bg-[#611879]' : 'bg-[#e5e7eb]',
                  ].join(' ')}
                >
                  <span
                    className={[
                      'pointer-events-none absolute top-1 left-1 size-4 rounded-full bg-white shadow-sm transition-transform',
                      rules.quietHoursEnabled ? 'translate-x-5' : 'translate-x-0',
                    ].join(' ')}
                  />
                </button>
              </div>
              {rules.quietHoursEnabled ? (
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <label className="block">
                    <span className="mb-1 block text-[13px] font-medium text-[#364153]">From</span>
                    <div className="relative">
                      <select
                        className="h-10 w-full cursor-pointer appearance-none rounded-[8px] border border-[#e5e7eb] bg-white py-2 pl-3 pr-10 text-[14px] text-[#101828] outline-none focus:border-[#186179] focus:ring-2 focus:ring-[#186179]/20"
                        value={rules.quietHoursStart}
                        onChange={(e) => patch({ quietHoursStart: e.target.value })}
                        aria-label="Quiet hours start"
                      >
                        {QUIET_HOURS_TIME_OPTIONS.map((time) => (
                          <option key={time} value={time}>
                            {time}
                          </option>
                        ))}
                      </select>
                      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[#6a7282]">
                        <svg
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth={2}
                          className="size-4"
                          aria-hidden
                        >
                          <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </span>
                    </div>
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-[13px] font-medium text-[#364153]">To</span>
                    <div className="relative">
                      <select
                        className="h-10 w-full cursor-pointer appearance-none rounded-[8px] border border-[#e5e7eb] bg-white py-2 pl-3 pr-10 text-[14px] text-[#101828] outline-none focus:border-[#186179] focus:ring-2 focus:ring-[#186179]/20"
                        value={rules.quietHoursEnd}
                        onChange={(e) => patch({ quietHoursEnd: e.target.value })}
                        aria-label="Quiet hours end"
                      >
                        {QUIET_HOURS_TIME_OPTIONS.map((time) => (
                          <option key={time} value={time}>
                            {time}
                          </option>
                        ))}
                      </select>
                      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[#6a7282]">
                        <svg
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth={2}
                          className="size-4"
                          aria-hidden
                        >
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
          </>
        ) : null}
      </div>

      {error ? (
        <p className="mt-6 rounded-[10px] border border-[#fecaca] bg-[#fef2f2] px-4 py-3 text-[13px] text-[#b91c1c]">
          {error}
        </p>
      ) : null}

      <div className="mt-8 flex flex-wrap items-center justify-end gap-3">
        {showBack ? (
          <button type="button" disabled={saving} onClick={onBack} className={btnSecondary}>
            Back
          </button>
        ) : null}
        <button type="button" disabled={saving} onClick={handleContinue} className={btnContinue}>
          {saving ? 'Saving…' : continueLabel}
        </button>
      </div>
    </section>
  )
}

export default OnboardingApprovalRulesStep
