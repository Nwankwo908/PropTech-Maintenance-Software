import { useEffect, useId, useState } from 'react'

export type FailedRecipientDetail = {
  initials: string
  name: string
  unit: string
  phone: string
  errorTitle: string
  errorDescription: string
  errorVariant: 'warning' | 'blocked' | 'timeout'
}

export type FailedMessageDetailsPayload = {
  subtitleLine: string
  categoryBadge: { label: string; className: string }
  messageTitle: string
  messageBody: string
  delivered: number
  failed: number
  successRatePercent: number
  channels: readonly string[]
  failedRecipients: FailedRecipientDetail[]
}

function ChannelsPanel({ channels }: { channels: readonly string[] }) {
  return (
    <div
      className="rounded-[10px] border border-extended-1 px-[17px] py-4"
      style={{ backgroundImage: 'linear-gradient(156deg, #eff6ff 0%, #faf5ff 100%)' }}
    >
      <div className="mb-3 flex items-center gap-2">
        <svg className="size-4 text-extended-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
          <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 01-3.46 0" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <h3 className="text-[14px] font-semibold leading-5 tracking-[-0.1504px] text-extended-3">Channels Used</h3>
      </div>
      <ul className="space-y-2">
        {channels.map((ch) => (
          <li key={ch} className="flex items-center gap-2 text-[14px] leading-5 tracking-[-0.1504px] text-extended-3">
            <span className="size-2 shrink-0 rounded-full bg-extended-1" aria-hidden />
            {ch}
          </li>
        ))}
      </ul>
    </div>
  )
}

