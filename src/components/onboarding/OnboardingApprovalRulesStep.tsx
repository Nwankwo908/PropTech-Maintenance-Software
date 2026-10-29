import { useState, type ReactNode } from 'react'
import {
  EMERGENCY_TYPE_OPTIONS,
  MARKETPLACE_PREFERENCE_OPTIONS,
  NOTIFICATION_CHANNEL_OPTIONS,
  QUIET_HOURS_TIME_OPTIONS,
  normalizeOnboardingApprovalRules,
  validateOnboardingApprovalRules,
  type EmergencyTypeId,
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

const setupGroupClass =
  'rounded-[10px] border border-[#e5e7eb] bg-white p-5 shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)]'

const CHIP_ICON_HEIGHT = 16

const EMERGENCY_CHIP_SHAPES: Record<
  EmergencyTypeId,
  { viewBox: string; width: number; paths: string[]; fillRule?: 'evenodd' }
> = {
  no_heat: {
    viewBox: '22.59 16.25 54.81 67.5',
    width: 12.99,
    fillRule: 'evenodd',
    paths: [
      'm40.801 16.246c8.7109 14.074-18.207 17.43-18.207 42.621 0 12.309 8.8594 22.012 20.812 24.762-2.0117-1.8555-3.2734-4.5742-3.2734-7.6523 0-9.7969 8.7891-17.004 15.301-17.004-5.7109 10.195 4.4727 10.129 4.4727 17.004 0 3.1875-1.3477 5.9336-3.4727 7.7695 11.754-2.6562 19.965-12.902 20.926-24.879 0.48828-6.0703-3.1094-19.602-12.262-24.531 0 5.9844-3.3477 9.1523-6.8945 9.1523 6.1641-10.672-3.625-27.242-17.406-27.242z',
    ],
  },
  no_hot_water: {
    viewBox: '23.62 10.94 52.76 78.12',
    width: 10.8,
    paths: [
      'm48.664 12.25c-7.7031 17.41-24.945 32.719-25.043 49.48-0.10156 17.309 13.832 27.328 26.332 27.328s26.449-9.9961 26.43-27.5c-0.023437-16.34-17.105-31.977-25.086-49.332-0.79297-1.7266-1.8633-1.7148-2.6328 0.023438zm-16.359 46.082c1.5977 7.9688 3.9688 14.328 14.027 20.379 1.5508 0.93359 1.3906 1.8047-0.41406 1.6758-11.809-0.84766-18.262-13.77-14.855-22.23 0.39844-0.98828 1.0312-0.87891 1.2422 0.17578z',
    ],
  },
  flood_active_leak: {
    viewBox: '23.62 10.94 52.76 78.12',
    width: 10.8,
    paths: [
      'm48.664 12.25c-7.7031 17.41-24.945 32.719-25.043 49.48-0.10156 17.309 13.832 27.328 26.332 27.328s26.449-9.9961 26.43-27.5c-0.023437-16.34-17.105-31.977-25.086-49.332-0.79297-1.7266-1.8633-1.7148-2.6328 0.023438zm-16.359 46.082c1.5977 7.9688 3.9688 14.328 14.027 20.379 1.5508 0.93359 1.3906 1.8047-0.41406 1.6758-11.809-0.84766-18.262-13.77-14.855-22.23 0.39844-0.98828 1.0312-0.87891 1.2422 0.17578z',
    ],
  },
  no_power: {
    viewBox: '26.8 10 46.4 80',
    width: 9.28,
    paths: [
      'm39.199 90 34-45.801h-20.098l8.0977-34.199h-0.39844l-34 45.801h20.102l-8.1016 34.199z',
    ],
  },
  security_breach: {
    viewBox: '14.7 2.5 70.9 95',
    width: 11.94,
    paths: [
      'M82,47.4c-2.3-1-4.7-2-7.2-2.8V27.2c0-5.3-1.7-10.1-4.5-14.1l-4.2,1.8c-0.3,0.1-0.5,0.5-0.5,0.8l0.8,6.6c0,0.4-0.3,0.8-0.6,0.9l-5.3,0.6c0.4,1.1,0.6,2.2,0.6,3.4v14.1c-7.4-1.1-14.8-1.1-22.2,0V27.2c0-6.1,5-11.1,11.1-11.1c2.4,0,4.6,0.8,6.4,2.1l3.2-0.9c0.4-0.1,0.6-0.5,0.5-0.9l-1-6.9c0-0.3,0.1-0.6,0.3-0.8l3.5-2.6C59.1,3.9,54.7,2.5,50,2.5c-13.6,0-24.7,11.1-24.7,24.7v17.3c-2.6,0.9-5,1.8-7.2,2.8c-2.1,1-3.4,3-3.4,5.4v38.9c0,3.2,2.6,5.9,5.9,5.9h59.1c3.2,0,5.9-2.6,5.9-5.9V52.7C85.4,50.4,84.1,48.3,82,47.4z M56.6,80.7c0.2,0.6,0,1.2-0.3,1.6c-0.4,0.5-0.9,0.7-1.5,0.7h-9.5c-0.6,0-1.1-0.3-1.5-0.7c-0.4-0.5-0.5-1.1-0.3-1.6l3.1-11.6c-2.5-1.3-4.3-3.9-4.3-6.9c0-4.3,3.5-7.8,7.8-7.8c4.3,0,7.8,3.5,7.8,7.8c0,3-1.8,5.6-4.3,6.9L56.6,80.7z',
    ],
  },
  gas_smell: {
    viewBox: '19.8 2.5 60.4 95',
    width: 10.17,
    paths: [
      'M19.8,33.4v41.3h60.4V33.4H19.8z M50.9,67.5h-1.8c-4.6,0-8.5-3.3-9.2-7.9c-0.3-1.9-0.2-4,0.4-6c0.1-0.2,0.4-0.2,0.5,0c0.3,0.9,1.1,2.5,2.3,3.3c1.1,0.7,1.3,0,0.7-2c-0.5-1.9-1.5-6.2-0.3-9.1c0.1-0.2,0.3-0.2,0.4,0c0.9,1.9,2,3.2,3,4c0,0-0.4-5.8,3.4-9.1c0.2-0.1,0.4,0,0.4,0.2c-0.3,1.7,0.1,3.9,0.8,5.5c1.4,3,1,4.7,1,4.7s2.1-1.7,1.6-5c0-0.2,0.2-0.4,0.4-0.2c1.6,1.6,3.2,4.3,1.8,8.3c-1.2,3.6-0.6,4.4,0.3,3.7c0.7-0.6,1.7-1.7,1.9-3.9c0-0.2,0.3-0.3,0.4-0.1c0.2,0.3,0.3,0.6,0.5,0.9C62.2,60.8,57.4,67.5,50.9,67.5z',
      'M32.2,16.6c-6.7,0-12.1,5.3-12.4,11.9h60.3c-0.3-6.6-5.7-11.9-12.4-11.9h-3V7.4h2.8C68.9,7.4,70,6.3,70,5s-1.1-2.5-2.5-2.5H32.4C31.1,2.5,30,3.6,30,5s1.1,2.5,2.5,2.5h2.8v9.2H32.2z M40.1,7.4h19.8v9.2H52v-2.3h0.8c1.1,0,2-0.9,2-2s-0.9-2-2-2h-5.6c-1.1,0-2,0.9-2,2s0.9,2,2,2H48v2.3h-7.8V7.4z',
      'M19.8,79.6c0.2,5.5,4,10,9.1,11.4v0.9c0,3.1,2.5,5.6,5.6,5.6h30.9c3.1,0,5.6-2.5,5.6-5.6v-0.9c5.1-1.4,8.9-5.9,9.1-11.4H19.8z',
    ],
  },
}

function EmergencyChipIcon({ id }: { id: EmergencyTypeId }) {
  const icon = EMERGENCY_CHIP_SHAPES[id]
  return (
    <svg
      viewBox={icon.viewBox}
      width={icon.width}
      height={CHIP_ICON_HEIGHT}
      fill="currentColor"
      aria-hidden
      className="shrink-0"
    >
      {icon.paths.map((d) => (
        <path key={d} d={d} fillRule={icon.fillRule} />
      ))}
    </svg>
  )
}

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

      <div className="mt-8 space-y-6">
        {leading ? <div className={setupGroupClass}>{leading}</div> : null}

        <div className={`${setupGroupClass} space-y-8`}>
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
                  className="inline-flex items-center gap-1.5 rounded-full border border-[#d1d5db] bg-[#f3f4f6] px-3 py-1 text-[13px] font-medium text-[#6b7280]"
                >
                  <EmergencyChipIcon id={option.id} />
                  {option.label}
                </li>
              ))}
            </ul>
          </div>
        </div>

        {showMarketplacePreference ? (
          <div className={setupGroupClass}>
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

        <div aria-disabled="true" className={`${setupGroupClass} pointer-events-none`}>
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
