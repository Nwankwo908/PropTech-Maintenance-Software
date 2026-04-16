import { useEffect, useId } from 'react'

const BULLET_ITEMS = [
  'Do not use any open flames or electrical switches',
  'If you smell gas, evacuate immediately and call 911',
  'Keep windows open for ventilation',
  'PG&E crews are currently working to resolve the issue',
] as const

function HeaderAlertGlyph({ className = 'size-6 shrink-0 text-white' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth={1.8} />
      <path d="M12 8v5M12 16h.01" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" />
    </svg>
  )
}

function ButtonAlertGlyph({ className = 'size-4 shrink-0 text-white' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth={1.8} />
      <path d="M12 8v5M12 16h.01" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" />
    </svg>
  )
}

export type ConfirmEmergencyAlertPresentation = 'modal' | 'rail'

/** Gas leak emergency send confirmation (Figma 89:14898). */
export function ConfirmEmergencyAlertModal({
  open,
  onClose,
  onConfirmSend,
  presentation = 'modal',
}: {
  open: boolean
  onClose: () => void
  /** Called when user confirms; parent may open broadcast or trigger send. */
  onConfirmSend: () => void
  /** `rail` = full-height panel from the right; `modal` = centered dialog. */
  presentation?: ConfirmEmergencyAlertPresentation
}) {
  const titleId = useId()

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const isRail = presentation === 'rail'

  return (
    <div
      className={
        isRail
          ? 'fixed inset-0 z-50 flex justify-end'
          : 'fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4'
      }
    >
      <div
        role="presentation"
        className={isRail ? 'absolute inset-0 bg-black/40' : 'absolute inset-0'}
        aria-hidden
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={
          isRail
            ? 'relative flex h-full max-h-dvh w-full max-w-[min(100vw,672px)] flex-col overflow-hidden border-l border-[#e5e7eb] bg-white shadow-[inset_1px_0_0_0_#e5e7eb]'
            : 'relative flex max-h-[min(92dvh,680px)] w-full max-w-[672px] flex-col overflow-hidden rounded-[10px] bg-white shadow-[0px_20px_25px_-5px_rgba(0,0,0,0.1),0px_8px_10px_-6px_rgba(0,0,0,0.1)]'
        }
      >
        <header className="flex h-[59px] shrink-0 items-center justify-between bg-[#e7000b] px-6">
          <div className="flex min-w-0 items-center gap-3">
            <HeaderAlertGlyph className="size-6 shrink-0 text-white" />
            <h2
              id={titleId}
              className="text-[18px] font-semibold leading-[27px] tracking-[-0.4395px] text-white"
            >
              Confirm Emergency Alert
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded-lg p-0.5 text-white outline-none hover:bg-white/15 focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#e7000b]"
          >
            <svg className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
              <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
            </svg>
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex rounded px-2 py-1 text-[12px] font-medium leading-4 bg-[#e7000b] text-white">
                URGENT
              </span>
              <span className="text-[14px] leading-5 tracking-[-0.1504px] text-[#6a7282]">
                Detected 2 hours ago
              </span>
            </div>

            <h3 className="text-[16px] font-semibold leading-6 tracking-[-0.3125px] text-[#101828]">
              Gas Leak Advisory - PG&amp;E Emergency Alert
            </h3>

            <p className="text-[14px] leading-5 tracking-[-0.1504px] text-[#364153]">
              PG&amp;E has issued an emergency gas leak advisory for the surrounding area. Residents should be
              aware of the following safety precautions:
            </p>

            <ul className="list-disc space-y-1 pl-5 text-[14px] leading-5 tracking-[-0.1504px] text-[#364153]">
              {BULLET_ITEMS.map((line) => (
                <li key={line} className="pl-1">
                  {line}
                </li>
              ))}
            </ul>

            <div className="rounded-[10px] border border-[#e5e7eb] bg-[#f9fafb] p-[17px]">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <p className="text-[14px] leading-5 tracking-[-0.1504px] text-[#6a7282]">Source</p>
                  <p className="mt-1 text-[14px] font-medium leading-5 tracking-[-0.1504px] text-[#101828]">
                    PG&amp;E Emergency Alert System
                  </p>
                </div>
                <div>
                  <p className="text-[14px] leading-5 tracking-[-0.1504px] text-[#6a7282]">Detected Time</p>
                  <p className="mt-1 text-[14px] font-medium leading-5 tracking-[-0.1504px] text-[#101828]">
                    Mar 25, 2:00 PM
                  </p>
                </div>
                <div>
                  <p className="text-[14px] leading-5 tracking-[-0.1504px] text-[#6a7282]">Recipients</p>
                  <p className="mt-1 text-[14px] font-medium leading-5 tracking-[-0.1504px] text-[#101828]">
                    All Residents (142 units)
                  </p>
                </div>
                <div>
                  <p className="text-[14px] leading-5 tracking-[-0.1504px] text-[#6a7282]">Delivery Method</p>
                  <p className="mt-1 text-[14px] font-medium leading-5 tracking-[-0.1504px] text-[#101828]">
                    Email + SMS
                  </p>
                </div>
              </div>
            </div>

            <div className="flex gap-3 rounded-[10px] border border-[#fee685] bg-[#fffbeb] p-[17px]">
              <svg className="mt-0.5 size-5 shrink-0 text-[#e17100]" viewBox="0 0 24 24" fill="none" aria-hidden>
                <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth={1.8} />
                <path d="M12 8v5M12 16h.01" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" />
              </svg>
              <div>
                <p className="text-[14px] font-medium leading-5 tracking-[-0.1504px] text-[#7b3306]">
                  Important Notice
                </p>
                <p className="mt-1 text-[14px] leading-5 tracking-[-0.1504px] text-[#973c00]">
                  This alert will be sent immediately to all residents via both email and SMS. This action cannot be
                  undone.
                </p>
              </div>
            </div>
          </div>
        </div>

        <footer className="flex shrink-0 flex-wrap items-stretch gap-3 border-t border-[#e5e7eb] bg-white px-6 py-4">
          <button
            type="button"
            onClick={() => {
              onClose()
              onConfirmSend()
            }}
            className="inline-flex min-h-9 min-w-0 flex-1 items-center justify-center gap-2 rounded-lg bg-[#e7000b] px-4 text-[14px] font-medium tracking-[-0.1504px] text-white outline-none hover:bg-[#c10007] focus-visible:ring-2 focus-visible:ring-[#944c73] focus-visible:ring-offset-2"
          >
            <ButtonAlertGlyph />
            Send Emergency Alert Now
          </button>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 shrink-0 items-center justify-center rounded-lg border border-black/10 bg-white px-[17px] text-[14px] font-medium tracking-[-0.1504px] text-[#0a0a0a] outline-none hover:bg-[#f3f4f6] focus-visible:ring-2 focus-visible:ring-[#944c73] focus-visible:ring-offset-2"
          >
            Cancel
          </button>
        </footer>
      </div>
    </div>
  )
}
