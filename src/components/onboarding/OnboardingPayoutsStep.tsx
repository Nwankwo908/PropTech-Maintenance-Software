import { useEffect, useState } from 'react'
import {
  createLandlordConnectAccountLink,
  fetchLandlordStripeConnectStatus,
  primaryPayoutMethodLabel,
  refreshLandlordConnectStatus,
  type LandlordStripeConnectStatus,
  type LandlordStripePayoutMethod,
} from '@/api/landlordStripeConnect'
import { getErrorMessage } from '@/lib/errorMessage'

const btnPrimary =
  'inline-flex w-full cursor-pointer items-center justify-center rounded-[10px] bg-[#186179] px-4 py-3 text-[15px] font-semibold text-white transition-colors hover:bg-[#145066] disabled:cursor-not-allowed disabled:opacity-50'

const btnSecondary =
  'inline-flex cursor-pointer items-center justify-center rounded-[10px] border border-[#e5e7eb] bg-white px-6 py-2.5 text-[14px] font-medium text-[#101828] transition-colors hover:bg-[#f9fafb] disabled:cursor-not-allowed disabled:opacity-50'

const btnContinue =
  'inline-flex cursor-pointer items-center justify-center rounded-[10px] bg-[#187960] px-6 py-2.5 text-[14px] font-semibold text-white transition-colors hover:bg-[#146b52] disabled:cursor-not-allowed disabled:opacity-50'

export type OnboardingPayoutsStepProps = {
  landlordId: string
  saving: boolean
  showBack: boolean
  onBack: () => void
  onContinue: () => void
  onReadyChange?: (ready: boolean) => void
  onStatusChange?: (status: LandlordStripeConnectStatus | null) => void
}

function PayoutMethodsList({ methods }: { methods: LandlordStripePayoutMethod[] }) {
  if (methods.length === 0) return null
  return (
    <ul className="mt-3 space-y-2">
      {methods.map((method) => (
        <li
          key={method.id}
          className="rounded-[10px] border border-[#dbe4ea] bg-white px-3 py-2.5"
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
  onReadyChange,
  onStatusChange,
}: OnboardingPayoutsStepProps) {
  const [status, setStatus] = useState<LandlordStripeConnectStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

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

  async function handleSetUpPayouts() {
    setBusy(true)
    setError(null)
    try {
      const result = await createLandlordConnectAccountLink(landlordId)
      applyStatus(result)
      window.location.assign(result.url)
    } catch (err) {
      setError(getErrorMessage(err, 'Could not open payout setup.'))
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
    <section className="mx-auto w-full max-w-[560px]">
      <h2 className="text-[22px] font-semibold tracking-[-0.3px] text-[#111827]">
        Set up rent payouts
      </h2>
      <p className="mt-2 text-[14px] leading-6 text-[#6b7280]">
        Connect a bank account so rent payments from tenants go to you. This takes a few minutes
        with Stripe and is required before you finish setup.
      </p>

      <div className="mt-6 rounded-2xl border border-[#e5e7eb] bg-[#f9fafb] p-5">
        {loading ? (
          <p className="text-[14px] text-[#6a7282]">Checking payout status…</p>
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
                onClick={() => void handleSetUpPayouts()}
                className={`${btnSecondary} w-full sm:flex-1`}
              >
                Update payout method
              </button>
            </div>
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
            <button
              type="button"
              disabled={busy || saving}
              onClick={() => void handleSetUpPayouts()}
              className={`${btnPrimary} mt-4`}
            >
              {started ? 'Continue payout setup' : 'Set up payouts'}
            </button>
            {started ? (
              <button
                type="button"
                disabled={busy || saving}
                onClick={() => void handleRefresh()}
                className="mt-3 w-full text-center text-[13px] font-medium text-[#186179] hover:underline disabled:opacity-50"
              >
                I finished on Stripe — refresh status
              </button>
            ) : null}
          </>
        )}
      </div>

      {error ? (
        <p className="mt-3 text-[13px] leading-5 text-[#b91c1c]">{error}</p>
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
          Complete payout setup to continue.
        </p>
      ) : null}
    </section>
  )
}
