import { useEffect, useId, useState } from 'react'
import {
  ADMIN_RIGHT_RAIL_OVERLAY_HOST,
  ADMIN_RIGHT_RAIL_SCRIM,
  adminRightRailPanelClass,
} from '@/lib/adminRightRail'
import {
  formatQuoteBadge,
  type VendorNegotiationBrief,
} from '@/lib/vendorNegotiationBrief'
import { formatEmergencyCurrency } from '@/lib/emergencyApprovalReview'

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

function TrendDownIcon() {
  return (
    <svg className="size-3.5 shrink-0 text-[#008236]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path d="M3 7l6 6 4-4 8 8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M15 17h6v-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function SendIcon() {
  return (
    <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden>
      <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

type MessageVendorRailProps = {
  open: boolean
  brief: VendorNegotiationBrief | null
  onClose: () => void
  onSend?: (ticketId: string, message: string) => void
  sending?: boolean
}

/** Vendor negotiation chat rail (Figma property detail — Message Vendor). */
export function MessageVendorRail({
  open,
  brief,
  onClose,
  onSend,
  sending = false,
}: MessageVendorRailProps) {
  const titleId = useId()
  const [selectedReplyIndex, setSelectedReplyIndex] = useState(0)
  const [draft, setDraft] = useState('')

  useEffect(() => {
    if (!open) return
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  useEffect(() => {
    if (!open || !brief) return
    setSelectedReplyIndex(0)
    setDraft(brief.suggestedReplies[0] ?? '')
  }, [open, brief])

  if (!open || !brief) return null

  function handleSelectReply(index: number) {
    setSelectedReplyIndex(index)
    setDraft(brief!.suggestedReplies[index] ?? '')
  }

  function handleSend() {
    const message = draft.trim()
    if (!message || !brief) return
    onSend?.(brief.ticketId, message)
  }

  return (
    <div className={ADMIN_RIGHT_RAIL_OVERLAY_HOST}>
      <div role="presentation" className={ADMIN_RIGHT_RAIL_SCRIM} aria-hidden onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={adminRightRailPanelClass(undefined)}
      >
        <header className="shrink-0 border-b border-[#e5e7eb] px-5 py-4">
          <div className="flex items-start gap-3 pr-8">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[#101828] text-[13px] font-semibold text-white">
              {brief.vendorInitials}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 id={titleId} className="text-[16px] font-semibold leading-6 text-[#0a0a0a]">
                  {brief.vendorName}
                </h2>
                <span className="rounded-full bg-[#fff4f0] px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-[#b52a00]">
                  Quote {formatQuoteBadge(brief.quoteAmount)}
                </span>
              </div>
              <p className="mt-0.5 text-[12px] leading-4 text-[#6a7282]">{brief.contextLine}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="absolute right-4 top-4 rounded-lg p-1 text-[#9ca3af] outline-none hover:bg-black/5 hover:text-[#364153] focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-2"
          >
            <CloseIcon />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">
          <div className="flex items-center gap-1.5">
            <SparkleIcon />
            <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#7c3aed]">
              Ulo AI · Negotiation brief
            </p>
          </div>

          <div className="mt-3 grid grid-cols-3 gap-2">
            <div className="rounded-[8px] border border-[#e5e7eb] bg-white px-3 py-2.5">
              <p className="text-[10px] leading-4 text-[#9ca3af]">Market median</p>
              <p className="mt-1 text-[15px] font-semibold tabular-nums text-[#0a0a0a]">
                {formatEmergencyCurrency(brief.marketMedian)}
              </p>
            </div>
            <div className="rounded-[8px] border border-[#e5e7eb] bg-white px-3 py-2.5">
              <p className="text-[10px] leading-4 text-[#9ca3af]">Your target</p>
              <p className="mt-1 text-[15px] font-semibold tabular-nums text-[#008236]">
                {formatEmergencyCurrency(brief.targetPrice)}
              </p>
            </div>
            <div className="rounded-[8px] border border-[#e5e7eb] bg-white px-3 py-2.5">
              <p className="text-[10px] leading-4 text-[#9ca3af]">Walk-away</p>
              <p className="mt-1 text-[15px] font-semibold tabular-nums text-[#0a0a0a]">
                {formatEmergencyCurrency(brief.walkAwayPrice)}
              </p>
            </div>
          </div>

          <p className="mt-3 flex items-start gap-1.5 text-[12px] leading-4 text-[#6a7282]">
            <TrendDownIcon />
            <span>{brief.leverageSummary}</span>
          </p>

          <div className="mt-5 space-y-4">
            {brief.messages.map((message) =>
              message.sender === 'vendor' ? (
                <div key={message.id} className="flex items-start gap-2">
                  <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[#101828] text-[10px] font-semibold text-white">
                    {brief.vendorInitials}
                  </div>
                  <div className="min-w-0 max-w-[85%]">
                    <div className="rounded-[10px] rounded-tl-sm bg-[#f3f4f6] px-3 py-2.5 text-[13px] leading-5 text-[#364153]">
                      {message.body}
                    </div>
                    <p className="mt-1 text-[11px] text-[#9ca3af]">{message.timeLabel}</p>
                  </div>
                </div>
              ) : (
                <div key={message.id} className="flex items-start gap-2">
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
              ),
            )}
          </div>
        </div>

        <footer className="shrink-0 border-t border-[#e5e7eb] px-5 py-4">
          <div className="flex items-center gap-1.5">
            <SparkleIcon className="size-3 text-[#7c3aed]" />
            <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#9ca3af]">
              Suggested replies
            </p>
          </div>
          <div className="mt-2 flex flex-col gap-2">
            {brief.suggestedReplies.map((reply, index) => (
              <button
                key={reply}
                type="button"
                onClick={() => handleSelectReply(index)}
                className={[
                  'rounded-full border px-3 py-2 text-left text-[12px] leading-4 transition-colors',
                  selectedReplyIndex === index
                    ? 'border-[#d1d5dc] bg-[#f9fafb] text-[#364153]'
                    : 'border-[#e9d5ff] bg-white text-[#6b21a8] hover:bg-[#faf5ff]',
                ].join(' ')}
              >
                {reply}
              </button>
            ))}
          </div>

          <div className="mt-3 flex items-end gap-2">
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              rows={2}
              placeholder="Type your counter-offer…"
              className="min-h-[44px] flex-1 resize-none rounded-[10px] border border-[#e5e7eb] bg-white px-3 py-2.5 text-[13px] leading-5 text-[#0a0a0a] outline-none placeholder:text-[#9ca3af] focus:border-[#d1d5dc] focus:ring-1 focus:ring-[#d1d5dc]"
            />
            <button
              type="button"
              disabled={sending || !draft.trim()}
              onClick={handleSend}
              className="inline-flex h-[44px] shrink-0 items-center gap-1.5 rounded-[10px] bg-[#101828] px-4 text-[13px] font-medium text-white outline-none hover:bg-[#1e2939] focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
            >
              <SendIcon />
              {sending ? 'Sending…' : 'Send'}
            </button>
          </div>
        </footer>
      </div>
    </div>
  )
}

export default MessageVendorRail