function ErrorIcon({ variant }: { variant: FailedRecipientDetail['errorVariant'] }) {
  const cls = 'size-4 shrink-0 text-error'
  if (variant === 'blocked') {
    return (
      <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
        <circle cx="12" cy="12" r="10" />
        <path d="M4.93 4.93l14.14 14.14" strokeLinecap="round" />
      </svg>
    )
  }
  if (variant === 'timeout') {
    return (
      <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
        <circle cx="12" cy="12" r="10" />
        <path d="M12 6v6l4 2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  }
  return (
    <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path d="M12 9v4M12 17h.01M10.3 4.8 2.2 16A2 2 0 004 17.8h16a2 2 0 001.8-1.8l-8.1-12a2 2 0 00-3.4 0z" strokeLinecap="round" />
    </svg>
  )
}

export function FailedMessageDetailsModal({
  open,
  onClose,
  data,
}: {
  open: boolean
  onClose: () => void
  data: FailedMessageDetailsPayload | null
}) {
  const titleId = useId()
  const [channelEmail, setChannelEmail] = useState(true)
  const [channelSms, setChannelSms] = useState(false)

  const dataKey =
    open && data
      ? `${data.messageTitle}|${data.failed}|${data.delivered}|${data.failedRecipients.length}`
      : ''
  const [prevDataKey, setPrevDataKey] = useState(dataKey)
  if (dataKey !== prevDataKey) {
    setPrevDataKey(dataKey)
    if (dataKey) {
      setChannelEmail(true)
      setChannelSms(false)
    }
  }

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open || !data) return null

  const n = data.failedRecipients.length
  const barPct = Math.min(100, Math.max(0, data.successRatePercent))

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div role="presentation" className="absolute inset-0" aria-hidden onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative flex max-h-[min(94dvh,1200px)] w-full max-w-[1048px] flex-col overflow-hidden rounded-[10px] bg-white shadow-[0px_20px_25px_-5px_rgba(0,0,0,0.1),0px_8px_10px_-6px_rgba(0,0,0,0.1)]"
      >
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-secondary px-6 py-5 pr-[15px]">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-[10px] bg-extended-2">
              <svg className="size-5 text-extended-1" viewBox="0 0 24 24" fill="none" aria-hidden>
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
                  className="text-[18px] font-semibold leading-7 tracking-[-0.4395px] text-extended-3"
                >
                  Message Details
                </h2>
                <span
                  className={`inline-flex rounded px-2 py-1 text-[12px] font-medium leading-4 ${data.categoryBadge.className}`}
                >
                  {data.categoryBadge.label}
                </span>
              </div>
              <p className="mt-1 text-[14px] leading-5 tracking-[-0.1504px] text-neutral">{data.subtitleLine}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded-lg p-1 text-neutral outline-none transition-colors hover:bg-black/5 hover:text-extended-3 focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          >
            <svg className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
              <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
            </svg>
          </button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden lg:flex-row lg:gap-[15px] lg:pr-[15px]">
          <div className="min-h-0 min-w-0 flex-1 overflow-y-auto px-6 pt-6">
            <div className="flex max-w-[757px] flex-col gap-6 pb-6">
              <section>
                <div className="mb-3 flex items-center gap-2">
                  <svg className="size-4 text-neutral" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
                    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                    <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" strokeLinecap="round" />
                  </svg>
                  <h3 className="text-[14px] font-semibold leading-5 tracking-[-0.1504px] text-extended-3">Message Content</h3>
                </div>
                <div className="rounded-[10px] border border-secondary bg-white px-[17px] py-4">
                  <h4 className="text-[16px] font-semibold leading-6 tracking-[-0.3125px] text-extended-3">{data.messageTitle}</h4>
                  <p className="mt-2 text-[14px] leading-5 tracking-[-0.1504px] text-neutral-variant">{data.messageBody}</p>
                </div>
              </section>

              <section>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <div className="rounded-[10px] border border-extended-2 bg-extended-2 px-[17px] py-4">
                    <p className="text-[24px] font-bold leading-8 tracking-[0.0703px] text-extended-3">{data.delivered}</p>
                    <p className="text-[14px] leading-5 tracking-[-0.1504px] text-tertiary">Delivered</p>
                  </div>
                  <div className="rounded-[10px] border border-error bg-error px-[17px] py-4">
                    <p className="text-[24px] font-bold leading-8 tracking-[0.0703px] text-error">{data.failed}</p>
                    <p className="text-[14px] leading-5 tracking-[-0.1504px] text-error">Failed</p>
                  </div>
                  <div className="rounded-[10px] border border-secondary bg-secondary px-[17px] py-4">
                    <p className="text-[24px] font-bold leading-8 tracking-[0.0703px] text-neutral-variant">
                      {data.successRatePercent}%
                    </p>
                    <p className="text-[14px] leading-5 tracking-[-0.1504px] text-neutral-variant">Success Rate</p>
                  </div>
                </div>
                <div className="mt-4 space-y-2">
                  <div className="flex items-center justify-between text-[14px] leading-5">
                    <span className="tracking-[-0.1504px] text-neutral-variant">Delivery Success Rate</span>
                    <span className="font-semibold tracking-[-0.1504px] text-extended-3">{barPct.toFixed(1)}%</span>
                  </div>
                  <div className="h-3 w-full overflow-hidden rounded-full bg-secondary">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-tertiary to-tertiary"
                      style={{ width: `${barPct}%` }}
                    />
                  </div>
                </div>
              </section>

              <section>
                <h3 className="mb-3 text-[16px] font-medium leading-6 tracking-[-0.3125px] text-extended-3">
                  Failed Deliveries ({n})
                </h3>
                <div className="space-y-4">
                  {data.failedRecipients.map((r) => (
                    <div
                      key={`${r.name}-${r.unit}`}
                      className="flex flex-col gap-3 rounded-[10px] border border-error bg-error px-[17px] py-4"
                    >
                      <div className="flex gap-3">
                        <div className="flex size-10 shrink-0 items-center justify-center rounded-[10px] bg-error">
                          <span className="text-[14px] font-semibold leading-5 tracking-[-0.1504px] text-error">
                            {r.initials}
                          </span>
                        </div>
                        <div className="min-w-0">
                          <p className="text-[16px] font-semibold leading-6 tracking-[-0.3125px] text-extended-3">{r.name}</p>
                          <p className="text-[14px] leading-5 tracking-[-0.1504px] text-neutral-variant">{r.unit}</p>
                          <p className="text-[14px] leading-5 tracking-[-0.1504px] text-neutral-variant">
                            <span className="font-medium">Phone:</span>
                            <span className="font-normal"> {r.phone}</span>
                          </p>
                        </div>
                      </div>
                      <div className="rounded border border-error bg-white px-[13px] py-3">
                        <div className="flex gap-2">
                          <ErrorIcon variant={r.errorVariant} />
                          <div>
                            <p className="text-[14px] font-medium leading-5 tracking-[-0.1504px] text-error">
                              {r.errorTitle}
                            </p>
                            <p className="mt-0.5 text-[12px] leading-4 text-error">{r.errorDescription}</p>
                          </div>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-black/10 bg-white pl-2.5 pr-3 text-[12px] font-medium text-extended-3 outline-none hover:bg-secondary focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                        >
                          <svg className="size-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
                            <path d="M21 12a9 9 0 00-9-9 9.75 9.75 0 00-6.74 2.74L3 8" strokeLinecap="round" />
                            <path d="M3 3v5h5M3 12a9 9 0 009 9 9.75 9.75 0 006.74-2.74L21 16" strokeLinecap="round" />
                            <path d="M21 21v-5h-5" strokeLinecap="round" />
                          </svg>
                          Retry SMS
                        </button>
                        <button
                          type="button"
                          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-black/10 bg-white pl-2.5 pr-3 text-[12px] font-medium text-extended-3 outline-none hover:bg-secondary focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                        >
                          <svg className="size-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
                            <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" strokeLinecap="round" />
                            <circle cx="12" cy="7" r="4" strokeLinecap="round" />
                          </svg>
                          Update Contact
                        </button>
                        <button
                          type="button"
                          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-black/10 bg-white px-3 text-[12px] font-medium text-extended-3 outline-none hover:bg-secondary focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                        >
                          <svg className="size-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
                            <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" strokeLinecap="round" />
                            <path d="m22 6-10 7L2 6" strokeLinecap="round" />
                          </svg>
                          Send Email
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              <section className="border-t border-secondary pt-6">
                <p className="mb-3 text-[14px] font-medium tracking-[-0.1504px] text-neutral-variant">
                  Delivery Channel <span className="text-error">*</span>
                </p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label
                    className={[
                      'group block cursor-pointer rounded-[10px] border-2 px-[18px] pb-[10px] pt-[18px] shadow-[0px_1px_2px_0px_rgba(0,0,0,0.05)] outline-none transition-colors focus-within:ring-2 focus-within:ring-primary focus-within:ring-offset-2',
                      channelEmail
                        ? 'border-extended-1 bg-extended-2'
                        : 'border-secondary bg-white',
                    ].join(' ')}
                  >
                    <div className="flex items-center gap-3">
                      <input
                        type="checkbox"
                        checked={channelEmail}
                        onChange={(e) => setChannelEmail(e.target.checked)}
                        className="sr-only"
                        aria-label="Email — Standard delivery"
                      />
                      <span
                        className={[
                          'flex size-4 shrink-0 items-center justify-center rounded border shadow-[0px_1px_2px_0px_rgba(0,0,0,0.05)] transition-[background-color,border-color,box-shadow] duration-150',
                          channelEmail
                            ? 'border-extended-3 bg-extended-3 group-hover:brightness-95'
                            : 'border-black/10 bg-secondary group-hover:border-black/15 group-hover:bg-[#e8eaee] group-hover:shadow-sm',
                        ].join(' ')}
                        aria-hidden
                      >
                        {channelEmail ? (
                          <svg
                            className="size-3.5 text-white"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth={2.5}
                            aria-hidden
                          >
                            <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        ) : null}
                      </span>
                      <div className="min-w-0">
                        <p className="text-[16px] font-medium leading-6 tracking-[-0.3125px] text-extended-3">
                          📧 Email
                        </p>
                        <p className="text-[12px] leading-4 text-neutral">Standard delivery</p>
                      </div>
                    </div>
                  </label>
                  <label
                    className={[
                      'group block cursor-pointer rounded-[10px] border-2 px-[18px] pb-[10px] pt-[18px] shadow-[0px_1px_2px_0px_rgba(0,0,0,0.05)] outline-none transition-colors focus-within:ring-2 focus-within:ring-primary focus-within:ring-offset-2',
                      channelSms
                        ? 'border-extended-1 bg-extended-2'
                        : 'border-secondary bg-white',
                    ].join(' ')}
                  >
                    <div className="flex items-center gap-3">
                      <input
                        type="checkbox"
                        checked={channelSms}
                        onChange={(e) => setChannelSms(e.target.checked)}
                        className="sr-only"
                        aria-label="SMS — Immediate delivery"
                      />
                      <span
                        className={[
                          'flex size-4 shrink-0 items-center justify-center rounded border shadow-[0px_1px_2px_0px_rgba(0,0,0,0.05)] transition-[background-color,border-color,box-shadow] duration-150',
                          channelSms
                            ? 'border-extended-3 bg-extended-3 group-hover:brightness-95'
                            : 'border-black/10 bg-secondary group-hover:border-black/15 group-hover:bg-[#e8eaee] group-hover:shadow-sm',
                        ].join(' ')}
                        aria-hidden
                      >
                        {channelSms ? (
                          <svg
                            className="size-3.5 text-white"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth={2.5}
                            aria-hidden
                          >
                            <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        ) : null}
                      </span>
                      <div className="min-w-0">
                        <p className="text-[16px] font-medium leading-6 tracking-[-0.3125px] text-extended-3">
                          💬 SMS
                        </p>
                        <p className="text-[12px] leading-4 text-neutral">Immediate delivery</p>
                      </div>
                    </div>
                  </label>
                </div>
              </section>
            </div>
          </div>

          <aside className="shrink-0 border-t border-secondary px-6 pb-6 pt-4 lg:w-[262px] lg:border-l lg:border-t-0 lg:border-secondary lg:px-4 lg:pt-6">
            <ChannelsPanel
              channels={data.channels.filter((ch) => !ch.toLowerCase().includes('email'))}
            />
          </aside>
        </div>
      </div>
    </div>
  )
}
