import { useEffect, useId } from 'react'
import { noInspectorAvailableTitle } from '@shared/portfolioIntelligence'

type NoInspectorAvailableModalProps = {
  open: boolean
  building?: string | null
  targetDay?: string | null
  onClose: () => void
  onFindExternal: () => void
}

export function NoInspectorAvailableModal({
  open,
  building,
  targetDay,
  onClose,
  onFindExternal,
}: NoInspectorAvailableModalProps) {
  const titleId = useId()
  const title = noInspectorAvailableTitle({ building, targetDay })

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
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
      <div
        role="presentation"
        className="absolute inset-0"
        aria-hidden
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative w-full max-w-[420px] rounded-[12px] bg-white p-6 shadow-[0px_20px_25px_-5px_rgba(0,0,0,0.1),0px_8px_10px_-6px_rgba(0,0,0,0.1)]"
      >
        <h2 id={titleId} className="text-[18px] font-semibold leading-6 tracking-[-0.2px] text-[#111827]">
          {title}
        </h2>
        <p className="mt-2 text-[14px] leading-5 text-[#4b5563]">
          No one on your vendor list can take this inspection.
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="h-9 rounded-lg px-4 text-[14px] font-medium text-[#4a5565] outline-none hover:bg-[#f3f4f6] focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-2"
          >
            Not now
          </button>
          <button
            type="button"
            onClick={onFindExternal}
            className="h-9 rounded-lg bg-[#70ABC5] px-4 text-[14px] font-semibold text-white outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-2"
          >
            Find external vendor
          </button>
        </div>
      </div>
    </div>
  )
}
