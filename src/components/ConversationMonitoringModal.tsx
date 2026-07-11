import { useCallback, useEffect, useId, useState } from 'react'
import {
  fetchInboxConversationMonitoring,
  formatMonitoringTime,
  monitoringInitials,
  type ConversationMonitoringDetail,
  type MonitoringTranscriptItem,
  type VendorOutreachChannel,
} from '@/lib/conversationMonitoring'
import {
  appendVendorSetupLoggedQuote,
  confirmVendorSetupHourlyRate,
  filterVendorSetupTranscriptByChannel,
  parseVendorSetupConversationId,
  sortVendorSetupMonitoringTranscript,
} from '@/lib/vendorSetupConversation'
import { isVendorPricingConfirmedByAdmin } from '@/lib/vendorPricingConfirmation'
import sendIcon from '@/assets/noun-send.png'
import confirmHourlyRateIcon from '@/assets/noun-checkmark-invoice.png'

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
  /** Stack above assign-vendor rails (default z-50). */
  overlayClassName?: string
}

function SuggestedMessagesChevron({ expanded }: { expanded: boolean }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      aria-hidden
      className={`size-4 shrink-0 text-[#9ca3af] transition-transform duration-150 ${expanded ? 'rotate-180' : ''}`}
    >
      <path d="M5 7.5L10 12.5L15 7.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function VendorSetupSuggestedMessages({
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
            Suggested messages
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

function CheckCircleIcon({ className = 'size-3.5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <circle cx="12" cy="12" r="9" />
      <path d="M8 12.5l2.5 2.5L16 9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function DeliveryEventRow({
  item,
}: {
  item: Extract<MonitoringTranscriptItem, { type: 'delivery_event' }>
}) {
  const [expanded, setExpanded] = useState(false)
  const timeLabel = formatMonitoringTime(item.timestampMs)

  const sections =
    item.channel === 'grouped'
      ? [
          { title: 'SMS', body: item.smsBody },
          { title: 'Email', body: item.emailBody },
        ].filter((section) => section.body?.trim())
      : [{ title: item.channel === 'sms' ? 'SMS' : 'Email', body: item.body }].filter(
          (section) => section.body?.trim(),
        )

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => setExpanded((open) => !open)}
        className="flex w-full items-start gap-2 rounded-[10px] border border-[#e5e7eb] bg-[#f9fafb] px-3 py-2.5 text-left outline-none hover:bg-[#f3f4f6] focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-2"
        aria-expanded={expanded}
      >
        <CheckCircleIcon className="mt-0.5 size-3.5 shrink-0 text-[#008236]" />
        <span className="min-w-0 flex-1">
          <span className="block text-[12px] font-semibold leading-4 text-[#0a0a0a]">{item.label}</span>
          {item.detail ? (
            <span className="mt-0.5 block text-[11px] leading-4 text-[#6a7282]">{item.detail}</span>
          ) : null}
          <span className="mt-1 block text-[10px] leading-4 text-[#9ca3af]">
            {timeLabel}
            {sections.length ? ` · ${expanded ? 'Hide message' : 'View message'}` : null}
          </span>
        </span>
      </button>
      {expanded
        ? sections.map((section) => (
            <div
              key={section.title}
              className="ml-5 rounded-[10px] border border-[#e5e7eb] bg-white px-3.5 py-2.5"
            >
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.06em] text-[#6a7282]">
                {section.title}
              </p>
              <p className="whitespace-pre-wrap text-[12px] leading-5 text-[#364153]">{section.body}</p>
            </div>
          ))
        : null}
    </div>
  )
}

