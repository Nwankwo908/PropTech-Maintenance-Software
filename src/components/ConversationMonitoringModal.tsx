import { useEffect, useId, useState } from 'react'
import {
  fetchInboxConversationMonitoring,
  formatMonitoringTime,
  monitoringInitials,
  type ConversationMonitoringDetail,
  type MonitoringTranscriptItem,
} from '@/lib/conversationMonitoring'

function CloseIcon() {
  return (
    <svg className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
    </svg>
  )
}

function ShieldIcon() {
  return (
    <svg className="size-3.5 shrink-0 text-[#9ca3af]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden>
      <path d="M12 3 4 6v6c0 5 3.5 9.5 8 10 4.5-.5 8-5 8-10V6l-8-3Z" strokeLinejoin="round" />
    </svg>
  )
}

function SparkleIcon({ className = 'size-3.5' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 2l1.2 4.2L17.5 8 13.2 9.2 12 13.5 10.8 9.2 6.5 8l4.3-1.8L12 2zm7 9 1 3.5L23.5 16l-3.5 1-1 3.5-1-3.5-3.5-1 3.5-1 1-3.5zm-14 0 1 3.5L9.5 16l-3.5 1-1 3.5-1-3.5L.5 16l3.5-1 1-3.5z" />
    </svg>
  )
}

function UloAvatar({ size = 'md' }: { size?: 'sm' | 'md' }) {
  const dim = size === 'sm' ? 'size-8' : 'size-9'
  const icon = size === 'sm' ? 'size-4' : 'size-[18px]'
  return (
    <span className={`inline-flex ${dim} shrink-0 items-center justify-center rounded-full bg-[#0a0a0a] text-white`}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className={icon} aria-hidden>
        <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3Z" />
      </svg>
    </span>
  )
}

