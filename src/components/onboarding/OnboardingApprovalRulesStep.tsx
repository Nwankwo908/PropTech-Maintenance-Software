import { useState } from 'react'
import { checkboxInputClassName } from '@/components/TableCheckbox'
import {
  AFTER_HOURS_RULE_OPTIONS,
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
  OnboardingContinueButton,
  OnboardingStepNav,
} from './OnboardingStepChrome'

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
  /** Fast-track uses default marketplace dispatch rules without asking. */
  showMarketplacePreference?: boolean
  /** When false, the emergency list stays fixed and the change link stays hidden. */
  allowEmergencyCustomization?: boolean
  continueLabel?: string
  onBack: () => void
  onContinue: (rules: OnboardingApprovalRules) => void
}

export function OnboardingApprovalRulesStep({
  initialRules,
  saving,
  showBack,
  showNotificationPreferences = false,
  showMarketplacePreference = true,
  allowEmergencyCustomization = true,
  continueLabel = 'Continue',
  onBack,
  onContinue,
}: OnboardingApprovalRulesStepProps) {
  const [rules, setRules] = useState<OnboardingApprovalRules>(() =>
    normalizeOnboardingApprovalRules(initialRules),
  )
  const [error, setError] = useState<string | null>(null)
  const [editingEmergencies, setEditingEmergencies] = useState(false)

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

  function saveEmergencyPreferences() {
    const normalized = normalizeOnboardingApprovalRules(rules)
    const check = validateOnboardingApprovalRules(normalized)
    if (!check.ok) {
      setError(`Please set: ${check.missing.join(', ')}.`)
      return
    }
    setRules(normalized)
    setError(null)
    setEditingEmergencies(false)
  }

  function handleContinue() {
    const normalized = normalizeOnboardingApprovalRules(rules)
    const check = validateOnboardingApprovalRules(normalized)
    if (!check.ok) {
      setError(`Please set: ${check.missing.join(', ')}.`)
      return
    }
    setError(null)
    onContinue(normalized)
  }

  return (
    <section className="sa-surface mx-auto w-full max-w-[640px]">
      <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[#186179]">
        Required · about 2 minutes
      </p>
      <h2 className="mt-2 text-[22px] font-semibold tracking-[-0.3px] text-[#111827]">
        Maintenance approval rules
      </h2>
      <p className="mt-2 text-[14px] leading-6 text-[#6b7280]">
        Decide when after-hours repairs need your approval. We’ve selected recommended settings
        you can adjust.
      </p>

      <div className="mt-8 space-y-8">
        <div>
          <h3 className="text-[15px] font-semibold text-[#111827]">
            Ulo flags these issues as emergencies
          </h3>
          <p className="mt-1 text-[13px] leading-5 text-[#6b7280]">
            You’ll be alerted right away when a tenant reports one of these issues.
          </p>
          {editingEmergencies ? (
            <div className="mt-3">
              <div className="grid gap-2 sm:grid-cols-2">
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
              <button
                type="button"
                onClick={saveEmergencyPreferences}
                className="mt-3 rounded-[8px] border border-[#186179] px-3 py-1.5 text-[13px] font-medium text-[#186179] hover:bg-[#f0f7fa]"
              >
                Save
              </button>
            </div>
          ) : (
            <>
              <ul className="mt-3 list-disc space-y-1 pl-5 text-[14px] leading-6 text-[#111827]">
                {EMERGENCY_TYPE_OPTIONS.filter((option) =>
                  rules.emergencyTypes.includes(option.id),
                ).map((option) => (
                  <li key={option.id}>{option.label}</li>
                ))}
              </ul>
              {allowEmergencyCustomization ? (
                <button
                  type="button"
                  onClick={() => setEditingEmergencies(true)}
                  className="sa-link mt-3 text-[13px] font-medium text-[#186179] hover:underline"
                >
                  + Change emergency preferences
                </button>
              ) : null}
            </>
          )}
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

        {showMarketplacePreference ? (
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
        ) : null}

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

      <OnboardingStepNav showBack={showBack} onBack={onBack} saving={saving}>
        <OnboardingContinueButton disabled={saving} onClick={handleContinue}>
          {saving ? 'Saving…' : continueLabel}
        </OnboardingContinueButton>
      </OnboardingStepNav>
    </section>
  )
}

export default OnboardingApprovalRulesStep
