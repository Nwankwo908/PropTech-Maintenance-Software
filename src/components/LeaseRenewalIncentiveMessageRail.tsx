import { useEffect, useId, useRef, useState } from 'react'
import sendIcon from '@/assets/noun-send.png'
import {
  ADMIN_RIGHT_RAIL_OVERLAY_HOST,
  ADMIN_RIGHT_RAIL_SCRIM,
  adminRightRailPanelClass,
  type AdminRightRailStackedPosition,
} from '@/lib/adminRightRail'
import type {
  LeaseRenewalIncentiveBrief,
  LeaseRenewalIncentiveChatMessage,
} from '@/lib/leaseRenewalIncentiveMessaging'

function CloseIcon() {
  return (
    <svg className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
    </svg>
  )
}

function SparkleIcon({ className = 'size-3.5 text-[#7c3aed]' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 2l1.2 4.2L17.5 8 13.2 9.2 12 13.5 10.8 9.2 6.5 8l4.3-1.8L12 2zm7 9 1 3.5L23.5 16l-3.5 1-1 3.5-1-3.5-3.5-1 3.5-1 1-3.5zm-14 0 1 3.5L9.5 16l-3.5 1-1 3.5-1-3.5L.5 16l3.5-1 1-3.5z" />
    </svg>
  )
}

