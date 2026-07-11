import { useEffect, useId, type ReactNode } from 'react'
import {
  ADMIN_RIGHT_RAIL_OVERLAY_HOST,
  ADMIN_RIGHT_RAIL_SCRIM,
  adminRightRailPanelClass,
  type AdminRightRailStackedPosition,
} from '@/lib/adminRightRail'
import type {
  LeaseRenewalEscalatedAction,
  LeaseRenewalEscalatedReview,
  LeaseRenewalRecommendAction,
} from '@/lib/leaseRenewalEscalatedReview'

function CloseIcon() {
  return (
    <svg className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
    </svg>
  )
}

function DocumentIcon() {
  return (
    <svg className="size-4 shrink-0 text-[#9ca3af]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function AlertIcon() {
  return (
    <svg className="size-4 shrink-0 text-[#9ca3af]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden>
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

function SparkleIcon() {
  return (
    <svg className="size-4 shrink-0 text-[#9ca3af]" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 2l1.2 4.2L17.5 8 13.2 9.2 12 13.5 10.8 9.2 6.5 8l4.3-1.8L12 2z" />
    </svg>
  )
}

function ArrowUpRightIcon({ className }: { className?: string }) {
  return (
    <svg className={className ?? 'size-4'} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path d="M7 17L17 7M17 7H9M17 7v8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function CheckCircleIcon() {
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
}: {
  label: string
  icon: ReactNode
  value: string
}) {
  return (
    <div className="rounded-[10px] border border-[#e5e7eb] bg-[#fafafa] px-4 py-3">
      <div className="flex items-center gap-1.5">
        {icon}
        <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#9ca3af]">{label}</p>
      </div>
      <p className="mt-1.5 text-[14px] font-semibold leading-5 text-[#0a0a0a]">{value}</p>
    </div>
  )
}

type LeaseRenewalEscalatedRailProps = {
  open: boolean
  review: LeaseRenewalEscalatedReview | null
  onClose: () => void
  onAction?: (action: LeaseRenewalEscalatedAction, review: LeaseRenewalEscalatedReview) => void
  saving?: boolean
  /** Render panel only (parent owns overlay) for side-by-side stacking. */
  panelOnly?: boolean
  stackedPosition?: AdminRightRailStackedPosition
}

/** Escalated lease renewal review — overview right rail. */
export function LeaseRenewalEscalatedRail({
  open,
  review,
  onClose,
  onAction,
  saving = false,
  panelOnly = false,
  stackedPosition,
}: LeaseRenewalEscalatedRailProps) {
  const titleId = useId()

  useEffect(() => {
    if (!open || panelOnly) return
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose, panelOnly])

  if (!open || !review) return null

  const panel = (
    <div
      role="dialog"
      aria-modal={panelOnly ? undefined : true}
      aria-labelledby={titleId}
      className={adminRightRailPanelClass(stackedPosition, 'max-w-[min(100vw,560px)]')}
    >
      <div className="shrink-0 border-b border-[#e5e7eb] px-6 pb-4 pt-6">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-4 top-4 rounded-lg p-1 text-[#9ca3af] outline-none hover:bg-black/5 hover:text-[#364153] focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-2"
        >
          <CloseIcon />
        </button>

        <div className="flex flex-wrap items-center gap-2 pr-8">
          <span className="inline-flex rounded-[6px] bg-[#ffedd5] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-[#c2410c]">
            Escalated workflow
          </span>
          <span className="text-[12px] text-[#9ca3af]">· {review.workflowRef}</span>
        </div>

        <h2
          id={titleId}
          className="mt-3 text-[20px] font-semibold leading-7 tracking-[-0.3px] text-[#0a0a0a]"
        >
          {review.headerTitle}
        </h2>
        <p className="mt-1 text-[13px] font-medium leading-5 text-[#6a7282]">{review.locationLabel}</p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 pb-6 pt-5">
        <div className="grid grid-cols-2 gap-3">
          <MetaCard label="Days until lease ends" icon={<DocumentIcon />} value={review.daysUntilLeaseEndLabel} />
          <MetaCard label="Stage" icon={<AlertIcon />} value={review.stageLabel} />
          <MetaCard label="Escalated" icon={<ClockIcon />} value={review.escalatedAtLabel} />
          <MetaCard label="Outreach attempts" icon={<SparkleIcon />} value={review.outreachAttemptsLabel} />
        </div>

        <div className="mt-6">
          <div className="flex items-center gap-1.5">
            <SparkleIcon />
            <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#9ca3af]">
              Ulo recommends
            </p>
          </div>
          <div className="mt-3 flex flex-col gap-2">
            {review.recommendations.map((item) => (
              <button
                key={item.id}
                type="button"
                disabled={saving || !onAction}
                onClick={() => onAction?.(item.id as LeaseRenewalRecommendAction, review)}
                className={[
                  'flex w-full cursor-pointer items-center justify-between gap-3 rounded-[10px] px-4 py-3 text-left outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
                  item.primary
                    ? 'border border-[#186179] bg-transparent text-[#186179] hover:bg-[#186179]/5 active:bg-[#186179]/10'
                    : 'border border-[#e5e7eb] bg-white text-[#0a0a0a] hover:border-[#101828]/15 hover:bg-[#e2f5f1] active:bg-[#d4ede8]',
                ].join(' ')}
              >
                <span className="min-w-0">
                  <span className="block text-[14px] font-semibold leading-5">{item.title}</span>
                  <span className="mt-0.5 block text-[12px] leading-4 text-[#6a7282]">
                    {item.subtitle}
                  </span>
                </span>
                <ArrowUpRightIcon
                  className={['size-4 shrink-0', item.primary ? 'text-[#186179]' : 'text-[#9ca3af]'].join(' ')}
                />
              </button>
            ))}
          </div>
        </div>
      </div>

      <footer className="flex shrink-0 flex-col gap-2 border-t border-[#e5e7eb] px-6 py-4">
        <button
          type="button"
          disabled={saving}
          onClick={onClose}
          className="inline-flex min-h-[44px] w-full cursor-pointer items-center justify-center rounded-[10px] border border-[#e5e7eb] bg-white px-4 py-2.5 text-[13px] font-medium text-[#364153] outline-none transition-colors duration-150 hover:bg-[#f9fafb] focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-2 disabled:opacity-50"
        >
          Close
        </button>
        <button
          type="button"
          disabled={saving || !onAction}
          onClick={() => onAction?.('mark_resolved', review)}
          className="inline-flex min-h-[44px] w-full cursor-pointer items-center justify-center gap-2 rounded-[10px] bg-[#0A4D38] px-4 py-2.5 text-[13px] font-medium text-white outline-none transition-colors duration-150 hover:bg-[#083d2d] active:bg-[#062e22] focus-visible:ring-2 focus-visible:ring-[#0A4D38] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <CheckCircleIcon />
          {saving ? 'Working…' : 'Mark resolved'}
        </button>
      </footer>
    </div>
  )

  if (panelOnly) return panel

  return (
    <div className={ADMIN_RIGHT_RAIL_OVERLAY_HOST}>
      <div role="presentation" className={ADMIN_RIGHT_RAIL_SCRIM} aria-hidden onClick={onClose} />
      {panel}
    </div>
  )
}

export default LeaseRenewalEscalatedRail
