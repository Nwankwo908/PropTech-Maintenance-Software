import { useEffect, useId, useState } from 'react'

type AltChannelId = 'email' | 'in_app' | 'push' | 'phone'

const FAILED_RETRY_RECIPIENTS = [
  {
    id: 'r1',
    title: 'Unit 3A - Sarah Martinez',
    failureLine: 'SMS Failed: Invalid phone number',
    availabilityLine: '✓ Email available: sarah.m@email.com',
  },
  {
    id: 'r2',
    title: 'Unit 8B - David Thompson',
    failureLine: 'SMS Failed: Phone number disconnected',
    availabilityLine: '✓ Email available: david.t@email.com',
  },
  {
    id: 'r3',
    title: 'Unit 12C - Emily Rodriguez',
    failureLine: 'SMS Failed: Invalid phone number',
    availabilityLine: '✓ Email & In-App available',
  },
] as const

const ALT_CHANNELS: {
  id: AltChannelId
  emoji: string
  title: string
  description: string
  recommended?: boolean
}[] = [
  {
    id: 'email',
    emoji: '📧',
    title: 'Email',
    description: 'All 3 recipients available',
    recommended: true,
  },
  { id: 'in_app', emoji: '📱', title: 'In-App', description: '3 recipients available' },
  { id: 'push', emoji: '🔔', title: 'Push', description: '2 recipients available' },
  {
    id: 'phone',
    emoji: '📞',
    title: 'Phone Call',
    description: 'Automated voice message',
  },
]