function SuggestedMessagesChevron({ expanded }: { expanded: boolean }) {
  return (
    <svg
      className={`size-3.5 shrink-0 text-[#9ca3af] transition-transform ${expanded ? 'rotate-180' : ''}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden
    >
      <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function UloSuggestions({
  messages,
  selectedMessage,
  onSelect,
}: {
  messages: string[]
  selectedMessage?: string
  onSelect?: (message: string) => void
}) {
  const [expanded, setExpanded] = useState(true)
  const messagesKey = messages.join('\u0000')

  useEffect(() => {
    setExpanded(true)
  }, [messagesKey])

  if (!messages.length) return null

  const selectedInList = selectedMessage
    ? messages.some((message) => message === selectedMessage)
    : false

  function handleSelect(message: string) {
    onSelect?.(message)
    setExpanded(false)
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => setExpanded((open) => !open)}
        className="flex w-full items-center justify-between gap-2 rounded-[8px] outline-none hover:text-[#4b5563] focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-2"
        aria-expanded={expanded}
      >
        <span className="flex min-w-0 items-center gap-1.5">
          <SparkleIcon className="size-3 text-[#7c3aed]" />
          <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#9ca3af]">
            Ulo suggestion
          </span>
          {!expanded ? (
            <span className="truncate text-[10px] font-medium normal-case tracking-normal text-[#6a7282]">
              · {messages.length} option{messages.length === 1 ? '' : 's'}
            </span>
          ) : null}
        </span>
        <SuggestedMessagesChevron expanded={expanded} />
      </button>

      {!expanded && selectedInList && selectedMessage ? (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="w-full rounded-[10px] border border-[#7c3aed] bg-[#ede9fe] px-3 py-2 text-left text-[12px] leading-5 text-[#5b21b6] outline-none hover:bg-[#f3e8ff] focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-2"
        >
          {selectedMessage}
        </button>
      ) : null}

      {expanded ? (
        <ul className="flex flex-col gap-2">
          {messages.map((message) => {
            const selected = selectedMessage === message
            return (
              <li key={message}>
                <button
                  type="button"
                  onClick={() => handleSelect(message)}
                  disabled={!onSelect}
                  className={`w-full rounded-[10px] border px-3 py-2 text-left text-[12px] leading-5 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-2 disabled:cursor-default ${
                    selected
                      ? 'border-[#7c3aed] bg-[#ede9fe] text-[#5b21b6] ring-1 ring-[#7c3aed]/30'
                      : 'border-[#e9d5ff] bg-[#faf5ff] text-[#6b21a8] hover:bg-[#f3e8ff] disabled:hover:bg-[#faf5ff]'
                  }`}
                >
                  {message}
                </button>
              </li>
            )
          })}
        </ul>
      ) : null}
    </div>
  )
}

function ThreadMessage({
  message,
  residentInitials,
}: {
  message: LeaseRenewalIncentiveChatMessage
  residentInitials: string
}) {
  if (message.sender === 'landlord') {
    return (
      <div className="flex justify-end">
        <div className="min-w-0 max-w-[85%]">
          <div className="rounded-[10px] rounded-tr-sm bg-[#101828] px-3 py-2.5 text-[13px] leading-5 text-white">
            {message.body}
          </div>
          <p className="mt-1 text-right text-[11px] text-[#9ca3af]">You · {message.timeLabel}</p>
        </div>
      </div>
    )
  }

  if (message.sender === 'ulo') {
    return (
      <div className="flex items-start gap-2">
        <SparkleIcon className="mt-1 size-4 shrink-0 text-[#7c3aed]" />
        <div className="min-w-0 max-w-[90%]">
          <div className="rounded-[10px] border border-[#ddd6fe] bg-[#f5f3ff] px-3 py-2.5">
            {message.aiLabel ? (
              <p className="text-[10px] font-semibold uppercase tracking-[0.06em] text-[#7c3aed]">
                {message.aiLabel}
              </p>
            ) : null}
            <p className="mt-1 text-[13px] leading-5 text-[#4c1d95]">{message.body}</p>
          </div>
          <p className="mt-1 text-[11px] text-[#9ca3af]">{message.timeLabel}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex items-start gap-2">
      <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[#101828] text-[10px] font-semibold text-white">
        {residentInitials}
      </div>
      <div className="min-w-0 max-w-[85%]">
        <div className="rounded-[10px] rounded-tl-sm bg-[#f3f4f6] px-3 py-2.5 text-[13px] leading-5 text-[#364153]">
          {message.body}
        </div>
        <p className="mt-1 text-[11px] text-[#9ca3af]">{message.timeLabel}</p>
      </div>
    </div>
  )
}

type LeaseRenewalIncentiveMessageRailProps = {
  open: boolean
  brief: LeaseRenewalIncentiveBrief | null
  onClose: () => void
  onSend?: (brief: LeaseRenewalIncentiveBrief, message: string) => void | Promise<void>
  sending?: boolean
  sendError?: string | null
  /** Render panel only (parent owns overlay) for side-by-side stacking. */
  panelOnly?: boolean
  stackedPosition?: AdminRightRailStackedPosition
}

/** Lease renewal incentive SMS draft rail — opened from Offer renewal incentive. */
export function LeaseRenewalIncentiveMessageRail({
  open,
  brief,
  onClose,
  onSend,
  sending = false,
  sendError = null,
  panelOnly = false,
  stackedPosition,
}: LeaseRenewalIncentiveMessageRailProps) {
  const titleId = useId()
  const [draft, setDraft] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const threadEndRef = useRef<HTMLDivElement>(null)
  const hasSentMessages = (brief?.messages.length ?? 0) > 0

  useEffect(() => {
    if (!open || panelOnly) return
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape' && !sending) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose, sending, panelOnly])

  useEffect(() => {
    if (!open || !brief) return
    if (brief.messages.length > 0) {
      setDraft('')
      return
    }
    setDraft(brief.uloSuggestions[0] ?? '')
  }, [open, brief])

  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = '0px'
    el.style.height = `${Math.max(el.scrollHeight, 40)}px`
  }, [draft, open, hasSentMessages])

  useEffect(() => {
    if (!open || !hasSentMessages) return
    threadEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [open, hasSentMessages, brief?.messages.length])

  if (!open || !brief) return null

  function handleSend() {
    const message = draft.trim()
    if (!message || !brief || sending) return
    void onSend?.(brief, message)
  }

  const panel = (
    <div
      role="dialog"
      aria-modal={panelOnly ? undefined : true}
      aria-labelledby={titleId}
      className={adminRightRailPanelClass(stackedPosition)}
    >
      <header className="shrink-0 border-b border-[#e5e7eb] px-5 py-4">
        <div className="flex items-start gap-3 pr-8">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[#101828] text-[13px] font-semibold text-white">
            {brief.residentInitials}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 id={titleId} className="text-[16px] font-semibold leading-6 text-[#0a0a0a]">
                {brief.residentName}
              </h2>
              <span className="rounded-full bg-[#ede9fe] px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-[#5b21b6]">
                {brief.incentiveAmountLabel} credit
              </span>
            </div>
            <p className="mt-0.5 text-[12px] leading-4 text-[#6a7282]">{brief.locationLabel}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          disabled={sending}
          aria-label="Close"
          className="absolute right-4 top-4 rounded-lg p-1 text-[#9ca3af] outline-none hover:bg-black/5 hover:text-[#364153] focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-2 disabled:opacity-50"
        >
          <CloseIcon />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">
        {hasSentMessages ? (
          <div className="space-y-4">
            {brief.messages.map((message) => (
              <ThreadMessage
                key={message.id}
                message={message}
                residentInitials={brief.residentInitials}
              />
            ))}
            <div ref={threadEndRef} />
          </div>
        ) : (
          <p className="text-[13px] leading-5 text-[#6a7282]">
            Review Ulo’s draft below, edit if needed, then send the renewal incentive to{' '}
            {brief.residentName}.
          </p>
        )}
      </div>

      <div className="shrink-0 border-t border-[#e5e7eb] px-5 py-4">
        <div className="flex flex-col gap-4 rounded-[12px] border border-[#e5e7eb] bg-[#fafafa] p-4">
          {!hasSentMessages ? (
            <UloSuggestions
              messages={brief.uloSuggestions}
              selectedMessage={draft}
              onSelect={setDraft}
            />
          ) : null}

          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            rows={1}
            placeholder={
              hasSentMessages
                ? 'Send a follow-up…'
                : 'Edit the renewal incentive message…'
            }
            className="w-full resize-none overflow-hidden rounded-[10px] border border-[#e5e7eb] bg-white px-3 py-2.5 text-[13px] leading-5 text-[#0a0a0a] outline-none placeholder:text-[#9ca3af] focus:border-[#d1d5dc] focus:ring-1 focus:ring-[#d1d5dc]"
          />

          <div className="flex items-center justify-between gap-3">
            {hasSentMessages ? (
              <p className="text-[11px] leading-4 text-[#6a7282]">Sent to tenant</p>
            ) : (
              <span />
            )}
            <button
              type="button"
              disabled={sending || !draft.trim()}
              onClick={handleSend}
              aria-label={sending ? 'Sending message' : 'Send message'}
              className="inline-flex size-9 shrink-0 items-center justify-center rounded-[8px] bg-transparent outline-none hover:bg-[#f3f4f6] focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
            >
              {sending ? (
                <span className="text-[11px] font-semibold text-[#101828]">…</span>
              ) : (
                <img src={sendIcon} alt="" aria-hidden className="size-4" />
              )}
            </button>
          </div>
        </div>

        {sendError ? (
          <p className="mt-3 text-[12px] leading-4 text-[#b22430]">{sendError}</p>
        ) : null}
      </div>
    </div>
  )

  if (panelOnly) return panel

  return (
    <div className={ADMIN_RIGHT_RAIL_OVERLAY_HOST}>
      <div
        role="presentation"
        className={ADMIN_RIGHT_RAIL_SCRIM}
        aria-hidden
        onClick={() => {
          if (!sending) onClose()
        }}
      />
      {panel}
    </div>
  )
}

export default LeaseRenewalIncentiveMessageRail
