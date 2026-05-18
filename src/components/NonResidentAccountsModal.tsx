import { useEffect, useId } from 'react'

type NonResidentRow = {
  id: string
  name: string
  email: string
  lastUnit: string
  balanceCents: number
}

const DEMO_NON_RESIDENTS: NonResidentRow[] = [
  {
    id: '1',
    name: 'Amanda Foster',
    email: 'amanda.f@email.com',
    lastUnit: '7C',
    balanceCents: 25000,
  },
]

function formatBalance(cents: number) {
  const n = cents / 100
  return `$${n.toFixed(2)}`
}

function IconClose({ className = 'size-5 text-neutral' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" />
    </svg>
  )
}

function IconUserXHeader({ className = 'size-5 text-tertiary' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
      />
      <circle cx="9" cy="7" r="4" stroke="currentColor" strokeWidth={1.8} />
      <path d="M17 9l4 4m0-4l-4 4" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" />
    </svg>
  )
}

/** Non-resident accounts table (Figma 130:19011). */
export function NonResidentAccountsModal({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
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

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div role="presentation" className="absolute inset-0 bg-black/40" aria-hidden onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative flex h-full max-h-dvh w-full max-w-[min(100vw,768px)] flex-col overflow-hidden border-l border-secondary bg-white shadow-[inset_1px_0_0_0_#A788964D]"
      >
        <header className="flex h-[81px] shrink-0 items-center justify-between border-b border-secondary px-6">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-[10px] bg-tertiary">
              <IconUserXHeader />
            </div>
            <div className="min-w-0">
              <h2
                id={titleId}
                className="text-[18px] font-semibold leading-7 tracking-[-0.4395px] text-extended-3"
              >
                Non-Resident Accounts
              </h2>
              <p className="text-[14px] font-normal leading-5 tracking-[-0.1504px] text-neutral">
                Past residents and outstanding balances
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex size-9 shrink-0 items-center justify-center rounded-lg outline-none hover:bg-secondary focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          >
            <IconClose />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-auto px-6 py-6">
          <div className="overflow-hidden rounded-[10px] border border-secondary">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-secondary bg-secondary">
                  <th className="px-4 py-3 text-[12px] font-medium leading-4 text-neutral-variant">Name</th>
                  <th className="px-4 py-3 text-[12px] font-medium leading-4 text-neutral-variant">
                    Last Unit
                  </th>
                  <th className="px-4 py-3 text-[12px] font-medium leading-4 text-neutral-variant">
                    Outstanding Balance
                  </th>
                  <th className="px-4 py-3 text-right text-[12px] font-medium leading-4 text-neutral-variant">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {DEMO_NON_RESIDENTS.map((row) => (
                  <tr key={row.id} className="border-b border-secondary last:border-b-0">
                    <td className="px-4 py-3 align-middle">
                      <div className="flex flex-col gap-0.5">
                        <p className="text-[14px] font-medium leading-5 tracking-[-0.1504px] text-extended-3">
                          {row.name}
                        </p>
                        <p className="text-[12px] font-normal leading-4 text-neutral">{row.email}</p>
                      </div>
                    </td>
                    <td className="px-4 py-3 align-middle">
                      <p className="text-[14px] font-normal leading-5 tracking-[-0.1504px] text-neutral-variant">
                        {row.lastUnit}
                      </p>
                    </td>
                    <td className="px-4 py-3 align-middle">
                      <p className="text-[14px] font-semibold leading-5 tracking-[-0.1504px] text-error">
                        {formatBalance(row.balanceCents)}
                      </p>
                    </td>
                    <td className="px-4 py-3 align-middle">
                      <div className="flex justify-end">
                        <button
                          type="button"
                          className="rounded px-3 py-1.5 text-[12px] font-medium leading-4 text-white outline-none bg-extended-1 hover:bg-extended-1 focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                        >
                          View Details
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <footer className="flex shrink-0 justify-end border-t border-secondary bg-secondary px-6 pb-5 pt-4">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-10 items-center justify-center rounded-[10px] bg-neutral-variant px-8 text-[16px] font-medium leading-6 tracking-[-0.3125px] text-white outline-none hover:bg-neutral-variant focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          >
            Close
          </button>
        </footer>
      </div>
    </div>
  )
}
