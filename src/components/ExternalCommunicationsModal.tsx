import { useEffect, useId } from 'react'

type CommItem = {
  id: string
  title: string
  fromLabel: string
  channel: 'email' | 'sms'
  dateLabel: string
  readState: 'unread' | 'read'
  priorityClass: string
  priorityLabel: string
}

const DEMO_ITEMS: CommItem[] = [
  {
    id: '1',
    title: 'Annual Inspection Notice - Building A',
    fromLabel: 'From: City Housing Department',
    channel: 'email',
    dateLabel: '3/25/2026',
    readState: 'unread',
    priorityClass: 'bg-tertiary text-error',
    priorityLabel: 'high',
  },
  {
    id: '2',
    title: 'Fire Safety Compliance Update Required',
    fromLabel: 'From: City Code Enforcement',
    channel: 'sms',
    dateLabel: '3/24/2026',
    readState: 'read',
    priorityClass: 'bg-error text-white',
    priorityLabel: 'urgent',
  },
  {
    id: '3',
    title: 'Scheduled Water Main Maintenance - April 5',
    fromLabel: 'From: Water Department',
    channel: 'email',
    dateLabel: '3/23/2026',
    readState: 'read',
    priorityClass: 'bg-extended-1 text-white',
    priorityLabel: 'medium',
  },
]

function IconClose({ className = 'size-5 text-neutral' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" />
    </svg>
  )
}

function IconMailHeader({ className = 'size-5 text-neutral-variant' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 6h16v12H4V6zm0 0l8 6 8-6"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function IconMailMeta({ className = 'size-3 shrink-0 text-neutral' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 6h16v12H4V6zm0 0l8 6 8-6"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function IconSmsMeta({ className = 'size-3 shrink-0 text-neutral' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8.5z"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function IconCalendarMeta({ className = 'size-3 shrink-0 text-neutral' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="3" y="5" width="18" height="16" rx="2" stroke="currentColor" strokeWidth={1.8} />
      <path d="M3 10h18M8 3v4M16 3v4" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" />
    </svg>
  )
}

/** External communications list (Figma 130:18293). */
export function ExternalCommunicationsModal({
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
        className="relative flex h-full max-h-dvh w-full max-w-[min(100vw,640px)] flex-col overflow-hidden border-l border-secondary bg-white shadow-[inset_1px_0_0_0_#A788964D]"
      >
        <header className="flex h-[81px] shrink-0 items-center justify-between border-b border-secondary px-6">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-[10px] bg-secondary">
              <IconMailHeader />
            </div>
            <div className="min-w-0">
              <h2
                id={titleId}
                className="text-[18px] font-semibold leading-7 tracking-[-0.4395px] text-extended-3"
              >
                External Communications
              </h2>
              <p className="text-[14px] font-normal leading-5 tracking-[-0.1504px] text-neutral">
                City notifications and official correspondence
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

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto px-6 py-6">
          {DEMO_ITEMS.map((item) => (
            <article
              key={item.id}
              className="flex flex-col gap-2 rounded-[10px] border border-secondary px-[17px] pb-[17px] pt-[17px]"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 space-y-1">
                  <h3 className="text-[14px] font-semibold leading-5 tracking-[-0.1504px] text-extended-3">
                    {item.title}
                  </h3>
                  <p className="text-[12px] font-normal leading-4 text-neutral-variant">{item.fromLabel}</p>
                </div>
                <span
                  className={[
                    'shrink-0 rounded px-2 py-1 text-[12px] font-medium leading-4',
                    item.priorityClass,
                  ].join(' ')}
                >
                  {item.priorityLabel}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-4">
                <span className="inline-flex items-center gap-1.5 text-[12px] font-normal leading-4 text-neutral">
                  {item.channel === 'email' ? <IconMailMeta /> : <IconSmsMeta />}
                  {item.channel === 'email' ? 'Email' : 'SMS'}
                </span>
                <span className="inline-flex items-center gap-1.5 text-[12px] font-normal leading-4 text-neutral">
                  <IconCalendarMeta />
                  {item.dateLabel}
                </span>
                <span
                  className={[
                    'text-[12px] font-medium leading-4',
                    item.readState === 'unread' ? 'text-extended-1' : 'text-neutral',
                  ].join(' ')}
                >
                  {item.readState === 'unread' ? 'Unread' : 'Read'}
                </span>
              </div>
            </article>
          ))}
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
