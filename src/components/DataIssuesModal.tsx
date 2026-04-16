import { useEffect, useId } from 'react'

function IconClose({ className = 'size-5 text-[#6a7282]' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" />
    </svg>
  )
}

function IconHeaderAlert({ className = 'size-5 text-[#f54900]' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 9v4m0 4h.01M10.3 4.8 2.2 16A2 2 0 004 17.8h16a2 2 0 001.8-1.8l-8.1-12a2 2 0 00-3.4 0z"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function IconIncompleteSection({ className = 'size-4 shrink-0 text-[#f54900]' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth={1.65} />
      <path
        d="M12 10v5M12 8h.01"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
      />
    </svg>
  )
}

function IconDuplicateSection({ className = 'size-4 shrink-0 text-[#e7000b]' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 9v4m0 4h.01M10.3 4.8 2.2 16A2 2 0 004 17.8h16a2 2 0 001.8-1.8l-8.1-12a2 2 0 00-3.4 0z"
        stroke="currentColor"
        strokeWidth={1.65}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function IconUnassignedSection({ className = 'size-4 shrink-0 text-[#ca8a04]' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M3 10.5 12 3l9 7.5V20a1 1 0 01-1 1h-5v-6H9v6H4a1 1 0 01-1-1v-9.5Z"
        stroke="currentColor"
        strokeWidth={1.65}
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** Data issues review panel (Figma 130:17602). */
export function DataIssuesModal({ open, onClose }: { open: boolean; onClose: () => void }) {
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

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div role="presentation" className="absolute inset-0 bg-black/40" aria-hidden onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative flex h-full max-h-dvh w-full max-w-[min(100vw,640px)] flex-col overflow-hidden border-l border-[#e5e7eb] bg-white shadow-[inset_1px_0_0_0_#e5e7eb]"
      >
        <header className="flex h-[81px] shrink-0 items-center justify-between border-b border-[#e5e7eb] px-6">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-[10px] bg-[#ffedd4]">
              <IconHeaderAlert />
            </div>
            <div className="min-w-0">
              <h2
                id={titleId}
                className="text-[18px] font-semibold leading-7 tracking-[-0.4395px] text-[#101828]"
              >
                Data Issues &amp; Conflicts
              </h2>
              <p className="text-[14px] font-normal leading-5 tracking-[-0.1504px] text-[#6a7282]">
                Review and resolve data inconsistencies
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex size-9 shrink-0 items-center justify-center rounded-lg outline-none hover:bg-[#f3f4f6] focus-visible:ring-2 focus-visible:ring-[#944c73] focus-visible:ring-offset-2"
          >
            <IconClose />
          </button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto px-6 py-6">
          <section className="flex flex-col gap-3 rounded-[10px] border border-[#ffd6a8] px-[17px] pb-4 pt-[17px]">
            <h3 className="flex items-center gap-2 text-[14px] font-semibold leading-5 tracking-[-0.1504px] text-[#101828]">
              <IconIncompleteSection />
              Incomplete Profiles (2)
            </h3>
            <div className="flex flex-col gap-2">
              <div className="flex min-h-[62px] items-center justify-between gap-3 rounded border border-[#ffd6a8] bg-[#fff7ed] px-[13px] py-2">
                <div className="min-w-0">
                  <p className="text-[14px] font-medium leading-5 tracking-[-0.1504px] text-[#101828]">
                    Emily Rodriguez
                  </p>
                  <p className="mt-0.5 text-[12px] font-normal leading-4 text-[#4a5565]">
                    Missing: Phone number
                  </p>
                </div>
                <button
                  type="button"
                  className="shrink-0 rounded px-3 py-1.5 text-[12px] font-medium leading-4 text-white outline-none bg-[#f54900] hover:bg-[#d44300] focus-visible:ring-2 focus-visible:ring-[#944c73] focus-visible:ring-offset-2"
                >
                  Fix Now
                </button>
              </div>
              <div className="flex min-h-[62px] items-center justify-between gap-3 rounded border border-[#ffd6a8] bg-[#fff7ed] px-[13px] py-2">
                <div className="min-w-0">
                  <p className="text-[14px] font-medium leading-5 tracking-[-0.1504px] text-[#101828]">
                    Robert Kim
                  </p>
                  <p className="mt-0.5 text-[12px] font-normal leading-4 text-[#4a5565]">
                    Missing: Emergency contact
                  </p>
                </div>
                <button
                  type="button"
                  className="shrink-0 rounded px-3 py-1.5 text-[12px] font-medium leading-4 text-white outline-none bg-[#f54900] hover:bg-[#d44300] focus-visible:ring-2 focus-visible:ring-[#944c73] focus-visible:ring-offset-2"
                >
                  Fix Now
                </button>
              </div>
            </div>
          </section>

          <section className="flex flex-col gap-3 rounded-[10px] border border-[#ffc9c9] px-[17px] pb-4 pt-[17px]">
            <h3 className="flex items-center gap-2 text-[14px] font-semibold leading-5 tracking-[-0.1504px] text-[#101828]">
              <IconDuplicateSection />
              Duplicate Accounts (1)
            </h3>
            <div className="flex min-h-[62px] items-center justify-between gap-3 rounded border border-[#ffc9c9] bg-[#fef2f2] px-[13px] py-2">
              <div className="min-w-0">
                <p className="text-[14px] font-medium leading-5 tracking-[-0.1504px] text-[#101828]">
                  Lisa Wang
                </p>
                <p className="mt-0.5 text-[12px] font-normal leading-4 text-[#4a5565]">
                  Possible duplicate email detected
                </p>
              </div>
              <button
                type="button"
                className="shrink-0 rounded px-3 py-1.5 text-[12px] font-medium leading-4 text-white outline-none bg-[#e7000b] hover:bg-[#c10007] focus-visible:ring-2 focus-visible:ring-[#944c73] focus-visible:ring-offset-2"
              >
                Review
              </button>
            </div>
          </section>

          <section className="rounded-[10px] border border-[#fff085] px-[17px] pb-4 pt-[17px]">
            <h3 className="flex items-center gap-2 text-[14px] font-semibold leading-5 tracking-[-0.1504px] text-[#101828]">
              <IconUnassignedSection />
              Unassigned Active Residents (0)
            </h3>
          </section>
        </div>

        <footer className="flex shrink-0 justify-end border-t border-[#e5e7eb] bg-[#f9fafb] px-6 pb-5 pt-4">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-10 items-center justify-center rounded-[10px] bg-[#4a5565] px-8 text-[16px] font-medium leading-6 tracking-[-0.3125px] text-white outline-none hover:bg-[#364153] focus-visible:ring-2 focus-visible:ring-[#944c73] focus-visible:ring-offset-2"
          >
            Close
          </button>
        </footer>
      </div>
    </div>
  )
}
