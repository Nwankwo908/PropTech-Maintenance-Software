import { useState, type ReactNode } from 'react'
import {
  EMERGENCY_TYPE_OPTIONS,
  MARKETPLACE_PREFERENCE_OPTIONS,
  NOTIFICATION_CHANNEL_OPTIONS,
  QUIET_HOURS_TIME_OPTIONS,
  normalizeOnboardingApprovalRules,
  validateOnboardingApprovalRules,
  type MarketplacePreferenceId,
  type NotificationChannelId,
  type OnboardingApprovalRules,
} from '@/lib/onboardingApprovalRules'
import {
  OnboardingContinueButton,
  OnboardingStepNav,
} from './OnboardingStepChrome'

const COMING_SOON_OPERATION_ALERTS = [
  {
    title: 'Lease renewal alerts',
    description:
      'Notified when a lease is 60 days from expiration so you can act before a unit goes vacant.',
  },
  {
    title: 'Seasonal alerts',
    description:
      'Reminders before each season — winterize pipes, HVAC servicing, gutter cleaning — tied to your property locations.',
  },
  {
    title: 'Asset alerts',
    description:
      'Alerts when a major system (HVAC, water heater, roof) is approaching end of useful life based on age and job history.',
  },
  {
    title: 'Finance / rent alerts',
    description:
      'Notified on missed rent, late payments, and monthly spend summaries across your portfolio.',
  },
] as const

function ComingSoonSwitch() {
  return (
    <span aria-hidden className="relative h-6 w-11 shrink-0 rounded-full bg-[#e5e7eb]">
      <span className="absolute top-1 left-1 size-4 translate-x-5 rounded-full bg-[#f9fafb] shadow-sm" />
    </span>
  )
}

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
  /** Fast-track uses default marketplace dispatch rules without asking. */
  showMarketplacePreference?: boolean
  continueLabel?: string
  /** First block on the page. Used for the vendor roster. */
  leading?: ReactNode
  onBack: () => void
  onContinue: (rules: OnboardingApprovalRules) => void
}

export function OnboardingApprovalRulesStep({
  initialRules,
  saving,
  showBack,
  showMarketplacePreference = true,
  continueLabel = 'Continue',
  leading = null,
  onBack,
  onContinue,
}: OnboardingApprovalRulesStepProps) {
  const [rules, setRules] = useState<OnboardingApprovalRules>(() =>
    normalizeOnboardingApprovalRules(initialRules),
  )
  const [error, setError] = useState<string | null>(null)

  function patch(next: Partial<OnboardingApprovalRules>) {
    setRules((prev) => ({ ...prev, ...next }))
    setError(null)
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
      <h2 className="text-[22px] font-semibold tracking-[-0.3px] text-[#111827]">
        Operations setup
      </h2>
      <p className="mt-2 text-[14px] leading-6 text-[#6b7280]">
        We’ve selected recommended settings you can adjust.
      </p>

      <div className="mt-8 space-y-10">
        {leading}

        <div className="space-y-8">
          <div>
            <h3 className="text-[15px] font-semibold text-[#111827]">Channel preference</h3>
            <p className="mt-1 text-[13px] leading-5 text-[#6b7280]">
              Where should we send those alerts?
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
                        <option key={`end-${time}`} value={time}>
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

          <div>
            <h3 className="text-[15px] font-semibold text-[#111827]">
              Emergencies that always come through
            </h3>
            <p className="mt-1 text-[13px] leading-5 text-[#6b7280]">
              You’ll be alerted right away when a tenant reports one of these issues.
            </p>
            <ul className="mt-3 flex flex-wrap gap-2">
              {EMERGENCY_TYPE_OPTIONS.filter((option) =>
                rules.emergencyTypes.includes(option.id),
              ).map((option) => (
                <li
                  key={option.id}
                  className="rounded-full border border-[#d1d5db] bg-[#f3f4f6] px-3 py-1 text-[13px] font-medium text-[#111827]"
                >
                  {option.label}
                </li>
              ))}
            </ul>
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

        <div aria-disabled="true" className="pointer-events-none">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="text-[15px] font-semibold text-[#9ca3af]">
                Operations alert preferences
              </h3>
              <p className="mt-1 text-[13px] leading-5 text-[#9ca3af]">
                Choose which proactive alerts Ulo sends you. All are on by default — turn off
                anything you don’t need.
              </p>
            </div>
            <span className="rounded-full border border-[#e5e7eb] bg-[#f3f4f6] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-[#6b7280]">
              Coming soon
            </span>
          </div>
          <div className="mt-3 space-y-2">
            {COMING_SOON_OPERATION_ALERTS.map((alert) => (
              <div
                key={alert.title}
                className="flex items-start justify-between gap-3 rounded-[12px] border border-[#e5e7eb] bg-[#f9fafb] px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="text-[14px] font-semibold text-[#9ca3af]">{alert.title}</p>
                  <p className="mt-1 text-[13px] leading-5 text-[#9ca3af]">{alert.description}</p>
                </div>
                <ComingSoonSwitch />
              </div>
            ))}
            <div className="flex items-center justify-between gap-3 rounded-[12px] border border-[#e5e7eb] bg-[#f9fafb] px-4 py-3">
              <div className="flex min-w-0 items-start gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-[8px] border border-[#e5e7eb] bg-[#f3f4f6] text-[#9ca3af]">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="size-4" aria-hidden>
                    <rect x="3" y="6" width="18" height="12" rx="2" />
                    <path d="M3 10h18" />
                  </svg>
                </span>
                <div className="min-w-0">
                  <p className="text-[14px] font-semibold text-[#9ca3af]">Connect a bank or card</p>
                  <p className="mt-1 text-[13px] leading-5 text-[#9ca3af]">
                    Link an account to track maintenance spend and flag late rent automatically.
                  </p>
                </div>
              </div>
              <span className="shrink-0 rounded-full border border-[#e5e7eb] bg-[#f3f4f6] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-[#6b7280]">
                Coming soon
              </span>
            </div>
          </div>
        </div>
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
