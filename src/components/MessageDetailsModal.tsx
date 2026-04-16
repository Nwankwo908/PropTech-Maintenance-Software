import { useEffect, useId } from 'react'

export type FailedDeliveryDetail = {
  unit: string
  name: string
  reason: string
}

export type MessageDetailsPayload = {
  sentAtLabel: string
  statusBadge: { label: string; className: string }
  categoryBadge: { label: string; className: string }
  messageTitle: string
  messageBody: string
  totalRecipients: number
  delivered: number
  failed: number
  failedDeliveries: FailedDeliveryDetail[]
  channels: readonly string[]
}

export function MessageDetailsModal({
  open,
  onClose,
  data,
}: {
  open: boolean
  onClose: () => void
  data: MessageDetailsPayload | null
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

  if (!open || !data) return null

  const pct =
    data.totalRecipients > 0
      ? Math.round((data.delivered / data.totalRecipients) * 1000) / 10
      : 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
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
        className="relative flex max-h-[min(92dvh,900px)] w-full max-w-[881px] flex-col overflow-hidden rounded-[10px] bg-white shadow-lg"
      >
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-[#e5e7eb] px-6 py-5">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-[10px] bg-[#dbeafe]">
              <svg className="size-5 text-[#155dfc]" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path
                  d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8.5z"
                  stroke="currentColor"
                  strokeWidth={1.65}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2
                  id={titleId}
                  className="text-[18px] font-semibold leading-7 tracking-[-0.4395px] text-[#0a0a0a]"
                >
                  Message Details
                </h2>
                <span
                  className={`inline-flex rounded px-2 py-1 text-[12px] font-medium leading-4 ${data.statusBadge.className}`}
                >
                  {data.statusBadge.label}
                </span>
                <span
                  className={`inline-flex rounded px-2 py-1 text-[12px] font-medium leading-4 ${data.categoryBadge.className}`}
                >
                  {data.categoryBadge.label}
                </span>
              </div>
              <p className="mt-1 text-[12px] leading-4 text-[#6a7282]">{data.sentAtLabel}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded-lg p-1 text-[#6a7282] outline-none transition-colors hover:bg-black/5 hover:text-[#0a0a0a] focus-visible:ring-2 focus-visible:ring-[#944c73] focus-visible:ring-offset-2"
          >
            <svg className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
              <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
            </svg>
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:gap-6">
            <div className="min-w-0 flex-1 space-y-6">
              <section>
                <div className="mb-3 flex items-center gap-2">
                  <svg className="size-4 text-[#6a7282]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
                    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                    <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" strokeLinecap="round" />
                  </svg>
                  <h3 className="text-[14px] font-semibold leading-5 tracking-[-0.1504px] text-[#101828]">
                    Message Content
                  </h3>
                </div>
                <div className="group relative rounded-[10px] border border-[#e5e7eb] bg-white px-[17px] py-4">
                  <button
                    type="button"
                    aria-label="Edit message content"
                    className="absolute right-3 top-3 rounded-md p-1.5 text-[#6a7282] opacity-0 outline-none transition-opacity hover:bg-black/5 hover:text-[#0a0a0a] focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-[#944c73] focus-visible:ring-offset-2 group-hover:opacity-100"
                  >
                    <svg className="size-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
                      <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                      <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                  <h4 className="pr-10 text-[16px] font-semibold leading-6 tracking-[-0.3125px] text-[#101828]">
                    {data.messageTitle}
                  </h4>
                  <p className="mt-2 text-[14px] leading-5 tracking-[-0.1504px] text-[#364153]">
                    {data.messageBody}
                  </p>
                </div>
              </section>

              <section>
                <div className="mb-3 flex items-center gap-2">
                  <svg className="size-4 text-[#6a7282]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
                    <path d="M18 20V10M12 20V4M6 20v-6" strokeLinecap="round" />
                  </svg>
                  <h3 className="text-[14px] font-semibold leading-5 tracking-[-0.1504px] text-[#101828]">
                    Delivery Statistics
                  </h3>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div className="rounded-[10px] border border-[#bedbff] bg-[#eff6ff] px-[17px] py-4 text-center">
                    <p className="text-[24px] font-bold leading-8 tracking-[0.0703px] text-[#1447e6]">
                      {data.totalRecipients}
                    </p>
                    <p className="text-[12px] leading-4 text-[#155dfc]">Total Recipients</p>
                  </div>
                  <div className="rounded-[10px] border border-[#b9f8cf] bg-[#f0fdf4] px-[17px] py-4 text-center">
                    <p className="text-[24px] font-bold leading-8 tracking-[0.0703px] text-[#008236]">
                      {data.delivered}
                    </p>
                    <p className="text-[12px] leading-4 text-[#00a63e]">✅ Delivered</p>
                  </div>
                  <div className="rounded-[10px] border border-[#ffc9c9] bg-[#fef2f2] px-[17px] py-4 text-center">
                    <p className="text-[24px] font-bold leading-8 tracking-[0.0703px] text-[#c10007]">{data.failed}</p>
                    <p className="text-[12px] leading-4 text-[#e7000b]">❌ Failed</p>
                  </div>
                </div>
                <div className="mt-4 space-y-2">
                  <div className="flex items-center justify-between text-[14px] leading-5">
                    <span className="tracking-[-0.1504px] text-[#364153]">Delivery Success Rate</span>
                    <span className="font-semibold tracking-[-0.1504px] text-[#101828]">{pct}%</span>
                  </div>
                  <div className="h-3 w-full overflow-hidden rounded-full bg-[#e5e7eb]">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-[#00c950] to-[#00a63e]"
                      style={{ width: `${Math.min(100, pct)}%` }}
                    />
                  </div>
                </div>
              </section>

              {data.failedDeliveries.length > 0 ? (
                <section>
                  <div className="mb-3 flex items-center gap-2">
                    <svg className="size-4 text-[#e7000b]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
                      <circle cx="12" cy="12" r="10" />
                      <path d="M12 8v4M12 16h.01" strokeLinecap="round" />
                    </svg>
                    <h3 className="text-[14px] font-semibold leading-5 tracking-[-0.1504px] text-[#101828]">
                      Failed Deliveries
                    </h3>
                  </div>
                  <div className="space-y-2">
                    {data.failedDeliveries.map((f) => (
                      <div
                        key={`${f.unit}-${f.name}`}
                        className="rounded-[10px] border border-[#ffc9c9] bg-[#fef2f2] px-[13px] py-3"
                      >
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div className="min-w-0">
                            <p className="text-[14px] font-medium leading-5 tracking-[-0.1504px] text-[#82181a]">
                              <span>{f.unit}</span>
                              <span className="mx-2 text-[12px] text-[#c10007]">•</span>
                              <span className="font-normal text-[#9f0712]">{f.name}</span>
                            </p>
                            <p className="mt-1 text-[12px] leading-4 text-[#c10007]">
                              <span className="font-medium">Reason:</span>
                              <span className="font-normal"> {f.reason}</span>
                            </p>
                          </div>
                          <button
                            type="button"
                            className="inline-flex h-8 shrink-0 items-center justify-center rounded-lg border border-black/10 bg-white px-3 text-[14px] font-medium tracking-[-0.1504px] text-[#e7000b] outline-none hover:bg-white focus-visible:ring-2 focus-visible:ring-[#944c73] focus-visible:ring-offset-2"
                          >
                            Resend
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                  <button
                    type="button"
                    className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-[#e7000b] px-4 py-2 text-[14px] font-medium tracking-[-0.1504px] text-white outline-none hover:bg-[#c10007] focus-visible:ring-2 focus-visible:ring-[#944c73] focus-visible:ring-offset-2"
                  >
                    <svg className="size-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
                      <path d="M21 12a9 9 0 00-9-9 9.75 9.75 0 00-6.74 2.74L3 8" strokeLinecap="round" />
                      <path d="M3 3v5h5M3 12a9 9 0 009 9 9.75 9.75 0 006.74-2.74L21 16" strokeLinecap="round" />
                      <path d="M21 21v-5h-5" strokeLinecap="round" />
                    </svg>
                    Resend to All Failed Recipients
                  </button>
                </section>
              ) : null}
            </div>

            <aside className="w-full shrink-0 space-y-4 lg:w-[262px]">
              <div
                className="rounded-[10px] border border-[#bedbff] px-[17px] py-4"
                style={{ backgroundImage: 'linear-gradient(156deg, #eff6ff 0%, #faf5ff 100%)' }}
              >
                <div className="mb-3 flex items-center gap-2">
                  <svg className="size-4 text-[#1c398e]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
                    <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 01-3.46 0" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  <h3 className="text-[14px] font-semibold leading-5 tracking-[-0.1504px] text-[#1c398e]">
                    Channels Used
                  </h3>
                </div>
                <ul className="space-y-2">
                  {data.channels.map((ch) => (
                    <li key={ch} className="flex items-center gap-2 text-[14px] leading-5 tracking-[-0.1504px] text-[#1c398e]">
                      <span className="size-2 shrink-0 rounded-full bg-[#2b7fff]" aria-hidden />
                      {ch}
                    </li>
                  ))}
                </ul>
              </div>
            </aside>
          </div>
        </div>

        <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-[#e5e7eb] bg-[#f9fafb] px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 items-center justify-center rounded-lg border border-black/10 bg-white px-[17px] text-[14px] font-medium tracking-[-0.1504px] text-[#0a0a0a] outline-none hover:bg-[#f3f4f6] focus-visible:ring-2 focus-visible:ring-[#944c73] focus-visible:ring-offset-2"
          >
            Close
          </button>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-black/10 bg-white px-3 text-[14px] font-medium tracking-[-0.1504px] text-[#0a0a0a] outline-none hover:bg-[#f3f4f6] focus-visible:ring-2 focus-visible:ring-[#944c73] focus-visible:ring-offset-2"
            >
              <svg className="size-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Export Report
            </button>
            <button
              type="button"
              className="inline-flex h-9 items-center justify-center rounded-lg bg-[#155dfc] px-4 text-[14px] font-medium tracking-[-0.1504px] text-white outline-none hover:bg-[#1249d6] focus-visible:ring-2 focus-visible:ring-[#944c73] focus-visible:ring-offset-2"
            >
              Resend
            </button>
          </div>
        </footer>
      </div>
    </div>
  )
}
