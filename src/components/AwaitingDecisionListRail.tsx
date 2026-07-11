import { useEffect, useId } from 'react'
import { Link } from 'react-router-dom'
import {
  ADMIN_RIGHT_RAIL_OVERLAY_HOST,
  ADMIN_RIGHT_RAIL_SCRIM,
  adminRightRailPanelClass,
} from '@/lib/adminRightRail'

export type AwaitingDecisionItem = {
  key: string
  title: string
  badge: 'critical' | 'warning'
  context: string
  meta: string
  actionLabel: string
  actionTo?: string
  onAction?: () => void
  actionStyle?: 'alert'
}

function CloseIcon() {
  return (
    <svg className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
    </svg>
  )
}

type AwaitingDecisionListRailProps = {
  open: boolean
  items: AwaitingDecisionItem[]
  criticalCount: number
  onClose: () => void
  onItemAction: (item: AwaitingDecisionItem) => void
}

/** Full awaiting-decision queue — overview right rail. */
export function AwaitingDecisionListRail({
  open,
  items,
  criticalCount,
  onClose,
  onItemAction,
}: AwaitingDecisionListRailProps) {
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
        className={adminRightRailPanelClass(undefined, 'max-w-[min(100vw,560px)]')}
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

          <h2
            id={titleId}
            className="pr-8 text-[20px] font-semibold leading-7 tracking-[-0.3px] text-[#0a0a0a]"
          >
            Awaiting Your Decision
          </h2>
          <p className="mt-1 text-[13px] leading-5 text-[#6a7282]">
            {items.length} operation{items.length === 1 ? '' : 's'} awaiting your decision
            {criticalCount > 0 ? ` · ${criticalCount} critical` : ''}
          </p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {items.length === 0 ? (
            <p className="px-6 py-12 text-center text-[13px] text-[#6a7282]">Nothing needs attention.</p>
          ) : (
            <div className="flex flex-col divide-y divide-[#f3f4f6]">
              {items.map((item) => (
                <div key={item.key} className="flex items-center gap-4 px-6 py-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-[14px] font-semibold leading-5 tracking-[-0.1504px] text-[#0a0a0a]">
                        {item.title}
                      </p>
                      <span
                        className={[
                          'rounded-[4px] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em]',
                          item.badge === 'critical'
                            ? 'bg-[#E3646C] text-white'
                            : item.actionStyle === 'alert'
                              ? 'bg-[#FBE3E5] text-[#E3646C]'
                              : 'bg-[#fef9c2] text-[#a65f00]',
                        ].join(' ')}
                      >
                        {item.badge === 'critical' ? 'Critical' : 'Warning'}
                      </span>
                    </div>
                    {item.context ? (
                      <p className="mt-0.5 text-[13px] leading-5 text-[#6a7282]">{item.context}</p>
                    ) : null}
                    <p className="text-[12px] leading-4 text-[#6a7282]">{item.meta}</p>
                  </div>
                  {item.onAction ? (
                    <button
                      type="button"
                      onClick={() => onItemAction(item)}
                      className={[
                        'shrink-0 rounded-[10px] border px-4 py-2 text-[13px] font-medium leading-5 transition-colors duration-150',
                        item.actionStyle === 'alert'
                          ? 'border-transparent bg-[#FBE3E5] text-[#E3646C] hover:bg-[#f5d0d4]'
                          : 'border-current bg-white text-tertiary hover:bg-[#e2f5f1]',
                      ].join(' ')}
                    >
                      {item.actionLabel} →
                    </button>
                  ) : (
                    <Link
                      to={item.actionTo ?? '/admin/workflows'}
                      onClick={() => onClose()}
                      className={[
                        'shrink-0 rounded-[10px] border px-4 py-2 text-[13px] font-medium leading-5 transition-colors duration-150',
                        item.actionStyle === 'alert'
                          ? 'border-transparent bg-[#FBE3E5] text-[#E3646C] hover:bg-[#f5d0d4]'
                          : 'border-current bg-white text-tertiary hover:bg-[#e2f5f1]',
                      ].join(' ')}
                    >
                      {item.actionLabel} →
                    </Link>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <footer className="flex shrink-0 justify-end border-t border-[#e5e7eb] px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer rounded-[10px] border border-[#e5e7eb] bg-white px-4 py-2 text-[13px] font-medium text-[#364153] outline-none transition-colors duration-150 hover:bg-[#f9fafb] focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-2"
          >
            Close
          </button>
        </footer>
      </div>
    </div>
  )
}

export default AwaitingDecisionListRail
