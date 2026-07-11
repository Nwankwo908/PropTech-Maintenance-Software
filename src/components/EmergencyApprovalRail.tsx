import { useEffect, useId } from 'react'
import {
  ADMIN_RIGHT_RAIL_OVERLAY_HOST,
  ADMIN_RIGHT_RAIL_SCRIM,
  adminRightRailPanelClass,
} from '@/lib/adminRightRail'
import {
  formatEmergencyCurrency,
  type EmergencyApprovalReview,
} from '@/lib/emergencyApprovalReview'

function CloseIcon() {
  return (
    <svg className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
    </svg>
  )
}

function DropletIcon() {
  return (
    <svg className="size-5 shrink-0 text-[#fb2c36]" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 2.5c-3.2 4.6-6 8.1-6 11.5a6 6 0 1 0 12 0c0-3.4-2.8-6.9-6-11.5z" />
    </svg>
  )
}

function ClockIcon() {
  return (
    <svg className="size-4 shrink-0 text-[#fb2c36]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function DeclineCircleIcon() {
  return (
    <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path d="M9 9l6 6M15 9l-6 6" strokeLinecap="round" />
    </svg>
  )
}

function ApproveCircleIcon() {
  return (
    <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path d="M8 12l2.5 2.5L16 9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

type EmergencyApprovalRailProps = {
  open: boolean
  review: EmergencyApprovalReview | null
  onClose: () => void
  onApprove: (ticketId: string) => void
  onDecline: (ticketId: string) => void
  saving?: boolean
}

/** Emergency vendor quote approval rail (Figma property detail — Review). */
export function EmergencyApprovalRail({
  open,
  review,
  onClose,
  onApprove,
  onDecline,
  saving = false,
}: EmergencyApprovalRailProps) {
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

  const totalLabel = formatEmergencyCurrency(review.totalAmount)

  return (
    <div className={ADMIN_RIGHT_RAIL_OVERLAY_HOST}>
      <div role="presentation" className={ADMIN_RIGHT_RAIL_SCRIM} aria-hidden onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={adminRightRailPanelClass(undefined)}
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
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[#ffe2e2] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.06em] text-[#c10007]">
            <span aria-hidden>⚠</span>
            Emergency · Needs approval
          </span>

          <div className="mt-4 flex items-start gap-2">
            <DropletIcon />
            <h2
              id={titleId}
              className="text-[18px] font-semibold leading-7 tracking-[-0.3px] text-[#0a0a0a]"
            >
              {review.title}
            </h2>
          </div>

          <p className="mt-3 text-[13px] leading-5 text-[#6a7282]">{review.summary}</p>

          <div className="mt-5 rounded-[10px] border border-[#fecaca] bg-[#fff5f5] p-4">
            <div className="flex items-center gap-2">
              <ClockIcon />
              <p className="text-[13px] font-semibold text-[#c10007]">Why this is urgent</p>
            </div>
            <ul className="mt-3 list-disc space-y-2 pl-5 text-[13px] leading-5 text-[#364153]">
              {review.urgentReasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          </div>

          <div className="mt-5 rounded-[10px] border border-[#e5e7eb] bg-[#f9fafb] p-4">
            <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#9ca3af]">
              Vendor quote — {review.vendorName}
            </p>
            <ul className="mt-4 space-y-2">
              {review.quoteLines.map((line) => (
                <li
                  key={line.label}
                  className="flex items-start justify-between gap-4 text-[13px] leading-5 text-[#364153]"
                >
                  <span>{line.label}</span>
                  <span className="shrink-0 tabular-nums">{formatEmergencyCurrency(line.amount)}</span>
                </li>
              ))}
            </ul>
            <div className="mt-4 flex items-center justify-between border-t border-[#e5e7eb] pt-3">
              <span className="text-[14px] font-semibold text-[#0a0a0a]">Total</span>
              <span className="text-[14px] font-semibold tabular-nums text-[#0a0a0a]">{totalLabel}</span>
            </div>
            <p className="mt-3 text-[12px] leading-4 text-[#6a7282]">
              Auto-approval cap: {formatEmergencyCurrency(review.autoApprovalCap)}
              {review.vendorRating != null ? ` · Vendor rating ${review.vendorRating.toFixed(1)}` : ''}
              {review.vendorEtaMinutes != null ? ` · On-site ETA ${review.vendorEtaMinutes} min` : ''}
            </p>
          </div>

          <p className="mt-5 text-[13px] leading-5 text-[#6a7282]">{review.footerNote}</p>
        </div>

        <footer className="flex shrink-0 items-center justify-end gap-3 border-t border-[#e5e7eb] px-6 py-4">
          <button
            type="button"
            disabled={saving}
            onClick={() => onDecline(review.ticketId)}
            className="inline-flex items-center gap-2 rounded-full border border-[#e5e7eb] bg-white px-4 py-2 text-[13px] font-medium text-[#0a0a0a] outline-none hover:bg-[#f9fafb] focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-2 disabled:opacity-50"
          >
            <DeclineCircleIcon />
            Decline
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => onApprove(review.ticketId)}
            className="inline-flex items-center gap-2 rounded-full bg-[#fb2c36] px-4 py-2 text-[13px] font-medium text-white outline-none hover:bg-[#e11d48] focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-2 disabled:opacity-50"
          >
            <ApproveCircleIcon />
            {saving ? 'Approving…' : `Approve ${totalLabel}`}
          </button>
        </footer>
      </div>
    </div>
  )
}

export default EmergencyApprovalRail
