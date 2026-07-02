import { useEffect, useId, type ReactNode } from 'react'
import type { SlaOverdueActionReview } from '@/lib/slaOverdueActionReview'

function CloseIcon() {
  return (
    <svg className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
    </svg>
  )
}

function WrenchIcon() {
  return (
    <svg className="size-4 shrink-0 text-[#9ca3af]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden>
      <path d="M14.7 6.3a4 4 0 0 0-5.66 5.66l-6.1 6.1a2 2 0 0 0 2.83 2.83l6.1-6.1a4 4 0 0 0 5.66-5.66l-2.12 2.12-3.54-3.54 2.12-2.12z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function AlertIcon() {
  return (
    <svg className="size-4 shrink-0 text-[#fb2c36]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden>
      <path d="M12 9v4M12 17h.01" strokeLinecap="round" />
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" strokeLinecap="round" strokeLinejoin="round" />
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

function ActionCircleIcon() {
  return (
    <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path d="M8 12l2.5 2.5L16 9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function MetaCard({
  label,
  icon,
  value,
  valueClassName,
}: {
  label: string
  icon: ReactNode
  value: string
  valueClassName?: string
}) {
  return (
    <div className="rounded-[10px] border border-[#e5e7eb] bg-[#fafafa] px-4 py-3">
      <div className="flex items-center gap-1.5">
        {icon}
        <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#9ca3af]">{label}</p>
      </div>
      <p className={`mt-1.5 text-[14px] font-semibold leading-5 text-[#0a0a0a] ${valueClassName ?? ''}`}>
        {value}
      </p>
    </div>
  )
}

type SlaOverdueActionRailProps = {
  open: boolean
  review: SlaOverdueActionReview | null
  onClose: () => void
  onTakeAction: (review: SlaOverdueActionReview) => void
  saving?: boolean
  loading?: boolean
}

/** Escalated / SLA-breached maintenance — overview right rail. */
export function SlaOverdueActionRail({
  open,
  review,
  onClose,
  onTakeAction,
  saving = false,
  loading = false,
}: SlaOverdueActionRailProps) {
  const titleId = useId()

  useEffect(() => {
    if (!open) return
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open || !review) return null

  const alertHeadline =
    review.pastSlaLabel ??
    (review.minutesPastSla != null ? `${review.minutesPastSla} minutes past SLA` : 'Escalation requires review')

  const dismissLabel =
    review.takeActionMode === 'reassign' && review.currentVendorName
      ? 'Wait for Current Vendor'
      : 'Close'

  const actionLabel =
    review.takeActionMode === 'assign_vendor'
      ? 'Assign vendor'
      : review.takeActionMode === 'workflows'
        ? 'Open workflows'
        : review.takeActionMode === 'reassign'
          ? 'Approve & Continue'
          : 'Take action'

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div role="presentation" className="absolute inset-0 bg-black/40" aria-hidden onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative flex h-full max-h-dvh w-full max-w-[min(100vw,520px)] flex-col overflow-hidden rounded-l-[12px] border border-[#e5e7eb] bg-white shadow-[0px_8px_24px_rgba(0,0,0,0.12)]"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-4 top-4 z-10 rounded-lg p-1 text-[#9ca3af] outline-none hover:bg-black/5 hover:text-[#364153] focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-2"
        >
          <CloseIcon />
        </button>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 pb-6 pt-6">
          <span className="inline-flex rounded-full bg-[#f3f4f6] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-[#6a7282]">
            {review.badgeLabel}
          </span>

          <h2 id={titleId} className="mt-4 text-[20px] font-semibold leading-7 tracking-[-0.3px] text-[#0a0a0a]">
            {review.headerTitle}
          </h2>
          <p className="mt-1 text-[13px] font-medium leading-5 text-[#6a7282]">{review.locationLabel}</p>

          <div className="mt-5 grid grid-cols-2 gap-3">
            <MetaCard label="Ticket" icon={<WrenchIcon />} value={review.ticketRef} />
            <MetaCard
              label="Urgency"
              icon={<AlertIcon />}
              value={review.urgencyLabel}
              valueClassName={review.urgencyIsCritical ? 'text-[#fb2c36]' : undefined}
            />
            <MetaCard label="Reported" icon={<ClockIcon />} value={review.reportedAtLabel} />
            <MetaCard label="SLA due" icon={<ClockIcon />} value={review.slaDueLabel} />
          </div>

          <div className="mt-4 rounded-[10px] border border-[#fecaca] bg-[#fff5f5] px-4 py-3">
            <p className="text-[14px] font-semibold leading-5 text-[#c10007]">{alertHeadline}</p>
            <p className="mt-1 text-[13px] leading-5 text-[#364153]">{review.issueSummary}</p>
          </div>

          <div className="mt-5">
            <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#9ca3af]">Vendor</p>
            <p className="mt-1 text-[15px] font-semibold leading-6 text-[#0a0a0a]">
              {review.currentVendorName ?? 'Unassigned'}
            </p>
            <p className="text-[13px] leading-5 text-[#6a7282]">{review.currentVendorStatus}</p>
          </div>

          <div className="mt-5">
            <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#9ca3af]">Timeline</p>
            <ul className="mt-3 space-y-3">
              {review.timeline.map((entry) => (
                <li
                  key={`${entry.timeLabel}-${entry.description}`}
                  className="grid grid-cols-[4.5rem_1fr_auto] gap-x-3 gap-y-0.5 text-[13px] leading-5"
                >
                  <span className="tabular-nums text-[#6a7282]">{entry.timeLabel}</span>
                  <span className="text-[#364153]">{entry.description}</span>
                  <span className="text-right text-[#9ca3af]">{entry.actor}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="mt-5 rounded-[10px] bg-[#f3f4f6] px-4 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#9ca3af]">Ulo suggests</p>
            {loading ? (
              <p className="mt-2 text-[13px] leading-5 text-[#6a7282]">Finding roster alternatives…</p>
            ) : (
              <>
                <p className="mt-2 text-[14px] font-semibold leading-5 text-[#0a0a0a]">
                  {review.suggestionLine}
                </p>
                {review.takeActionMode === 'reassign' ? (
                  <p className="mt-1 text-[12px] leading-4 text-[#6a7282]">Opens in /admin/requests</p>
                ) : null}
              </>
            )}
          </div>
        </div>

        <footer className="flex shrink-0 items-center justify-end gap-3 border-t border-[#e5e7eb] px-6 py-4">
          <button
            type="button"
            disabled={saving}
            onClick={onClose}
            className="rounded-[10px] border border-[#e5e7eb] bg-white px-4 py-2 text-[13px] font-medium text-[#364153] outline-none hover:bg-[#f9fafb] focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-2 disabled:opacity-50"
          >
            {dismissLabel}
          </button>
          <button
            type="button"
            disabled={saving || loading}
            onClick={() => onTakeAction(review)}
            className="inline-flex items-center gap-2 rounded-[10px] bg-[#0a0a0a] px-4 py-2 text-[13px] font-medium text-white outline-none hover:bg-[#1f2937] focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-2 disabled:opacity-50"
          >
            <ActionCircleIcon />
            {saving ? 'Working…' : actionLabel}
          </button>
        </footer>
      </div>
    </div>
  )
}

export default SlaOverdueActionRail
