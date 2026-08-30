import { useCallback, useEffect, useState } from 'react'
import {
  createLandlordConnectAccountSession,
  fetchLandlordStripeConnectStatus,
  primaryPayoutMethodLabel,
  refreshLandlordConnectStatus,
  type LandlordStripeConnectStatus,
  type LandlordStripePayoutMethod,
} from '@/api/landlordStripeConnect'
import { StripeConnectEmbeddedOnboarding } from '@/components/StripeConnectEmbeddedOnboarding'
import { getErrorMessage } from '@/lib/errorMessage'
import {
  onboardingBtnGhostClass,
  onboardingBtnPrimaryClass,
  onboardingBtnSecondaryClass,
  onboardingNestedCardClass,
  onboardingSurfaceSectionClass,
} from './onboardingFieldStyles'

const btnPrimary =
  'sa-press inline-flex w-full cursor-pointer items-center justify-center rounded-[10px] bg-[#186179] px-4 py-3 text-[15px] font-semibold text-white transition-colors hover:bg-[#145066] disabled:cursor-not-allowed disabled:opacity-50'

const btnSecondary = onboardingBtnSecondaryClass

const btnContinue = onboardingBtnPrimaryClass

const btnGhost = onboardingBtnGhostClass

function PayoutAccordionChevron({ expanded }: { expanded: boolean }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden
      className={`size-5 shrink-0 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
    >
      <path
        d="M5 7.5 10 12.5 15 7.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export type OnboardingPayoutsStepProps = {
  landlordId: string
  saving: boolean
  showBack: boolean
  onBack: () => void
  onContinue: () => void
  onSkip: () => void
  onReadyChange?: (ready: boolean) => void
  onStatusChange?: (status: LandlordStripeConnectStatus | null) => void
}

function PayoutMethodsList({ methods }: { methods: LandlordStripePayoutMethod[] }) {
  if (methods.length === 0) return null
  return (
    <ul className="mt-3 space-y-2">
      {methods.map((method, index) => (
        <li
          key={method.id}
          className={onboardingNestedCardClass}
          style={{ ['--onb-stagger' as string]: index }}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[13px] font-semibold text-[#101828]">{method.label}</p>
              <p className="mt-0.5 text-[12px] text-[#6a7282]">
                {method.kind === 'bank_account' ? 'Bank account' : 'Debit card'}
                {method.currency ? ` · ${method.currency}` : ''}
              </p>
            </div>
            {method.defaultForCurrency ? (
              <span className="shrink-0 rounded-md bg-[#ecfdf3] px-2 py-0.5 text-[11px] font-semibold text-[#15803d]">
                Default
              </span>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  )
}

export function OnboardingPayoutsStep({
  landlordId,
  saving,
  showBack,
  onBack,
  onContinue,
  onSkip,
  onReadyChange,
  onStatusChange,
}: OnboardingPayoutsStepProps) {
  const [status, setStatus] = useState<LandlordStripeConnectStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showConnectOnboarding, setShowConnectOnboarding] = useState(false)

  function applyStatus(next: LandlordStripeConnectStatus) {
    setStatus(next)
    onReadyChange?.(next.ready)
    onStatusChange?.(next)
  }

  useEffect(() => {
    let active = true
    const connectParam = new URLSearchParams(window.location.search).get('connect')
    const returning = connectParam === 'return' || connectParam === 'refresh'

    const boot = async () => {
      setLoading(true)
      setError(null)
      try {
        const next = returning
          ? await refreshLandlordConnectStatus(landlordId)
          : await fetchLandlordStripeConnectStatus(landlordId)
        if (!active) return
        applyStatus(next)
        if (returning) {
          const url = new URL(window.location.href)
          url.searchParams.delete('connect')
          window.history.replaceState({}, '', url.toString())
        }
      } catch (err) {
        if (!active) return
        setError(getErrorMessage(err, 'Could not load payout status.'))
        setStatus(null)
        onReadyChange?.(false)
        onStatusChange?.(null)
      } finally {
        if (active) setLoading(false)
      }
    }

    void boot()
    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- boot once per landlord
  }, [landlordId])

  const fetchLandlordConnectClientSecret = useCallback(async () => {
    const result = await createLandlordConnectAccountSession(landlordId)
    return result.clientSecret
  }, [landlordId])

  function togglePayoutAccordion() {
    setError(null)
    setShowConnectOnboarding((open) => !open)
  }

  async function handleConnectExit() {
    setBusy(true)
    setError(null)
    try {
      const next = await refreshLandlordConnectStatus(landlordId)
      applyStatus(next)
      if (next.ready) setShowConnectOnboarding(false)
    } catch (err) {
      setError(getErrorMessage(err, 'Could not refresh payout status.'))
    } finally {
      setBusy(false)
    }
  }

  async function handleRefresh() {
    setBusy(true)
    setError(null)
    try {
      const next = await refreshLandlordConnectStatus(landlordId)
      applyStatus(next)
    } catch (err) {
      setError(getErrorMessage(err, 'Could not refresh payout status.'))
    } finally {
      setBusy(false)
    }
  }

  const ready = status?.ready === true
  const started = Boolean(status?.accountId)
  const methods = status?.payoutMethods ?? []
  const primaryLabel = primaryPayoutMethodLabel(status)

  return (
    <section className={`${onboardingSurfaceSectionClass} mx-auto w-full max-w-[560px]`}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-[22px] font-semibold tracking-[-0.3px] text-[#111827]">
            Set up rent payouts
          </h2>
          <p className="mt-2 text-[14px] leading-6 text-[#6b7280]">
            Connect a bank account so rent payments from tenants go to you. This takes a few minutes
            with Stripe. You can skip for now and add it later from your setup review.
          </p>
        </div>
        {!ready && !loading ? (
          <button
            type="button"
            disabled={saving || busy}
            onClick={onSkip}
            className={`${btnGhost} shrink-0`}
          >
            Skip for now
          </button>
        ) : null}
      </div>

      <div className="onb-form-card sa-surface mt-6 rounded-2xl border border-[#e5e7eb] bg-[#f9fafb] p-5">
        {loading ? (
          <div className="flex flex-col items-center gap-3 py-4">
            <div className="onb-setup-spinner" role="status" aria-label="Loading payout status" />
            <p className="onb-setup-copy text-[14px] text-[#6a7282]">Checking payout status…</p>
          </div>
        ) : ready ? (
          <>
            <p className="text-[14px] font-semibold text-[#15803d]">Payout account connected</p>
            <p className="mt-1 text-[13px] leading-5 text-[#6a7282]">
              Confirm this is the account where you want rent deposited.
            </p>
            {methods.length > 0 ? (
              <PayoutMethodsList methods={methods} />
            ) : (
              <p className="mt-3 rounded-[10px] border border-dashed border-[#d1d5db] bg-white px-3 py-2.5 text-[13px] text-[#6a7282]">
                Connected, but Stripe hasn&apos;t returned bank or card details yet. Refresh status
                or update payout setup if you need to confirm the last four digits.
              </p>
            )}
            <div className="mt-4 flex flex-col gap-2 sm:flex-row">
              <button
                type="button"
                disabled={busy || saving}
                onClick={() => void handleRefresh()}
                className={`${btnSecondary} w-full sm:flex-1`}
              >
                Refresh details
              </button>
              <button
                type="button"
                disabled={busy || saving}
                aria-expanded={showConnectOnboarding}
                onClick={togglePayoutAccordion}
                className={`${btnSecondary} w-full sm:flex-1`}
              >
                Update payout method
              </button>
            </div>
            {showConnectOnboarding ? (
              <div className="mt-4 overflow-hidden rounded-[10px] border border-[#e5e7eb] bg-white p-4">
                <StripeConnectEmbeddedOnboarding
                  fetchClientSecret={fetchLandlordConnectClientSecret}
                  onExit={() => void handleConnectExit()}
                />
                <button
                  type="button"
                  disabled={busy || saving}
                  onClick={() => setShowConnectOnboarding(false)}
                  className="sa-link mt-3 w-full text-center text-[13px] font-medium text-[#186179] hover:underline disabled:opacity-50"
                >
                  Close payout setup
                </button>
              </div>
            ) : null}
            {primaryLabel ? (
              <p className="mt-3 text-[12px] leading-5 text-[#6b7280]">
                Only the last four digits are shown so you can verify the right account without
                exposing full banking details.
              </p>
            ) : null}
          </>
        ) : (
          <>
            <p className="text-[14px] font-semibold text-[#0a0a0a]">
              {started ? 'Finish payout setup' : 'Bank account for rent'}
            </p>
            <p className="mt-1 text-[13px] leading-5 text-[#6a7282]">
              {started
                ? 'Stripe still needs a few details before rent can be deposited. After you finish, you’ll see the last four digits here to confirm.'
                : 'Verify your business and add the account where you want rent deposited. We’ll show a masked summary afterward so you can confirm it’s correct.'}
            </p>
            {methods.length > 0 ? <PayoutMethodsList methods={methods} /> : null}
            <div className="mt-4 overflow-hidden rounded-[10px] border border-[#d1d5dc]">
              <button
                type="button"
                disabled={busy || saving}
                aria-expanded={showConnectOnboarding}
                onClick={togglePayoutAccordion}
                className={`${btnPrimary} flex items-center justify-between gap-3 rounded-none`}
              >
                <span>{started ? 'Continue payout setup' : 'Set up payouts'}</span>
                <PayoutAccordionChevron expanded={showConnectOnboarding} />
              </button>
              {showConnectOnboarding ? (
                <div className="border-t border-[#d1d5dc] bg-white p-4">
                  <p className="text-[13px] leading-5 text-[#6a7282]">
                    Set up payouts so rent can be deposited to your account. Takes a few minutes —
                    you stay on this page.
                  </p>
                  <StripeConnectEmbeddedOnboarding
                    fetchClientSecret={fetchLandlordConnectClientSecret}
                    onExit={() => void handleConnectExit()}
                  />
                </div>
              ) : null}
            </div>
            {started && !showConnectOnboarding ? (
              <button
                type="button"
                disabled={busy || saving}
                onClick={() => void handleRefresh()}
                className="sa-link mt-3 w-full text-center text-[13px] font-medium text-[#186179] hover:underline disabled:opacity-50"
              >
                Refresh payout status
              </button>
            ) : null}
          </>
        )}
      </div>

      {error ? (
        <p className="sa-enter mt-3 text-[13px] leading-5 text-[#b91c1c]">{error}</p>
      ) : null}

      <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
        {showBack ? (
          <button
            type="button"
            disabled={saving || busy}
            onClick={onBack}
            className={btnSecondary}
          >
            Back
          </button>
        ) : (
          <span />
        )}
        <button
          type="button"
          disabled={saving || busy || loading || !ready}
          onClick={onContinue}
          className={btnContinue}
        >
          Continue to review
        </button>
      </div>
      {!ready && !loading ? (
        <p className="mt-3 text-center text-[12px] text-[#6b7280]">
          Set up payouts now, or choose Skip for now to continue without a connected account.
        </p>
      ) : null}
    </section>
  )
}
