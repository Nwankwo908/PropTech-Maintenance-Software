import { useEffect, useId, useState } from 'react'
import {
  postGenerateLateRentInsights,
  resolveGenerateLateRentInsightsUrl,
} from '@/api/generateLateRentInsights'
import {
  ADMIN_RIGHT_RAIL_OVERLAY_HOST,
  ADMIN_RIGHT_RAIL_SCRIM,
  adminRightRailPanelClass,
  type AdminRightRailStackedPosition,
} from '@/lib/adminRightRail'
import {
  LATE_RENT_ACCOUNT_ACTION_LABELS,
  applyLateRentInsightTexts,
  type LateRentAccountAction,
  type LateRentAccountReview,
  type LateRentInsightCard,
} from '@/lib/lateRentAccountReview'

function CloseIcon() {
  return (
    <svg className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
    </svg>
  )
}

function ChatIcon() {
  return (
    <svg className="size-4 shrink-0 text-[#9ca3af]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden>
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function ClockIcon() {
  return (
    <svg className="size-4 shrink-0 text-[#9ca3af]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function SparkleIcon() {
  return (
    <svg className="size-3.5 text-[#9ca3af]" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 2l1.2 4.2L17.5 8 13.2 9.2 12 13.5 10.8 9.2 6.5 8l4.3-1.8L12 2z" />
    </svg>
  )
}

function StatBox({
  label,
  value,
  valueClassName,
}: {
  label: string
  value: string
  valueClassName?: string
}) {
  return (
    <div className="rounded-[10px] border border-[#e5e7eb] bg-[#fafafa] px-3 py-3">
      <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#9ca3af]">{label}</p>
      <p className={`mt-1 text-[22px] font-bold leading-none tabular-nums text-[#0a0a0a] ${valueClassName ?? ''}`}>
        {value}
      </p>
    </div>
  )
}

type LateRentAccountReviewRailProps = {
  open: boolean
  review: LateRentAccountReview | null
  onClose: () => void
  onAction?: (action: LateRentAccountAction, review: LateRentAccountReview) => void
  saving?: boolean
  /** Render panel only (parent owns overlay) for side-by-side stacking. */
  panelOnly?: boolean
  stackedPosition?: AdminRightRailStackedPosition
}

/** Overdue rent collection review — overview right rail (Late Rent Review workflow). */
export function LateRentAccountReviewRail({
  open,
  review,
  onClose,
  onAction,
  saving = false,
  panelOnly = false,
  stackedPosition,
}: LateRentAccountReviewRailProps) {
  const titleId = useId()
  const [insights, setInsights] = useState<LateRentInsightCard[] | null>(null)
  const [insightsLoading, setInsightsLoading] = useState(false)
  const [insightsMode, setInsightsMode] = useState<'openai' | 'fallback' | null>(null)
  const [insightsError, setInsightsError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || panelOnly) return
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape' && !saving) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose, saving, panelOnly])

  useEffect(() => {
    if (!open || !review) {
      setInsights(null)
      setInsightsMode(null)
      setInsightsError(null)
      setInsightsLoading(false)
      return
    }

    let cancelled = false
    const runId = review.workflowRunId
    const fallback = review.insights

    setInsights(null)
    setInsightsMode(null)
    setInsightsError(null)
    setInsightsLoading(true)

    void (async () => {
      const url = resolveGenerateLateRentInsightsUrl()
      const secret = import.meta.env.VITE_ADMIN_REASSIGN_SECRET?.trim()
      if (!url || !secret) {
        if (!cancelled) {
          setInsights(fallback)
          setInsightsMode('fallback')
          setInsightsError('AI insights are not configured — showing local summary.')
          setInsightsLoading(false)
        }
        return
      }

      try {
        const result = await postGenerateLateRentInsights({
          url,
          secret,
          account: review.insightsAccount,
        })
        if (cancelled || runId !== review.workflowRunId) return
        const next = applyLateRentInsightTexts(review, result.insights).insights
        setInsights(next)
        setInsightsMode(result.mode)
        setInsightsError(
          result.mode === 'fallback'
            ? 'AI unavailable — showing local summary.'
            : null,
        )
      } catch (err) {
        if (cancelled) return
        setInsights(fallback)
        setInsightsMode('fallback')
        setInsightsError(
          err instanceof Error ? err.message : 'Could not generate AI insights.',
        )
      } finally {
        if (!cancelled) setInsightsLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [open, review])

  if (!open || !review) return null

  const displayInsights = insights ?? review.insights
  const subtitle =
    insightsLoading
      ? 'Generating AI summary…'
      : insightsMode === 'openai'
        ? 'AI-generated summary of this account'
        : 'Account summary'

  const panel = (
      <div
        role="dialog"
        aria-modal={panelOnly ? undefined : true}
        aria-labelledby={titleId}
        className={adminRightRailPanelClass(stackedPosition, 'max-w-[min(100vw,560px)]')}
      >
        <div className="shrink-0 border-b border-[#e5e7eb] px-6 pb-4 pt-6">
          <div className="flex items-start justify-between gap-3 pr-8">
            <div className="min-w-0">
              <h2
                id={titleId}
                className="text-[20px] font-semibold leading-7 tracking-[-0.3px] text-[#0a0a0a]"
              >
                Review Late Rent Account
              </h2>
              <p className="mt-1 text-[13px] leading-5 text-[#6a7282]">
                Review overdue rent details, payment history, and resident information before taking action.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              aria-label="Close"
              className="absolute right-4 top-4 rounded-lg p-1 text-[#9ca3af] outline-none hover:bg-black/5 hover:text-[#364153] focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-2 disabled:opacity-50"
            >
              <CloseIcon />
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 pb-6 pt-5">
          <div className="grid grid-cols-3 gap-2">
            <StatBox label="Balance Due" value={review.balanceDueLabel} valueClassName="text-[#fb2c36]" />
            <StatBox label="Days Overdue" value={review.daysOverdueLabel} />
            <StatBox label="Monthly Rent" value={review.monthlyRentLabel} />
          </div>

          <div className="relative mt-4 rounded-[12px] border border-[#e5e7eb] bg-white p-4">
            <div className="absolute right-4 top-4 flex flex-wrap items-center justify-end gap-1.5">
              <span className="inline-flex rounded-[6px] bg-[#f3f4f6] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-[#364153]">
                {review.leaseStatusLabel}
              </span>
              <span
                className={`inline-flex rounded-[6px] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] ${review.riskClassName}`}
              >
                {review.riskLabel}
              </span>
            </div>

            <div className="flex items-start gap-3 pr-28">
              <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-[#101828] text-[13px] font-semibold text-white">
                {review.residentInitials}
              </span>
              <div className="min-w-0">
                <p className="text-[16px] font-semibold leading-6 text-[#0a0a0a]">
                  {review.residentShortName}
                </p>
                <p className="mt-2 text-[13px] leading-5 text-[#6a7282]">{review.locationLabel}</p>
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] leading-4 text-[#6a7282]">
                  <p className="flex items-center gap-1.5">
                    <ChatIcon />
                    {review.communicationPrefLabel}
                  </p>
                  {review.nextReminderLabel ? (
                    <p className="flex items-center gap-1.5">
                      <ClockIcon />
                      {review.nextReminderLabel}
                    </p>
                  ) : null}
                </div>
              </div>
            </div>
          </div>

          <div className="mt-5 rounded-[12px] border border-[#e5e7eb] bg-white p-4">
            <div>
              <p className="text-[15px] font-semibold leading-6 text-[#0a0a0a]">Ulo insights</p>
              <p className="text-[12px] leading-4 text-[#6a7282]">{subtitle}</p>
              {insightsError ? (
                <p className="mt-1 text-[11px] leading-4 text-[#9ca3af]">{insightsError}</p>
              ) : null}
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {displayInsights.map((insight) => (
                <div
                  key={insight.tag}
                  className={[
                    'relative rounded-[10px] border border-[#e5e7eb] bg-white p-3.5',
                    insightsLoading ? 'animate-pulse' : '',
                  ].join(' ')}
                >
                  <span className="absolute right-3 top-3">
                    <SparkleIcon />
                  </span>
                  <span
                    className={`inline-flex rounded-[6px] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] ${insight.tagClassName}`}
                  >
                    {insight.tag}
                  </span>
                  <p className="mt-3 pr-6 text-[13px] leading-5 text-[#364153]">
                    {insightsLoading ? 'Writing insight…' : insight.text}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>

        <footer className="flex shrink-0 flex-col gap-2 border-t border-[#e5e7eb] px-6 py-4">
          {(
            [
              'offer_payment_plan',
              'waive_late_fee',
              'mark_payment_received',
            ] as LateRentAccountAction[]
          ).map((action) => {
            const paymentPlanSent =
              action === 'offer_payment_plan' && review.paymentPlanSmsSent
            const lateFeeWaived =
              action === 'waive_late_fee' && review.lateFeeWaiverSmsSent
            const actionDone = paymentPlanSent || lateFeeWaived
            return (
              <button
                key={action}
                type="button"
                disabled={saving || !onAction || actionDone}
                onClick={() => onAction?.(action, review)}
                className="w-full cursor-pointer rounded-[10px] border border-[#187960] bg-white px-4 py-2.5 text-[13px] font-medium text-[#364153] outline-none transition-colors duration-150 hover:bg-[#e2f5f1] active:bg-[#d4ede8] focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {saving
                  ? 'Working…'
                  : paymentPlanSent
                    ? 'Payment plan sent'
                    : lateFeeWaived
                      ? 'Late fee waive'
                      : LATE_RENT_ACCOUNT_ACTION_LABELS[action]}
              </button>
            )
          })}
        </footer>
      </div>
  )

  if (panelOnly) return panel

  return (
    <div className={ADMIN_RIGHT_RAIL_OVERLAY_HOST}>
      <div
        role="presentation"
        className={ADMIN_RIGHT_RAIL_SCRIM}
        aria-hidden
        onClick={() => {
          if (!saving) onClose()
        }}
      />
      {panel}
    </div>
  )
}

export default LateRentAccountReviewRail
