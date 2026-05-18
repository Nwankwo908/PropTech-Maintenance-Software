import { useEffect, useId, useState } from 'react'

export type AltChannelId = 'email' | 'sms' | 'in_app' | 'push' | 'phone'

export type RetryFailedRecipient = {
  id: string
  title: string
  failureLine: string
  availabilityLine: string
}

export type RetryFailedDeliveryPayload = {
  subtitleLine: string
  messageTitle: string
  messageBody: string
  failedRecipients: RetryFailedRecipient[]
  availableChannels?: AltChannelId[]
  defaultChannel?: AltChannelId
}

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
  { id: 'sms', emoji: '💬', title: 'SMS', description: 'Retry original SMS delivery' },
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
        checked ? 'border-extended-1 bg-extended-2' : 'border-secondary bg-white',
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

function RecipientPersonGlyph({ className = 'size-5 text-error' }: { className?: string }) {
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
  data = null,
}: {
  open: boolean
  onClose: () => void
  presentation?: RetryFailedDeliveryPresentation
  data?: RetryFailedDeliveryPayload | null
}) {
  const titleId = useId()
  const [channel, setChannel] = useState<AltChannelId>('email')
  const recipients = data?.failedRecipients?.length ? data.failedRecipients : [...FAILED_RETRY_RECIPIENTS]
  const allowedChannelIds = data?.availableChannels?.length
    ? new Set<AltChannelId>(data.availableChannels)
    : null
  const availableChannels = allowedChannelIds
    ? ALT_CHANNELS.filter((ch) => allowedChannelIds.has(ch.id))
    : ALT_CHANNELS

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
    if (open) setChannel(data?.defaultChannel ?? 'email')
  }

  if (!open) return null

  const isRail = presentation === 'rail'

  const notifyViaLine =
    channel === 'email'
      ? `${recipients.length} recipient${recipients.length === 1 ? '' : 's'}`
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
            ? 'relative flex h-full max-h-dvh w-full max-w-[min(100vw,657px)] flex-col overflow-hidden border-l border-secondary bg-white shadow-[inset_1px_0_0_0_#A788964D]'
            : 'relative flex max-h-[min(92dvh,900px)] w-full max-w-[657px] flex-col overflow-hidden rounded-[10px] bg-white shadow-[0px_20px_25px_-5px_rgba(0,0,0,0.1),0px_8px_10px_-6px_rgba(0,0,0,0.1)]'
        }
      >
        <header className="flex shrink-0 items-center justify-between gap-4 border-b border-secondary px-6 py-5">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-[10px] bg-error text-white">
              <svg className="size-5" viewBox="0 0 24 24" fill="none" aria-hidden>
                <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth={1.8} />
                <path d="M12 8v5M12 16h.01" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" />
              </svg>
            </div>
            <div className="min-w-0">
              <h2 id={titleId} className="text-[18px] font-semibold leading-7 tracking-[-0.4395px] text-extended-3">
                Retry Failed Delivery
              </h2>
              <p className="text-[12px] leading-4 text-neutral">
                {data?.subtitleLine ?? 'Send failed notice via alternative channel'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded-lg p-1 text-neutral outline-none hover:bg-black/5 hover:text-extended-3 focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          >
            <svg className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
              <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
            </svg>
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
          <div className="flex flex-col gap-6">
            <section>
              <h3 className="mb-3 text-[14px] font-medium leading-5 tracking-[-0.1504px] text-neutral-variant">
                Failed Recipients ({recipients.length})
              </h3>
              <div className="flex flex-col gap-3 rounded-[10px] border border-error bg-error p-[17px]">
                {recipients.map((r) => (
                  <div
                    key={r.id}
                    className="flex items-center gap-3 rounded-[10px] border border-error bg-white py-3 pl-[13px] pr-4"
                  >
                    <div className="flex size-10 shrink-0 items-center justify-center rounded-[10px] bg-error">
                      <RecipientPersonGlyph />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[14px] font-semibold leading-5 tracking-[-0.1504px] text-extended-3">
                        {r.title}
                      </p>
                      <p className="text-[12px] leading-4 text-neutral-variant">{r.failureLine}</p>
                      <p className="text-[12px] leading-4 text-tertiary">{r.availabilityLine}</p>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section>
              <h3 className="mb-3 text-[14px] font-medium leading-5 tracking-[-0.1504px] text-neutral-variant">
                Select Alternative Delivery Channel
              </h3>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {availableChannels.map((ch) => {
                  const selected = channel === ch.id
                  return (
                    <button
                      key={ch.id}
                      type="button"
                      onClick={() => setChannel(ch.id)}
                      className={[
                        'flex min-h-[140px] flex-col rounded-[10px] border-2 p-4 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-extended-1 focus-visible:ring-offset-2',
                        selected ? 'border-extended-1 bg-extended-2' : 'border-secondary bg-white hover:bg-secondary',
                      ].join(' ')}
                    >
                      <div className="mb-3 flex items-center gap-2">
                        <ChannelCheckbox checked={selected} />
                        <span className="text-[24px] leading-8" aria-hidden>
                          {ch.emoji}
                        </span>
                      </div>
                      <p className="text-[14px] font-semibold leading-5 tracking-[-0.1504px] text-extended-3">{ch.title}</p>
                      <p className="mt-1 text-[12px] leading-4 text-neutral-variant">
                        {ch.id === 'phone'
                          ? 'Automated voice message'
                          : `${recipients.length} recipient${recipients.length === 1 ? '' : 's'} available`}
                      </p>
                      {ch.recommended ? (
                        <span className="mt-2 inline-flex self-start rounded px-2 py-0.5 text-[12px] font-normal leading-4 bg-extended-2 text-extended-3">
                          Recommended
                        </span>
                      ) : null}
                    </button>
                  )
                })}
              </div>
            </section>

            <section>
              <h3 className="mb-3 text-[14px] font-medium leading-5 tracking-[-0.1504px] text-neutral-variant">
                Message to Resend
              </h3>
              <div className="overflow-hidden rounded-[10px] border border-secondary bg-secondary">
                <div className="flex items-start gap-2 border-b border-tertiary bg-tertiary px-4 py-2">
                  <svg className="mt-0.5 size-4 shrink-0 text-tertiary" viewBox="0 0 24 24" fill="none" aria-hidden>
                    <path
                      d="M12 9v4M12 17h.01M10.3 4.8 2.2 16A2 2 0 004 17.8h16a2 2 0 001.8-1.8l-8.1-12a2 2 0 00-3.4 0z"
                      stroke="currentColor"
                      strokeWidth={1.8}
                      strokeLinecap="round"
                    />
                  </svg>
                  <p className="text-[12px] font-semibold leading-4 text-tertiary">
                    Emergency Notice: Elevator Out of Service
                  </p>
                </div>
                <div className="space-y-3 px-4 py-4 text-[14px] leading-[22.75px] tracking-[-0.1504px] text-neutral-variant">
                  <p className="font-bold">{data?.messageTitle ?? 'Message'}</p>
                  <p className="font-normal whitespace-pre-wrap">{data?.messageBody ?? 'No message preview available.'}</p>
                </div>
              </div>
            </section>

            <div className="rounded-[10px] border-l-4 border-extended-1 bg-extended-2 py-4 pl-5 pr-4">
              <div className="flex gap-3">
                <svg className="mt-0.5 size-5 shrink-0 text-extended-1" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth={1.8} />
                  <path d="M8 12.5l2.5 2.5 5-5" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" />
                </svg>
                <div>
                  <p className="text-[14px] font-semibold leading-5 tracking-[-0.1504px] text-extended-3">
                    Retry Information
                  </p>
                  <ul className="mt-2 flex flex-col gap-1 text-[12px] leading-4 text-extended-1">
                    <li>• {recipients.length} recipient{recipients.length === 1 ? '' : 's'} will be notified via {notifyViaLine}</li>
                    <li>• Estimated delivery: Immediate</li>
                    <li>• Original delivery failures will be logged</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </div>

        <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-secondary bg-secondary px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 items-center justify-center rounded-lg border border-black/10 bg-white px-[17px] text-[14px] font-medium tracking-[-0.1504px] text-extended-3 outline-none hover:bg-secondary focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-error px-4 text-[14px] font-medium tracking-[-0.1504px] text-white outline-none hover:bg-error focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          >
            <SendRetryGlyph />
            Send via Alternative Channel
          </button>
        </footer>
      </div>
    </div>
  )
}
