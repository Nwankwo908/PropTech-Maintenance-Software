import { useEffect, useId, useState } from 'react'

type ResidentRow = {
  id: string
  name: string
  apt: string
  phone: string
  email: string
  preferredMethod: string
}

const INITIAL_RESIDENTS: ResidentRow[] = [
  {
    id: '1',
    name: 'Sarah Chen',
    apt: 'Apt 204',
    phone: '(555) 234-5678',
    email: 'sarah.chen@email.com',
    preferredMethod: 'Email',
  },
  {
    id: '2',
    name: 'Mike Torres',
    apt: 'Apt 301',
    phone: '(555) 876-5432',
    email: 'mike.torres@email.com',
    preferredMethod: 'Email',
  },
  {
    id: '3',
    name: 'Emily Rodriguez',
    apt: 'Apt 405',
    phone: '(555) 345-6789',
    email: 'emily.r@email.com',
    preferredMethod: 'Email',
  },
]

const PREFERRED_OPTIONS = ['SMS', 'Email', 'Phone', 'In-App'] as const

function LabelPhoneIcon({ className = 'size-4 shrink-0 text-[#6a7282]' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.12.9.33 1.77.62 2.6a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.48-1.29a2 2 0 012.11-.45c.83.29 1.7.5 2.6.62A2 2 0 0122 16.92z"
        stroke="currentColor"
        strokeWidth={1.65}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function LabelMailIcon({ className = 'size-4 shrink-0 text-[#6a7282]' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"
        stroke="currentColor"
        strokeWidth={1.65}
        strokeLinecap="round"
      />
      <path d="m22 6-10 7L2 6" stroke="currentColor" strokeWidth={1.65} strokeLinecap="round" />
    </svg>
  )
}

function LabelChatIcon({ className = 'size-4 shrink-0 text-[#6a7282]' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8.5z"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function AvatarUserIcon({ className = 'size-5 text-[#1447e6]' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="8" r="3.5" stroke="currentColor" strokeWidth={1.65} />
      <path
        d="M6 19.5c0-3.5 3.5-5.5 6-5.5s6 2 6 5.5"
        stroke="currentColor"
        strokeWidth={1.65}
        strokeLinecap="round"
      />
    </svg>
  )
}

export type UpdateContactInformationPresentation = 'modal' | 'rail'

/** Bulk edit contacts after failed SMS (Figma 88:13546). */
export function UpdateContactInformationModal({
  open,
  onClose,
  presentation = 'modal',
}: {
  open: boolean
  onClose: () => void
  presentation?: UpdateContactInformationPresentation
}) {
  const titleId = useId()
  const [residents, setResidents] = useState<ResidentRow[]>(() =>
    INITIAL_RESIDENTS.map((r) => ({ ...r })),
  )

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const [prevOpen, setPrevOpen] = useState(open)
  if (open !== prevOpen) {
    setPrevOpen(open)
    if (open) setResidents(INITIAL_RESIDENTS.map((r) => ({ ...r })))
  }

  if (!open) return null

  const isRail = presentation === 'rail'

  function patchResident(id: string, patch: Partial<Pick<ResidentRow, 'phone' | 'email' | 'preferredMethod'>>) {
    setResidents((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  }

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
        className={['absolute inset-0', isRail ? 'bg-black/40' : ''].filter(Boolean).join(' ')}
        aria-hidden
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={
          isRail
            ? 'relative flex h-full max-h-dvh w-full max-w-[min(100vw,768px)] flex-col overflow-hidden border-l border-[#e5e7eb] bg-white shadow-[inset_1px_0_0_0_#e5e7eb]'
            : 'relative flex max-h-[min(92dvh,900px)] w-full max-w-[768px] flex-col overflow-hidden rounded-[10px] bg-white shadow-[0px_20px_25px_-5px_rgba(0,0,0,0.1),0px_8px_10px_-6px_rgba(0,0,0,0.1)]'
        }
      >
        <header className="shrink-0 border-b border-[#e5e7eb] px-6 py-6">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h2
                id={titleId}
                className="text-[20px] font-semibold leading-7 tracking-[-0.4492px] text-[#101828]"
              >
                Update Contact Information
              </h2>
              <p className="mt-1 text-[14px] leading-5 tracking-[-0.1504px] text-[#4a5565]">
                Update contact details for residents with failed SMS delivery
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="shrink-0 rounded-lg p-1 text-[#6a7282] outline-none hover:bg-black/5 hover:text-[#0a0a0a] focus-visible:ring-2 focus-visible:ring-[#944c73] focus-visible:ring-offset-2"
            >
              <svg className="size-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
                <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
          <div className="flex flex-col gap-6">
            {residents.map((r) => (
              <div
                key={r.id}
                className="rounded-[10px] border border-[#e5e7eb] bg-[#f9fafb] px-[21px] pb-5 pt-[21px]"
              >
                <div className="mb-4 flex items-center gap-3 border-b border-[#e5e7eb] pb-4">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[#dbeafe]">
                    <AvatarUserIcon />
                  </div>
                  <div>
                    <p className="text-[18px] font-semibold leading-[27px] tracking-[-0.4395px] text-[#101828]">
                      {r.name}
                    </p>
                    <p className="text-[14px] leading-5 tracking-[-0.1504px] text-[#4a5565]">{r.apt}</p>
                  </div>
                </div>

                <div className="flex flex-col gap-4">
                  <div>
                    <label
                      htmlFor={`contact-phone-${r.id}`}
                      className="mb-2 flex items-center gap-2 text-[14px] font-medium tracking-[-0.1504px] text-[#364153]"
                    >
                      <LabelPhoneIcon />
                      Phone Number
                    </label>
                    <input
                      id={`contact-phone-${r.id}`}
                      type="tel"
                      value={r.phone}
                      onChange={(e) => patchResident(r.id, { phone: e.target.value })}
                      className="h-[42px] w-full rounded-[10px] border border-[#d1d5dc] px-4 text-[16px] leading-6 tracking-[-0.3125px] text-[#0a0a0a] outline-none placeholder:text-[rgba(10,10,10,0.5)] focus:border-[#944c73]/45 focus:ring-2 focus:ring-[#944c73]/30"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor={`contact-email-${r.id}`}
                      className="mb-2 flex items-center gap-2 text-[14px] font-medium tracking-[-0.1504px] text-[#364153]"
                    >
                      <LabelMailIcon />
                      Email Address
                    </label>
                    <input
                      id={`contact-email-${r.id}`}
                      type="email"
                      value={r.email}
                      onChange={(e) => patchResident(r.id, { email: e.target.value })}
                      className="h-[42px] w-full rounded-[10px] border border-[#d1d5dc] px-4 text-[16px] leading-6 tracking-[-0.3125px] text-[#0a0a0a] outline-none placeholder:text-[rgba(10,10,10,0.5)] focus:border-[#944c73]/45 focus:ring-2 focus:ring-[#944c73]/30"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor={`contact-pref-${r.id}`}
                      className="mb-2 flex items-center gap-2 text-[14px] font-medium tracking-[-0.1504px] text-[#364153]"
                    >
                      <LabelChatIcon />
                      Preferred Contact Method
                    </label>
                    <div className="relative">
                      <select
                        id={`contact-pref-${r.id}`}
                        value={r.preferredMethod}
                        onChange={(e) => patchResident(r.id, { preferredMethod: e.target.value })}
                        className="h-[38px] w-full appearance-none rounded-[10px] border border-[#d1d5dc] bg-white py-1 pl-3 pr-9 text-[14px] font-medium tracking-[-0.1504px] text-[#0a0a0a] outline-none focus:border-[#944c73]/45 focus:ring-2 focus:ring-[#944c73]/30"
                      >
                        {PREFERRED_OPTIONS.map((opt) => (
                          <option key={opt} value={opt}>
                            {opt}
                          </option>
                        ))}
                      </select>
                      <span className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-[#6a7282]">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
                          <path d="M6 9l6 6 6-6" />
                        </svg>
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <footer className="shrink-0 border-t border-[#e5e7eb] bg-[#f9fafb] px-6 py-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-[14px] leading-5 tracking-[-0.1504px] text-[#4a5565]">
              Changes will be saved to the resident database immediately
            </p>
            <div className="flex flex-wrap items-center justify-end gap-3">
              <button
                type="button"
                onClick={onClose}
                className="inline-flex h-9 items-center justify-center rounded-lg border border-black/10 bg-white px-[17px] text-[14px] font-medium tracking-[-0.1504px] text-[#0a0a0a] outline-none hover:bg-[#f3f4f6] focus-visible:ring-2 focus-visible:ring-[#944c73] focus-visible:ring-offset-2"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={onClose}
                className="inline-flex h-9 min-w-[146px] items-center justify-center rounded-lg bg-[#030213] px-4 text-[14px] font-medium tracking-[-0.1504px] text-white outline-none hover:bg-[#1a1f36] focus-visible:ring-2 focus-visible:ring-[#944c73] focus-visible:ring-offset-2"
              >
                Save All Changes
              </button>
            </div>
          </div>
        </footer>
      </div>
    </div>
  )
}