function EyeIcon() {
  return (
    <svg className="size-4 shrink-0 text-[#9ca3af]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

function WrenchIcon() {
  return (
    <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden>
      <path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L4 17l3 3 5.3-5.3a4 4 0 0 0 5.4-5.4l-2.1 2.1-3.3-3.3 2.1-2.1Z" strokeLinejoin="round" />
    </svg>
  )
}

const RISK_STYLES = {
  high: 'border-[#fecaca] bg-[#fff5f5] text-[#c10007]',
  medium: 'border-[#fde68a] bg-[#fffbeb] text-[#a65f00]',
  low: 'border-[#bbf7d0] bg-[#f0fdf4] text-[#008236]',
} as const

type ConversationMonitoringModalProps = {
  open: boolean
  conversationId: string | null
  onClose: () => void
  onTakeOver?: (conversationId: string) => void
}

function ToolActionPill({ label }: { label: string }) {
  return (
    <div className="mb-2 flex justify-start">
      <span className="inline-flex items-center gap-1.5 rounded-full border border-[#ddd6fe] bg-[#faf5ff] px-3 py-1 text-[11px] font-medium leading-4 text-[#7c3aed]">
        <SparkleIcon className="size-3 text-[#7c3aed]" />
        {label}
      </span>
    </div>
  )
}

function TranscriptMessage({
  item,
  tenantInitials,
}: {
  item: Extract<MonitoringTranscriptItem, { type: 'message' }>
  tenantInitials: string
}) {
  const isUlo = item.sender === 'ulo'
  const timeLabel = formatMonitoringTime(item.timestampMs)

  if (isUlo) {
    return (
      <div className="flex gap-2.5">
        <UloAvatar size="sm" />
        <div className="min-w-0 max-w-[85%]">
          <p className="mb-1 text-[11px] leading-4 text-[#6a7282]">
            {item.senderName} · {timeLabel}
          </p>
          <div className="rounded-[12px] rounded-tl-[4px] border border-[#e9d5ff] bg-white px-3.5 py-2.5 text-[13px] leading-5 text-[#0a0a0a]">
            {item.body}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-row-reverse gap-2.5">
      <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-[#dbeafe] text-[12px] font-semibold text-[#1447e6]">
        {tenantInitials}
      </span>
      <div className="min-w-0 max-w-[85%] text-right">
        <p className="mb-1 text-[11px] leading-4 text-[#6a7282]">
          {item.senderName} · {timeLabel}
        </p>
        <div className="rounded-[12px] rounded-tr-[4px] bg-[#dbeafe] px-3.5 py-2.5 text-left text-[13px] leading-5 text-[#0a0a0a]">
          {item.body}
        </div>
      </div>
    </div>
  )
}

export function ConversationMonitoringBody({
  detail,
  titleId,
  onTakeOver,
  embedded = false,
}: {
  detail: ConversationMonitoringDetail
  titleId: string
  onTakeOver?: (conversationId: string) => void
  embedded?: boolean
}) {
  return (
    <>
      {!embedded ? (
        <header className="shrink-0 border-b border-[#e5e7eb] px-6 pb-4 pt-6">
          <div className="flex items-start gap-3 pr-10">
            <UloAvatar />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <h2 id={titleId} className="text-[18px] font-semibold leading-7 tracking-[-0.3px] text-[#0a0a0a]">
                  {detail.title}
                </h2>
                {detail.riskLabel && detail.riskLevel ? (
                  <span
                    className={`shrink-0 rounded-[6px] border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] ${RISK_STYLES[detail.riskLevel]}`}
                  >
                    {detail.riskLabel}
                  </span>
                ) : null}
              </div>
              <p className="mt-1 flex items-center gap-1.5 text-[12px] leading-4 text-[#6a7282]">
                <ShieldIcon />
                {detail.subtitle}
              </p>
            </div>
          </div>
        </header>
      ) : null}

      <div className="shrink-0 border-b border-[#e5e7eb] bg-[#fafafa] px-6 py-4">
        <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-[#7c3aed]">
          <SparkleIcon className="size-3.5 text-[#7c3aed]" />
          Ulo summary for admin
        </p>
        <p className="mt-2 text-[13px] leading-5 text-[#364153]">{detail.summary}</p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-5">
        <div className="flex flex-col gap-5">
          {detail.transcript.map((item, index) => {
            if (item.type === 'tool_action') {
              return <ToolActionPill key={`tool-${index}`} label={item.label} />
            }
            return (
              <TranscriptMessage
                key={`msg-${index}`}
                item={item}
                tenantInitials={monitoringInitials(item.senderName)}
              />
            )
          })}
        </div>
      </div>

      <footer className="flex shrink-0 flex-col gap-3 border-t border-[#e5e7eb] px-6 py-4">
        <p className="flex items-center gap-2 text-[12px] leading-4 text-[#6a7282]">
          <EyeIcon />
          {detail.readOnlyNote}
        </p>
        {detail.canTakeOver ? (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => onTakeOver?.(detail.conversationId)}
              className="inline-flex items-center gap-2 rounded-full border border-[#1447e6] bg-white px-4 py-2 text-[13px] font-medium text-[#1447e6] outline-none hover:bg-[#eff6ff] focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-2"
            >
              <WrenchIcon />
              Take over
            </button>
          </div>
        ) : null}
      </footer>
    </>
  )
}

/** Admin monitoring rail — full Ulo ↔ tenant transcript with summary and controls. */
export function ConversationMonitoringModal({
  open,
  conversationId,
  onClose,
  onTakeOver,
}: ConversationMonitoringModalProps) {
  const titleId = useId()
  const [detail, setDetail] = useState<ConversationMonitoringDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  useEffect(() => {
    if (!open || !conversationId) {
      setDetail(null)
      setError(null)
      return
    }

    let cancelled = false
    setLoading(true)
    setError(null)

    void fetchInboxConversationMonitoring(conversationId).then((result) => {
      if (cancelled) return
      setLoading(false)
      if (!result) {
        setDetail(null)
        setError('Could not load this conversation.')
        return
      }
      setDetail(result)
    })

    return () => {
      cancelled = true
    }
  }, [open, conversationId])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div role="presentation" className="absolute inset-0 bg-black/40" aria-hidden onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative flex h-full max-h-dvh w-full max-w-[min(100vw,560px)] flex-col overflow-hidden rounded-l-[12px] border border-[#e5e7eb] bg-white shadow-[0px_8px_24px_rgba(0,0,0,0.12)]"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-4 top-4 z-10 rounded-lg p-1 text-[#9ca3af] outline-none hover:bg-black/5 hover:text-[#364153] focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-2"
        >
          <CloseIcon />
        </button>

        {loading ? (
          <div className="flex flex-1 items-center justify-center px-6 py-16">
            <p className="text-[13px] text-[#6a7282]">Loading conversation…</p>
          </div>
        ) : error ? (
          <div className="flex flex-1 items-center justify-center px-6 py-16">
            <p className="text-[13px] text-[#c10007]">{error}</p>
          </div>
        ) : detail ? (
          <ConversationMonitoringBody
            detail={detail}
            titleId={titleId}
            onTakeOver={onTakeOver}
          />
        ) : null}
      </div>
    </div>
  )
}
