import { useEffect, useId } from 'react'
import {
  ADMIN_RIGHT_RAIL_OVERLAY_HOST,
  ADMIN_RIGHT_RAIL_SCRIM,
  adminRightRailPanelClass,
} from '@/lib/adminRightRail'
import type { ResidentRentHistoryItem } from '@/lib/residentRentHistory'

function CloseIcon() {
  return (
    <svg className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
    </svg>
  )
}

export function ResidentRentHistoryRail({
  open,
  residentName,
  items,
  onClose,
}: {
  open: boolean
  residentName: string
  items: ResidentRentHistoryItem[]
  onClose: () => void
}) {
  const titleId = useId()

  useEffect(() => {
    if (!open) return
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className={ADMIN_RIGHT_RAIL_OVERLAY_HOST}>
      <div role="presentation" className={ADMIN_RIGHT_RAIL_SCRIM} aria-hidden onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={adminRightRailPanelClass(undefined)}
      >
        <header className="sa-enter relative shrink-0 border-b border-[#e5e7eb] px-5 py-4 pr-12">
          <h2 id={titleId} className="text-[16px] font-semibold leading-6 text-[#0a0a0a]">
            Rent history
          </h2>
          <p className="mt-1 text-[13px] leading-5 text-[#6a7282]">{residentName}</p>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close rent history"
            className="sa-press absolute right-4 top-4 rounded-lg p-1 text-[#9ca3af] outline-none hover:bg-black/5 hover:text-[#364153] focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-2"
          >
            <CloseIcon />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">
          {items.length === 0 ? (
            <p className="py-8 text-center text-[13px] leading-5 text-[#6a7282]">
              No rent history on file yet.
            </p>
          ) : (
            <ul className="flex flex-col gap-3">
              {items.map((item) => (
                <li
                  key={item.id}
                  className="rounded-[10px] border border-[#e5e7eb] bg-[#fafafa] px-3.5 py-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[14px] font-semibold leading-5 text-[#0a0a0a]">
                        {item.title}
                      </p>
                      {item.detail ? (
                        <p className="mt-1 text-[12px] leading-4 text-[#6a7282]">{item.detail}</p>
                      ) : null}
                      <p className="mt-1.5 text-[12px] leading-4 text-[#9ca3af]">
                        {item.occurredLabel}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      {item.amountLabel ? (
                        <p className="text-[14px] font-semibold tabular-nums text-[#0a0a0a]">
                          {item.amountLabel}
                        </p>
                      ) : null}
                      <p className="mt-1 text-[11px] font-medium text-[#6a7282]">{item.statusLabel}</p>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