function ChannelCheckbox({ checked }: { checked: boolean }) {
  return (
    <span
      className={[
        'flex size-5 shrink-0 items-center justify-center rounded border-2',
        checked ? 'border-[#155dfc] bg-[#155dfc]' : 'border-[#d1d5dc] bg-white',
      ].join(' ')}
      aria-hidden
    >
      {checked ? (
        <svg className="size-3 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} aria-hidden>
          <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : null}
    </span>
  )
}

function RecipientPersonGlyph({ className = 'size-5 text-[#c10007]' }: { className?: string }) {
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

function SendRetryGlyph({ className = 'size-4 shrink-0 text-white' }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M21 12a9 9 0 00-9-9 9.75 9.75 0 00-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
      <path d="M3 12a9 9 0 009 9 9.75 9.75 0 006.74-2.74L21 16" />
      <path d="M16 21h5v-5" />
    </svg>
  )
}

export type RetryFailedDeliveryPresentation = 'modal' | 'rail'

/** Retry failed SMS via alternative channel (Figma 88:12912). */
export function RetryFailedDeliveryModal({
  open,
  onClose,
  presentation = 'modal',
}: {
  open: boolean
  onClose: () => void
  presentation?: RetryFailedDeliveryPresentation
}) {
  const titleId = useId()
  const [channel, setChannel] = useState<AltChannelId>('email')

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
    if (open) setChannel('email')
  }

  if (!open) return null

  const isRail = presentation === 'rail'

  const notifyViaLine =
    channel === 'email'
      ? '1 alternative channel'
      : ALT_CHANNELS.find((c) => c.id === channel)?.title ?? 'alternative channel'

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
            ? 'relative flex h-full max-h-dvh w-full max-w-[min(100vw,657px)] flex-col overflow-hidden border-l border-[#e5e7eb] bg-white shadow-[inset_1px_0_0_0_#e5e7eb]'
            : 'relative flex max-h-[min(92dvh,900px)] w-full max-w-[657px] flex-col overflow-hidden rounded-[10px] bg-white shadow-[0px_20px_25px_-5px_rgba(0,0,0,0.1),0px_8px_10px_-6px_rgba(0,0,0,0.1)]'
        }
      >
        <header className="flex shrink-0 items-center justify-between gap-4 border-b border-[#e5e7eb] px-6 py-5">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-[10px] bg-[#ffe2e2] text-[#c10007]">
              <svg className="size-5" viewBox="0 0 24 24" fill="none" aria-hidden>
                <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth={1.8} />
                <path d="M12 8v5M12 16h.01" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" />
              </svg>
            </div>
            <div className="min-w-0">
              <h2 id={titleId} className="text-[18px] font-semibold leading-7 tracking-[-0.4395px] text-[#0a0a0a]">
                Retry Failed Delivery
              </h2>
              <p className="text-[12px] leading-4 text-[#6a7282]">
                Send emergency elevator notice via alternative channel
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded-lg p-1 text-[#6a7282] outline-none hover:bg-black/5 hover:text-[#0a0a0a] focus-visible:ring-2 focus-visible:ring-[#944c73] focus-visible:ring-offset-2"
          >
            <svg className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
              <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
            </svg>
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
          <div className="flex flex-col gap-6">
            <section>
              <h3 className="mb-3 text-[14px] font-medium leading-5 tracking-[-0.1504px] text-[#364153]">
                Failed Recipients (3)
              </h3>
              <div className="flex flex-col gap-3 rounded-[10px] border border-[#ffc9c9] bg-[#fef2f2] p-[17px]">
                {FAILED_RETRY_RECIPIENTS.map((r) => (
                  <div
                    key={r.id}
                    className="flex items-center gap-3 rounded-[10px] border border-[#ffc9c9] bg-white py-3 pl-[13px] pr-4"
                  >
                    <div className="flex size-10 shrink-0 items-center justify-center rounded-[10px] bg-[#ffe2e2]">
                      <RecipientPersonGlyph />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[14px] font-semibold leading-5 tracking-[-0.1504px] text-[#101828]">
                        {r.title}
                      </p>
                      <p className="text-[12px] leading-4 text-[#4a5565]">{r.failureLine}</p>
                      <p className="text-[12px] leading-4 text-[#00a63e]">{r.availabilityLine}</p>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section>
              <h3 className="mb-3 text-[14px] font-medium leading-5 tracking-[-0.1504px] text-[#364153]">
                Select Alternative Delivery Channel
              </h3>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {ALT_CHANNELS.map((ch) => {
                  const selected = channel === ch.id
                  return (
                    <button
                      key={ch.id}
                      type="button"
                      onClick={() => setChannel(ch.id)}
                      className={[
                        'flex min-h-[140px] flex-col rounded-[10px] border-2 p-4 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[#155dfc] focus-visible:ring-offset-2',
                        selected ? 'border-[#2b7fff] bg-[#eff6ff]' : 'border-[#e5e7eb] bg-white hover:bg-[#fafafa]',
                      ].join(' ')}
                    >
                      <div className="mb-3 flex items-center gap-2">
                        <ChannelCheckbox checked={selected} />
                        <span className="text-[24px] leading-8" aria-hidden>
                          {ch.emoji}
                        </span>
                      </div>
                      <p className="text-[14px] font-semibold leading-5 tracking-[-0.1504px] text-[#101828]">{ch.title}</p>
                      <p className="mt-1 text-[12px] leading-4 text-[#4a5565]">{ch.description}</p>
                      {ch.recommended ? (
                        <span className="mt-2 inline-flex self-start rounded px-2 py-0.5 text-[12px] font-normal leading-4 bg-[#dcfce7] text-[#008236]">
                          Recommended
                        </span>
                      ) : null}
                    </button>
                  )
                })}
              </div>
            </section>

            <section>
              <h3 className="mb-3 text-[14px] font-medium leading-5 tracking-[-0.1504px] text-[#364153]">
                Message to Resend
              </h3>
              <div className="overflow-hidden rounded-[10px] border border-[#d1d5dc] bg-[#f9fafb]">
                <div className="flex items-start gap-2 border-b border-[#fff085] bg-[#fefce8] px-4 py-2">
                  <svg className="mt-0.5 size-4 shrink-0 text-[#ca8a04]" viewBox="0 0 24 24" fill="none" aria-hidden>
                    <path
                      d="M12 9v4M12 17h.01M10.3 4.8 2.2 16A2 2 0 004 17.8h16a2 2 0 001.8-1.8l-8.1-12a2 2 0 00-3.4 0z"
                      stroke="currentColor"
                      strokeWidth={1.8}
                      strokeLinecap="round"
                    />
                  </svg>
                  <p className="text-[12px] font-semibold leading-4 text-[#733e0a]">
                    Emergency Notice: Elevator Out of Service
                  </p>
                </div>
                <div className="space-y-3 px-4 py-4 text-[14px] leading-[22.75px] tracking-[-0.1504px] text-[#364153]">
                  <p className="font-bold">IMPORTANT NOTICE</p>
                  <p>
                    The main elevator is temporarily out of service due to an emergency repair. Technicians are
                    working to resolve the issue.
                  </p>
                  <p>
                    <span className="font-bold">Affected:</span>
                    <span className="font-normal"> Main elevator (Building A)</span>
                  </p>
                  <p>
                    <span className="font-bold">Expected Fix:</span>
                    <span className="font-normal"> Within 24 hours</span>
                  </p>
                  <p>
                    <span className="font-bold">Alternative:</span>
                    <span className="font-normal"> Please use the service elevator or stairs</span>
                  </p>
                  <p className="font-normal">
                    We apologize for any inconvenience. Updates will be provided as available.
                  </p>
                </div>
              </div>
            </section>

            <div className="rounded-[10px] border-l-4 border-[#2b7fff] bg-[#eff6ff] py-4 pl-5 pr-4">
              <div className="flex gap-3">
                <svg className="mt-0.5 size-5 shrink-0 text-[#1447e6]" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth={1.8} />
                  <path d="M8 12.5l2.5 2.5 5-5" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" />
                </svg>
                <div>
                  <p className="text-[14px] font-semibold leading-5 tracking-[-0.1504px] text-[#1c398e]">
                    Retry Information
                  </p>
                  <ul className="mt-2 flex flex-col gap-1 text-[12px] leading-4 text-[#1447e6]">
                    <li>• 3 residents will be notified via {notifyViaLine}</li>
                    <li>• Estimated delivery: Immediate</li>
                    <li>• Original SMS failures will be logged</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </div>

        <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-[#e5e7eb] bg-[#f9fafb] px-6 py-4">
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
            className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-[#e7000b] px-4 text-[14px] font-medium tracking-[-0.1504px] text-white outline-none hover:bg-[#c10007] focus-visible:ring-2 focus-visible:ring-[#944c73] focus-visible:ring-offset-2"
          >
            <SendRetryGlyph />
            Send via Alternative Channel
          </button>
        </footer>
      </div>
    </div>
  )
}
