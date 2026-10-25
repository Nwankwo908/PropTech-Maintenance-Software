import { useEffect, useId, useState } from 'react'
import { TableCheckbox } from '@/components/TableCheckbox'
import {
  ADMIN_ATTENTION_ACTION_CLASS,
  ADMIN_RAIL_FOOTER_CLASS,
  ADMIN_RAIL_FOOTER_PRIMARY_BUTTON_CLASS,
  ADMIN_RAIL_FOOTER_SECONDARY_BUTTON_CLASS,
  ADMIN_RIGHT_RAIL_OVERLAY_HOST,
  ADMIN_RIGHT_RAIL_SCRIM,
  adminRightRailPanelClass,
} from '@/lib/adminRightRail'
import type { PmServiceCard } from '@shared/pm/pmServiceAttention'

export function PmAttentionActions({
  approveLabel,
  onApprove,
  reviewLabel,
  onReview,
  onSnooze,
}: {
  approveLabel?: string
  onApprove?: () => void
  reviewLabel: string
  onReview?: () => void
  onSnooze?: () => void
}) {
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2">
      {approveLabel && onApprove ? (
        <button type="button" onClick={onApprove} className={ADMIN_ATTENTION_ACTION_CLASS}>
          {approveLabel}
        </button>
      ) : null}
      {onReview ? (
        <button type="button" onClick={onReview} className={ADMIN_ATTENTION_ACTION_CLASS}>
          {reviewLabel}
        </button>
      ) : null}
      {onSnooze ? (
        <button type="button" onClick={onSnooze} className={ADMIN_ATTENTION_ACTION_CLASS}>
          Snooze 3 days
        </button>
      ) : null}
    </div>
  )
}

function money(amount: number | null): string {
  if (amount == null || !Number.isFinite(amount)) return '—'
  return amount.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

type PmServiceReviewRailProps = {
  open: boolean
  card: PmServiceCard | null
  saving?: boolean
  onClose: () => void
  onApprove: (unitIds: string[]) => void
}

/** Per-unit review for one preventive HVAC batch. Uses the existing right rail. */
export function PmServiceReviewRail({
  open,
  card,
  saving = false,
  onClose,
  onApprove,
}: PmServiceReviewRailProps) {
  const titleId = useId()
  const [ticked, setTicked] = useState<string[]>([])

  useEffect(() => {
    setTicked(card?.units.map((unit) => unit.id) ?? [])
  }, [card?.key])

  useEffect(() => {
    if (!open) return
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open || !card) return null
  const selected = card.units.filter((unit) => ticked.includes(unit.id))
  const selectedTotal = selected.reduce((sum, unit) => sum + (unit.cost ?? 0), 0)

  return (
    <div className={ADMIN_RIGHT_RAIL_OVERLAY_HOST}>
      <div role="presentation" className={ADMIN_RIGHT_RAIL_SCRIM} aria-hidden onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={adminRightRailPanelClass(undefined, 'max-w-[min(100vw,560px)]')}
      >
        <div className="shrink-0 border-b border-[#e5e7eb] px-6 pb-4 pt-6">
          <h2 id={titleId} className="pr-8 text-[20px] font-semibold leading-7 text-[#0a0a0a]">
            Review preventive HVAC
          </h2>
          <p className="mt-1 text-[13px] leading-5 text-[#6a7282]">{card.context}</p>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <ul className="divide-y divide-[#f3f4f6]">
            {card.units.map((unit) => (
              <li key={unit.id} className="flex items-start gap-3 px-6 py-4">
                <TableCheckbox
                  aria-label={`Include ${unit.unitLabel}`}
                  checked={ticked.includes(unit.id)}
                  onChange={() =>
                    setTicked((current) =>
                      current.includes(unit.id)
                        ? current.filter((id) => id !== unit.id)
                        : [...current, unit.id],
                    )
                  }
                />
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] font-medium text-[#0a0a0a]">{unit.unitLabel}</p>
                  <p className="text-[13px] leading-5 text-[#6a7282]">
                    {[unit.vendorName, unit.visitLabel].filter(Boolean).join(' · ')}
                  </p>
                </div>
                <p className="text-[13px] tabular-nums text-[#364153]">{money(unit.cost)}</p>
              </li>
            ))}
          </ul>
        </div>
        <footer className={ADMIN_RAIL_FOOTER_CLASS}>
          <p className="text-[13px] text-[#364153]">
            {selected.length} selected · {money(selected.length ? selectedTotal : card.totalCost)} total
          </p>
          <button
            type="button"
            disabled={saving || selected.length === 0}
            className={ADMIN_RAIL_FOOTER_PRIMARY_BUTTON_CLASS}
            onClick={() => onApprove(selected.map((unit) => unit.id))}
          >
            Approve
          </button>
          <button type="button" onClick={onClose} className={ADMIN_RAIL_FOOTER_SECONDARY_BUTTON_CLASS}>
            Close
          </button>
        </footer>
      </div>
    </div>
  )
}
