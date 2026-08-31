import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

type AdminBottomSheetProps = {
  open: boolean
  onClose: () => void
  labelledBy: string
  children: ReactNode
}

/** Mobile bottom sheet for admin overlays that are a right rail on desktop. */
export function AdminBottomSheet({
  open,
  onClose,
  labelledBy,
  children,
}: AdminBottomSheetProps) {
  useEffect(() => {
    if (!open) return
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prevOverflow
      window.removeEventListener('keydown', onKey)
    }
  }, [open, onClose])

  if (!open || typeof document === 'undefined') return null

  return createPortal(
    <div className="fixed inset-0 z-[60] flex flex-col justify-end">
      <div
        role="presentation"
        className="sa-scrim absolute inset-0 bg-black/40"
        aria-hidden
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        className="sa-sheet relative flex max-h-[min(92dvh,840px)] min-h-0 w-full flex-col overflow-hidden rounded-t-[16px] border border-[#e5e7eb] bg-white pb-[env(safe-area-inset-bottom,0px)] shadow-[0px_-8px_24px_rgba(0,0,0,0.12)]"
      >
        <div className="flex shrink-0 justify-center pb-1 pt-2" aria-hidden>
          <div className="sa-pill h-1 w-10 rounded-full bg-[#d1d5dc]" />
        </div>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{children}</div>

      </div>
    </div>,
    document.body,
  )
}