function VendorOutreachChannelToggle({
  value,
  onChange,
}: {
  value: VendorOutreachChannel
  onChange: (value: VendorOutreachChannel) => void
}) {
  return (
    <div
      className="flex rounded-[10px] border border-[#e5e7eb] bg-[#f3f4f6] p-0.5"
      role="tablist"
      aria-label="Vendor outreach channel"
    >
      {(
        [
          { id: 'sms' as const, label: 'SMS' },
          { id: 'email' as const, label: 'Email' },
        ] as const
      ).map((option) => {
        const selected = value === option.id
        return (
          <button
            key={option.id}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(option.id)}
            className={[
              'min-w-[88px] flex-1 rounded-[8px] px-3 py-1.5 text-[12px] font-semibold leading-4 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-1',
              selected
                ? 'bg-white text-[#0a0a0a] shadow-[0px_1px_2px_rgba(0,0,0,0.06)]'
                : 'text-[#6a7282] hover:text-[#364153]',
            ].join(' ')}
          >
            {option.label}
          </button>
        )
      })}
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

function isVendorSetupFollowUpItem(item: MonitoringTranscriptItem): boolean {
  return (
    item.type === 'tool_action' ||
    (item.type === 'message' && item.sender === 'ulo')
  )
}

function TranscriptItemList({
  items,
  keyPrefix,
}: {
  items: MonitoringTranscriptItem[]
  keyPrefix: string
}) {
  if (!items.length) return null

  return (
    <div className="flex flex-col gap-5">
      {items.map((item, index) => {
        if (item.type === 'tool_action') {
          return <ToolActionPill key={`${keyPrefix}-tool-${index}`} label={item.label} />
        }
        if (item.type === 'delivery_event') {
          return <DeliveryEventRow key={`${keyPrefix}-delivery-${index}`} item={item} />
        }
        return (
          <TranscriptMessage
            key={`${keyPrefix}-msg-${index}`}
            item={item}
            tenantInitials={monitoringInitials(item.senderName)}
          />
        )
      })}
    </div>
  )
}

export function ConversationMonitoringBody({
  detail,
  titleId,
  onTakeOver,
  embedded = false,
  showLogQuotedPrice = false,
  quotedPriceInput = '',
  onQuotedPriceInputChange,
  onLogQuotedPrice,
  loggingQuote = false,
  onConfirmHourlyRate,
  confirmingHourlyRate = false,
  hourlyRateConfirmDisabled = false,
  vendorOutreachChannel,
  onVendorOutreachChannelChange,
}: {
  detail: ConversationMonitoringDetail
  titleId: string
  onTakeOver?: (conversationId: string) => void
  embedded?: boolean
  showLogQuotedPrice?: boolean
  quotedPriceInput?: string
  onQuotedPriceInputChange?: (value: string) => void
  onLogQuotedPrice?: () => void
  loggingQuote?: boolean
  onConfirmHourlyRate?: () => void
  confirmingHourlyRate?: boolean
  hourlyRateConfirmDisabled?: boolean
  vendorOutreachChannel?: VendorOutreachChannel
  onVendorOutreachChannelChange?: (channel: VendorOutreachChannel) => void
}) {
  const channelViews = detail.vendorOutreachChannels
  const activeChannel = vendorOutreachChannel ?? 'sms'
  const channelView = channelViews?.[activeChannel]
  const summary = channelView?.summary ?? detail.summary
  const readOnlyNote = channelView?.readOnlyNote ?? detail.readOnlyNote
  const transcript =
    channelViews && vendorOutreachChannel
      ? filterVendorSetupTranscriptByChannel(detail.transcript, vendorOutreachChannel)
      : detail.transcript
  const showChannelToggle = Boolean(channelViews && onVendorOutreachChannelChange)
  const showQuoteLogger = showLogQuotedPrice && activeChannel === 'sms'
  const suggestedMessages = detail.vendorSetupPricing?.suggestedMessages ?? []
  const showNegotiationFooter = showQuoteLogger || suggestedMessages.length > 0
  const threadTranscript = channelViews
    ? transcript.filter((item) => !isVendorSetupFollowUpItem(item))
    : transcript
  const followUpTranscript = channelViews
    ? transcript.filter(isVendorSetupFollowUpItem)
    : []
  // Vendor setup threads scroll as one column (summary → transcript → follow-ups)
  // so nested scroll regions don't stack on top of each other in rails and modals.
  const useUnifiedScroll = embedded || Boolean(channelViews)

  const summaryBlock = (
    <div className={`border-b border-[#e5e7eb] bg-[#fafafa] px-6 py-4 ${embedded ? 'shrink-0' : 'shrink-0'}`}>
      {showChannelToggle ? (
        <div className="mb-4">
          <VendorOutreachChannelToggle
            value={activeChannel}
            onChange={onVendorOutreachChannelChange!}
          />
        </div>
      ) : null}
      <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-[#7c3aed]">
        <SparkleIcon className="size-3.5 text-[#7c3aed]" />
        Ulo summary for admin
      </p>
      <p className="mt-2 text-[13px] leading-5 text-[#364153]">{summary}</p>
    </div>
  )

  const followUpBlock =
    followUpTranscript.length > 0 ? (
      <div className={useUnifiedScroll ? 'px-6 pb-5 pt-4' : 'border-t border-[#e5e7eb] px-6 py-4'}>
        <TranscriptItemList items={followUpTranscript} keyPrefix="follow-up" />
      </div>
    ) : null

  const transcriptBlock = (
    <div className={useUnifiedScroll ? 'px-6 py-5' : 'min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-5'}>
      <TranscriptItemList items={threadTranscript} keyPrefix="thread" />
    </div>
  )

  const scrollableContent = useUnifiedScroll ? (
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
      {summaryBlock}
      {transcriptBlock}
      {followUpBlock}
    </div>
  ) : (
    <>
      {summaryBlock}
      {transcriptBlock}
      {followUpBlock}
    </>
  )

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

      {scrollableContent}

      <footer className="flex shrink-0 flex-col gap-3 border-t border-[#e5e7eb] px-6 py-4">
        {showNegotiationFooter ? (
          <div className="space-y-4 rounded-[12px] border border-[#e5e7eb] bg-[#fafafa] p-4">
            {suggestedMessages.length ? (
              <VendorSetupSuggestedMessages
                messages={suggestedMessages}
                selectedMessage={quotedPriceInput}
                onSelect={
                  onQuotedPriceInputChange
                    ? (message) => onQuotedPriceInputChange(message)
                    : undefined
                }
              />
            ) : null}
            {showQuoteLogger ? (
              <div className="space-y-2">
                <div className="flex h-9 min-w-[200px] items-center gap-1 rounded-[10px] border border-[#e5e7eb] bg-white pl-3 pr-1.5">
                  <input
                    type="text"
                    value={quotedPriceInput}
                    onChange={(event) => onQuotedPriceInputChange?.(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && quotedPriceInput.trim()) {
                        onLogQuotedPrice?.()
                      }
                    }}
                    placeholder="Send a follow-up"
                    className="h-full min-w-0 flex-1 bg-transparent text-[12px] text-[#0a0a0a] outline-none placeholder:text-[#9ca3af]"
                  />
                  {onConfirmHourlyRate ? (
                    <button
                      type="button"
                      disabled={confirmingHourlyRate || hourlyRateConfirmDisabled}
                      onClick={() => onConfirmHourlyRate()}
                      aria-label={
                        hourlyRateConfirmDisabled
                          ? 'Hourly rate already confirmed'
                          : confirmingHourlyRate
                            ? 'Confirming hourly rate'
                            : 'Confirm hourly rate with vendor'
                      }
                      title={
                        hourlyRateConfirmDisabled
                          ? 'Hourly rate already confirmed'
                          : 'Confirm hourly rate with vendor'
                      }
                      className="inline-flex size-7 shrink-0 items-center justify-center rounded-[8px] bg-transparent outline-none hover:bg-[#f0fdf4] focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-40"
                    >
                      {confirmingHourlyRate ? (
                        <span className="text-[11px] font-semibold text-[#101828]">…</span>
                      ) : (
                        <img src={confirmHourlyRateIcon} alt="" aria-hidden className="size-4" />
                      )}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    disabled={loggingQuote || !quotedPriceInput.trim()}
                    onClick={() => onLogQuotedPrice?.()}
                    aria-label={loggingQuote ? 'Sending message' : 'Send message'}
                    className="inline-flex size-7 shrink-0 items-center justify-center rounded-[8px] bg-transparent outline-none hover:bg-[#f3f4f6] focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
                  >
                    {loggingQuote ? (
                      <span className="text-[11px] font-semibold text-[#101828]">…</span>
                    ) : (
                      <img src={sendIcon} alt="" aria-hidden className="size-4" />
                    )}
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
        {readOnlyNote.trim() ? (
          <p className="flex items-center gap-2 text-[12px] leading-4 text-[#6a7282]">
            <EyeIcon />
            {readOnlyNote}
          </p>
        ) : null}
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

type ConversationMonitoringPanelProps = {
  conversationId: string
  onTakeOver?: (conversationId: string) => void
  active?: boolean
  /** Bumps when vendor intake / quotes change so the transcript refetches. */
  refreshKey?: number
  /** Hide duplicate modal header when embedded in another rail (e.g. vendor verification). */
  embedded?: boolean
}

/** Inline conversation monitoring content — used in modals and embedded rails. */
export function ConversationMonitoringPanel({
  conversationId,
  onTakeOver,
  active = true,
  refreshKey = 0,
  embedded = false,
}: ConversationMonitoringPanelProps) {
  const titleId = useId()
  const [detail, setDetail] = useState<ConversationMonitoringDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [quotedPriceInput, setQuotedPriceInput] = useState('')
  const [loggingQuote, setLoggingQuote] = useState(false)
  const [confirmingHourlyRate, setConfirmingHourlyRate] = useState(false)
  const [adminPricingConfirmed, setAdminPricingConfirmed] = useState(false)

  const isVendorSetupThread = parseVendorSetupConversationId(conversationId)
  const [vendorOutreachChannel, setVendorOutreachChannel] = useState<VendorOutreachChannel>('sms')

  useEffect(() => {
    if (!active) {
      setQuotedPriceInput('')
      setLoggingQuote(false)
      setConfirmingHourlyRate(false)
      setVendorOutreachChannel('sms')
    }
  }, [active])

  useEffect(() => {
    if (!active || !conversationId) {
      setAdminPricingConfirmed(false)
      return
    }
    setAdminPricingConfirmed(isVendorPricingConfirmedByAdmin(conversationId))
  }, [active, conversationId, detail, refreshKey])

  useEffect(() => {
    setVendorOutreachChannel('sms')
  }, [conversationId])

  const loadConversation = useCallback(
    async (options: { showLoading?: boolean } = {}) => {
      if (!conversationId) return

      if (options.showLoading) {
        setLoading(true)
        setError(null)
      }

      const result = await fetchInboxConversationMonitoring(conversationId)

      if (options.showLoading) {
        setLoading(false)
      }

      if (!result) {
        if (options.showLoading) {
          setDetail(null)
          setError('Could not load this conversation.')
        }
        return
      }

      setDetail(result)
      setError(null)
    },
    [conversationId],
  )

  useEffect(() => {
    if (!active || !conversationId) {
      setDetail(null)
      setError(null)
      setLoading(false)
      return
    }

    void loadConversation({ showLoading: true })
  }, [active, conversationId, loadConversation])

  useEffect(() => {
    if (!active || !conversationId || refreshKey === 0) return
    void loadConversation({ showLoading: false })
  }, [active, conversationId, refreshKey, loadConversation])

  useEffect(() => {
    if (!active || !conversationId || !isVendorSetupThread) return

    const interval = window.setInterval(() => {
      void loadConversation({ showLoading: false })
    }, 3000)

    return () => window.clearInterval(interval)
  }, [active, conversationId, isVendorSetupThread, loadConversation])

  function handleLogQuotedPrice() {
    const trimmed = quotedPriceInput.trim()
    if (!trimmed) return
    setLoggingQuote(true)
    const sentItem = appendVendorSetupLoggedQuote(conversationId, trimmed)
    setDetail((prev) =>
      prev
        ? {
            ...prev,
            transcript: sortVendorSetupMonitoringTranscript([
              ...prev.transcript,
              sentItem,
            ]),
          }
        : prev,
    )
    setQuotedPriceInput('')
    setLoggingQuote(false)
    void loadConversation({ showLoading: false })
  }

  function handleConfirmHourlyRate() {
    const hourlyDisplay = detail?.vendorSetupPricing?.hourlyDisplay?.trim()
    if (!hourlyDisplay || adminPricingConfirmed) return
    setConfirmingHourlyRate(true)
    const sentItem = confirmVendorSetupHourlyRate(conversationId, hourlyDisplay)
    setAdminPricingConfirmed(true)
    setDetail((prev) =>
      prev
        ? {
            ...prev,
            transcript: sortVendorSetupMonitoringTranscript([
              ...prev.transcript,
              sentItem,
            ]),
          }
        : prev,
    )
    setConfirmingHourlyRate(false)
    void loadConversation({ showLoading: false })
  }

  if (loading && !detail) {
    return (
      <div className="flex flex-1 items-center justify-center px-6 py-16">
        <p className="text-[13px] text-[#6a7282]">Loading conversation…</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-1 items-center justify-center px-6 py-16">
        <p className="text-[13px] text-[#c10007]">{error}</p>
      </div>
    )
  }

  if (!detail) return null

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <ConversationMonitoringBody
        detail={detail}
        titleId={titleId}
        onTakeOver={onTakeOver}
        embedded={embedded}
        showLogQuotedPrice={isVendorSetupThread}
        quotedPriceInput={quotedPriceInput}
        onQuotedPriceInputChange={setQuotedPriceInput}
        onLogQuotedPrice={handleLogQuotedPrice}
        loggingQuote={loggingQuote}
        onConfirmHourlyRate={
          isVendorSetupThread && detail.vendorSetupPricing?.hourlyDisplay
            ? handleConfirmHourlyRate
            : undefined
        }
        confirmingHourlyRate={confirmingHourlyRate}
        hourlyRateConfirmDisabled={adminPricingConfirmed}
        vendorOutreachChannel={isVendorSetupThread ? vendorOutreachChannel : undefined}
        onVendorOutreachChannelChange={
          isVendorSetupThread ? setVendorOutreachChannel : undefined
        }
      />
    </div>
  )
}

/** Admin monitoring rail — full Ulo ↔ tenant transcript with summary and controls. */
export function ConversationMonitoringModal({
  open,
  conversationId,
  onClose,
  onTakeOver,
  overlayClassName = 'z-50',
}: ConversationMonitoringModalProps) {
  useEffect(() => {
    if (!open) return
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open || !conversationId) return null

  return (
    <div className={`fixed inset-0 flex justify-end ${overlayClassName}`}>
      <div role="presentation" className="absolute inset-0 bg-black/40" aria-hidden onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
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

        <ConversationMonitoringPanel
          conversationId={conversationId}
          onTakeOver={onTakeOver}
          active={open}
        />
      </div>
    </div>
  )
}
