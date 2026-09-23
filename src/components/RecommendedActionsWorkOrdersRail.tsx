import { useEffect, useId, type CSSProperties } from 'react'
import {
  ADMIN_RAIL_FOOTER_CLASS,
  ADMIN_RAIL_FOOTER_SECONDARY_BUTTON_CLASS,
  ADMIN_RIGHT_RAIL_OVERLAY_HOST,
  ADMIN_RIGHT_RAIL_SCRIM,
  adminRightRailPanelClass,
} from '@/lib/adminRightRail'

export type RecommendedActionWorkOrderItem = {
  id: string
  title: string
  summary: string | null
  context: string | null
  categoryLabel: string | null
  statusLabel: string | null
  critical: boolean
}

type RecommendedActionsWorkOrdersRailProps = {
  open: boolean
  title: string
  subtitle?: string | null
  items: RecommendedActionWorkOrderItem[]
  onClose: () => void
  onSelect: (item: RecommendedActionWorkOrderItem) => void
}

function CloseIcon() {
  return (
    <svg className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
    </svg>
  )
}

/** Right rail listing work orders behind a Recommended Actions card (Active Tasks–style cards). */
export function RecommendedActionsWorkOrdersRail({
  open,
  title,
  subtitle,
  items,
  onClose,
  onSelect,
}: RecommendedActionsWorkOrdersRailProps) {
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
        className={adminRightRailPanelClass(undefined, 'max-w-[min(100vw,520px)]')}
      >
        <div className="sa-enter shrink-0 border-b border-[#e5e7eb] px-6 pb-4 pt-6">
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="sa-press absolute right-4 top-4 rounded-lg p-1 text-[#9ca3af] outline-none hover:bg-black/5 hover:text-[#364153] focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-2"
          >
            <CloseIcon />
          </button>
          <h2
            id={titleId}
            className="pr-8 text-[20px] font-semibold leading-7 tracking-[-0.3px] text-[#0a0a0a]"
          >
            {title}
          </h2>
          <p className="mt-1 text-[13px] leading-5 text-[#6a7282]">
            {subtitle?.trim() ||
              `${items.length} work order${items.length === 1 ? '' : 's'} behind this recommendation`}
          </p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4">
          {items.length === 0 ? (
            <p className="sa-enter px-2 py-12 text-center text-[13px] text-[#6a7282]">
              No linked work orders for this recommendation.
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              {items.map((item, index) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onSelect(item)}
                  style={{ '--sa-stagger': index } as CSSProperties}
                  className="sa-stagger-scale sa-card sa-press flex w-full flex-col gap-2 rounded-[10px] border border-[#e5e7eb] bg-white p-3 text-left shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)] outline-none hover:border-[#d1d5dc] focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-2"
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="min-w-0 flex-1 text-[14px] font-medium leading-5 text-[#0a0a0a]">
                      {item.title}
                    </p>
                    {item.critical ? (
                      <span className="mt-1 size-2 shrink-0 rounded-full bg-[#fb2c36]" aria-hidden />
                    ) : null}
                  </div>
                  {item.summary ? (
                    <p className="truncate text-[13px] font-medium leading-4 text-[#364153]">
                      {item.summary}
                    </p>
                  ) : null}
                  {item.context ? (
                    <p className="truncate text-[12px] leading-4 text-[#6a7282]">{item.context}</p>
                  ) : null}
                  <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                    {item.categoryLabel ? (
                      <span className="inline-flex rounded-[6px] bg-[#e8f4f2] px-2 py-0.5 text-[11px] font-medium text-[#146b52]">
                        {item.categoryLabel}
                      </span>
                    ) : null}
                    {item.statusLabel ? (
                      <span className="inline-flex rounded-[6px] bg-[#f3f4f6] px-2 py-0.5 text-[11px] font-medium text-[#364153]">
                        {item.statusLabel}
                      </span>
                    ) : null}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        <footer className={ADMIN_RAIL_FOOTER_CLASS}>
          <button
            type="button"
            onClick={onClose}
            className={ADMIN_RAIL_FOOTER_SECONDARY_BUTTON_CLASS}
          >
            Close
          </button>
        </footer>
      </div>
    </div>
  )
}

export default RecommendedActionsWorkOrdersRail
