import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { ExternalVendorJobContextDto, ExternalVendorSuggestionDto } from '@/api/discoverExternalVendors'
import {
  postMessageThumbtackVendor,
  resolveMessageThumbtackVendorUrl,
  type ThumbtackVendorThreadDto,
} from '@/api/messageThumbtackVendor'
import { ChatComposerBar } from '@/components/ChatComposerBar'
import { AdminBottomSheet } from '@/components/AdminBottomSheet'
import { getAdminEdgeSecret } from '@/lib/adminEdgeAuth'
import { getErrorMessage } from '@/lib/errorMessage'
import { buildThumbtackVendorOutreachMessage } from '@shared/externalVendor/thumbtackOutreachCopy'
import {
  ADMIN_RAIL_FOOTER_CLASS,
  ADMIN_RAIL_FOOTER_PRIMARY_BUTTON_CLASS,
  ADMIN_RAIL_FOOTER_SECONDARY_BUTTON_CLASS,
  ADMIN_RIGHT_RAIL_STACK_HOST,
  ADMIN_RIGHT_RAIL_SCRIM,
  adminRightRailPanelClass,
  type AdminRightRailStackedPosition,
} from '@/lib/adminRightRail'
import {
  buildExternalSearchQueryLabel,
  enrichExternalVendorSuggestions,
  type ExternalVendorDisplayRow,
} from '@/lib/externalVendorDisplay'
import { PhoneTelLink } from '@/components/CallPhoneButton'
import { vendorInitials } from '@/lib/vendorCallFlow'
import {
  canMessageThumbtackVendor,
  formatThumbtackContactedAt,
  thumbtackContactStatusLabel,
} from '@/lib/thumbtackVendorContact'

function CloseIcon() {
  return (
    <svg className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
    </svg>
  )
}

function ChevronLeftIcon() {
  return (
    <svg className="size-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function SearchIcon() {
  return (
    <svg className="size-[13px] shrink-0 text-[#717182]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" strokeLinecap="round" />
    </svg>
  )
}

function MapPinIcon() {
  return (
    <svg className="size-[10px] shrink-0 text-[#717182]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path d="M12 21s7-4.5 7-11a7 7 0 1 0-14 0c0 6.5 7 11 7 11z" />
      <circle cx="12" cy="10" r="2.5" />
    </svg>
  )
}

function PhoneIcon() {
  return (
    <svg className="size-[10px] shrink-0 text-[#717182]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function GlobeIcon() {
  return (
    <svg className="size-[10px] shrink-0 text-[#717182]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3a15.3 15.3 0 0 1 4 9 15.3 15.3 0 0 1-4 9 15.3 15.3 0 0 1-4-9 15.3 15.3 0 0 1 4-9z" />
    </svg>
  )
}

const ASK_ULO_SURFACE_STYLE = {
  backgroundColor: '#ffffff',
  backgroundImage:
    'conic-gradient(from 45deg at 50% 50%, #ffffff, #f0fdf4, #ffffff, #f0fdf4, #ffffff)',
} as const

type ComposerThreadLine = {
  id: string
  direction: 'outbound' | 'inbound'
  body: string
}

function threadLinesFromVendor(
  vendor: ExternalVendorDisplayRow,
  thread: ThumbtackVendorThreadDto | undefined,
): ComposerThreadLine[] {
  const lines: ComposerThreadLine[] = []
  const outbound = thread?.last_outbound_text?.trim() || ''
  const inbound = thread?.last_inbound_text?.trim() || vendor.lastInboundPreview?.trim() || ''
  if (outbound) {
    lines.push({ id: `out-${thread?.id ?? vendor.providerRef ?? vendor.name}`, direction: 'outbound', body: outbound })
  }
  if (inbound) {
    lines.push({ id: `in-${thread?.id ?? vendor.providerRef ?? vendor.name}`, direction: 'inbound', body: inbound })
  }
  return lines
}

function VendorProfileImage({
  name,
  imageUrl,
  sizeClass = 'size-12',
}: {
  name: string
  imageUrl?: string | null
  sizeClass?: string
}) {
  const [failed, setFailed] = useState(false)
  const src = imageUrl?.trim() || ''
  const shape = `shrink-0 rounded-[10px] ${sizeClass}`
  if (!src || failed) {
    return (
      <div
        className={`flex items-center justify-center bg-[#e8ebf0] text-[12px] font-semibold text-[#364153] ${shape}`}
        aria-hidden
      >
        {vendorInitials(name)}
      </div>
    )
  }
  return (
    <img
      src={src}
      alt=""
      width={48}
      height={48}
      className={`object-cover ${shape}`}
      onError={() => setFailed(true)}
    />
  )
}

function StarRating({ rating }: { rating: number | null }) {
  const value = rating ?? 0
  return (
    <div className="flex items-center gap-1">
      {Array.from({ length: 5 }, (_, i) => {
        const filled = value >= i + 1 - 0.25
        return (
          <svg
            key={i}
            className={`size-[11px] ${filled ? 'text-[#f0b100]' : 'text-[#e5e7eb]'}`}
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-hidden
          >
            <path d="M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 22 12 18.56 5.82 22 7 14.14l-5-4.87 6.91-1.01L12 2z" />
          </svg>
        )
      })}
    </div>
  )
}

function applyThreadToVendor(
  vendor: ExternalVendorDisplayRow,
  thread: ThumbtackVendorThreadDto | undefined,
): ExternalVendorDisplayRow {
  if (!thread) return vendor
  return {
    ...vendor,
    contactStatus: thread.status,
    contactedAt: thread.last_outbound_at,
    lastInboundAt: thread.last_inbound_at,
    lastInboundPreview: thread.last_inbound_text,
  }
}

function VendorResultRow({
  vendor,
  saving,
  enterDelayMs,
  onMessage,
}: {
  vendor: ExternalVendorDisplayRow
  saving: boolean
  enterDelayMs?: number
  onMessage: () => void
}) {
  const distanceLabel =
    vendor.distanceMiles != null
      ? `${vendor.distanceMiles.toFixed(1)} mi · ${vendor.address ?? ''}`
      : vendor.address
  const contactStatus = thumbtackContactStatusLabel(vendor)
  const contactedAtLabel = formatThumbtackContactedAt(vendor.contactedAt)
  const canOpenMessage = !saving && canMessageThumbtackVendor(vendor)

  return (
    <div
      style={enterDelayMs != null ? { animationDelay: `${enterDelayMs}ms` } : undefined}
      className="sa-enter sa-row border-b border-[#e5e7eb] py-4 last:border-b-0"
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <button
            type="button"
            disabled={!canOpenMessage}
            onClick={onMessage}
            title={
              canOpenMessage ? `Message ${vendor.name}` : 'Messaging is available for Thumbtack vendors'
            }
            className="sa-press text-left text-[14px] font-semibold leading-5 text-[#0a0a0a] outline-none hover:underline focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-60"
          >
            {vendor.name}
          </button>

          <div className="mt-0.5 flex flex-wrap items-center gap-1">
            <StarRating rating={vendor.rating} />
            <span className="text-[11px] font-semibold text-[#0a0a0a]">
              {vendor.rating != null ? vendor.rating.toFixed(1) : '—'}
            </span>
            <span className="text-[11px] text-[#717182]">
              ({vendor.reviewCount != null ? vendor.reviewCount : '—'} reviews)
            </span>
          </div>

          {distanceLabel ? (
            <div className="mt-1.5 flex items-center gap-1">
              <MapPinIcon />
              <p className="text-[11px] leading-[16.5px] text-[#717182]">{distanceLabel}</p>
            </div>
          ) : null}

          {vendor.phone || vendor.website ? (
            <div className="mt-0.5 flex flex-wrap items-center gap-3">
              {vendor.phone ? (
                <div className="flex items-center gap-1">
                  <PhoneIcon />
                  <PhoneTelLink phone={vendor.phone} className="text-[11px] text-[#717182]">
                    {vendor.phone}
                  </PhoneTelLink>
                </div>
              ) : null}
              {vendor.website ? (
                <div className="flex items-center gap-1">
                  <GlobeIcon />
                  <span className="text-[11px] text-[#717182]">{vendor.website}</span>
                </div>
              ) : null}
            </div>
          ) : null}

          {vendor.tags.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1">
              {vendor.tags.map((tag) => (
                <span
                  key={tag}
                  className="sa-pill rounded-full bg-[#f3f4f6] px-1.5 py-0.5 text-[10px] leading-[15px] text-[#717182]"
                >
                  {tag}
                </span>
              ))}
            </div>
          ) : null}

          {contactStatus ? (
            <p className="mt-2 text-[11px] font-medium leading-[16px] text-[#186179]">
              {contactStatus}
              {contactedAtLabel ? ` · ${contactedAtLabel}` : ''}
            </p>
          ) : null}
          {vendor.lastInboundPreview ? (
            <p className="mt-1 line-clamp-2 text-[11px] leading-[16px] text-[#364153]">
              Reply: {vendor.lastInboundPreview}
            </p>
          ) : null}
        </div>

        <button
          type="button"
          disabled={!canOpenMessage}
          onClick={onMessage}
          aria-label={`Message ${vendor.name}`}
          title={
            canOpenMessage ? `Message ${vendor.name}` : 'Messaging is available for Thumbtack vendors'
          }
          className="sa-card sa-press shrink-0 overflow-hidden rounded-[10px] outline-none hover:opacity-100 focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-60"
        >
          <VendorProfileImage name={vendor.name} imageUrl={vendor.imageUrl} />
        </button>
      </div>
    </div>
  )
}

export type FindExternalVendorRailProps = {
  open: boolean
  onClose: () => void
  onSelect: (
    suggestion: ExternalVendorSuggestionDto,
    compliance?: import('@/components/ExternalVendorVerificationView').ExternalVendorComplianceSnapshot,
  ) => void | Promise<void>
  locationLabel: string
  /** City, State ZIP under the title — no street address. */
  areaLabel?: string | null
  issueCategory?: string | null
  suggestions: ExternalVendorSuggestionDto[]
  providersUsed?: string[]
  loading?: boolean
  error?: string | null
  notice?: string | null
  saving?: boolean
  saveError?: string | null
  /** Footer dismiss label (default Cancel). */
  cancelLabel?: string
  /** When set, header/footer back uses this instead of fully closing via `onClose`. */
  onBack?: () => void
  /** Render only the panel (parent owns overlay, backdrop, and stacking). */
  panelOnly?: boolean
  /** When stacked beside another rail, drop outer rounding on the seam side. */
  stackedPosition?: AdminRightRailStackedPosition
  /** Desktop right rail (default) or mobile bottom sheet. */
  presentation?: 'rail' | 'sheet'
  /** Work order id for Thumbtack messaging (required for Message Vendor). */
  ticketId?: string | null
  jobContext?: ExternalVendorJobContextDto | null
}

/** Figma 835:1519 — Find External Vendor, overview right rail. */
export function FindExternalVendorRail({
  open,
  onClose,
  onSelect,
  locationLabel,
  areaLabel = null,
  issueCategory = null,
  suggestions,
  loading = false,
  error = null,
  notice = null,
  saving = false,
  saveError = null,
  cancelLabel = 'Cancel',
  onBack,
  panelOnly = false,
  stackedPosition,
  presentation = 'rail',
  ticketId = null,
  jobContext = null,
}: FindExternalVendorRailProps) {
  const titleId = useId()
  const messageInputId = useId()
  const messageInputRef = useRef<HTMLTextAreaElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const [messageVendor, setMessageVendor] = useState<ExternalVendorDisplayRow | null>(null)
  const [messageDraft, setMessageDraft] = useState('')
  const [messageSending, setMessageSending] = useState(false)
  const [messageError, setMessageError] = useState<string | null>(null)
  const [composerThread, setComposerThread] = useState<ComposerThreadLine[]>([])
  const [threadsByBusiness, setThreadsByBusiness] = useState<
    Record<string, ThumbtackVendorThreadDto>
  >({})
  const [listReentered, setListReentered] = useState(false)
  const displayRows = enrichExternalVendorSuggestions(
    suggestions,
    issueCategory,
    locationLabel,
  ).map((row) =>
    applyThreadToVendor(row, row.providerRef ? threadsByBusiness[row.providerRef] : undefined),
  )
  const searchQuery = buildExternalSearchQueryLabel(issueCategory, areaLabel ?? '')
  const resultCount = displayRows.length
  const isSheet = presentation === 'sheet'
  const handleBack = onBack ?? onClose
  const handleDismiss = !isSheet && panelOnly && onBack ? onBack : onClose
  const showBackNav = isSheet || !panelOnly

  const outreachContext = useMemo(
    () => ({
      propertyAddress: jobContext?.propertyAddress || locationLabel || areaLabel,
      jobCategory: jobContext?.jobCategory || issueCategory,
      issueSummary: jobContext?.issueSummary ?? null,
      urgency: jobContext?.urgency ?? null,
      timeframe: jobContext?.timeframe ?? null,
    }),
    [jobContext, locationLabel, areaLabel, issueCategory],
  )

  useEffect(() => {
    if (open) return
    setMessageVendor(null)
    setMessageError(null)
    setComposerThread([])
    setThreadsByBusiness({})
    setListReentered(false)
  }, [open])

  const hasThread = composerThread.length > 0
  const canSendVendorMessage =
    Boolean(messageDraft.trim()) && !messageSending && !saving

  useEffect(() => {
    if (!messageVendor) return
    queueMicrotask(() => messageInputRef.current?.focus())
  }, [messageVendor])

  useEffect(() => {
    if (!messageVendor || !hasThread) return
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messageVendor, composerThread, messageSending, hasThread])

  useEffect(() => {
    if (!open) return
    function onKey(event: KeyboardEvent) {
      if (event.key !== 'Escape' || saving || messageSending) return
      if (messageVendor) {
        leaveMessageView()
        return
      }
      handleDismiss()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, handleDismiss, saving, messageVendor, messageSending])

  function leaveMessageView() {
    setMessageVendor(null)
    setMessageError(null)
    setComposerThread([])
    setListReentered(true)
  }

  function handleRailDismiss() {
    if (saving || messageSending) return
    if (messageVendor) {
      leaveMessageView()
      return
    }
    handleDismiss()
  }

  function openMessageComposer(vendor: ExternalVendorDisplayRow) {
    setMessageError(null)
    setMessageDraft(buildThumbtackVendorOutreachMessage(outreachContext))
    setComposerThread(
      threadLinesFromVendor(
        vendor,
        vendor.providerRef ? threadsByBusiness[vendor.providerRef] : undefined,
      ),
    )
    setMessageVendor(vendor)
  }

  async function sendThumbtackMessage() {
    if (!messageVendor) return
    const url = resolveMessageThumbtackVendorUrl()
    const secret = getAdminEdgeSecret()
    const businessId = messageVendor.providerRef?.trim() ?? ''
    if (!ticketId?.trim()) {
      setMessageError('Open this from a work order to message the vendor.')
      return
    }
    if (!url || !secret) {
      setMessageError('Messaging is not configured for this dashboard.')
      return
    }
    if (!businessId) {
      setMessageError('This listing is missing a Thumbtack business id.')
      return
    }
    setMessageSending(true)
    setMessageError(null)
    try {
      const result = await postMessageThumbtackVendor({
        url,
        secret,
        ticketId,
        businessId,
        vendorName: messageVendor.name,
        searchId: messageVendor.searchId,
        categoryId: messageVendor.categoryId,
        text: messageDraft,
      })
      setThreadsByBusiness((prev) => ({ ...prev, [businessId]: result.thread }))
      setComposerThread((prev) => [
        ...prev,
        {
          id: `sent-${result.thread.last_outbound_at ?? Date.now()}`,
          direction: 'outbound',
          body: messageDraft.trim(),
        },
      ])
      setMessageDraft('')
    } catch (err) {
      setMessageError(
        getErrorMessage(
          err,
          'Could not send this message. The vendor is still available.',
        ),
      )
    } finally {
      setMessageSending(false)
    }
  }

  function vendorComposer() {
    if (!messageVendor) return null
    return (
      <ChatComposerBar
        id={messageInputId}
        label={`Message for ${messageVendor.name}`}
        draft={messageDraft}
        onDraftChange={setMessageDraft}
        onSend={() => void sendThumbtackMessage()}
        canSend={canSendVendorMessage}
        sending={messageSending}
        disabled={saving}
        placeholder="Write your message..."
        inputRef={messageInputRef}
        animateEnter={false}
        leftSlot={
          <span className="sa-pill inline-flex h-8 max-w-full items-center truncate rounded-full bg-[#f3f4f6] px-2.5 text-[12px] font-medium text-[#374151]">
            Vendor
          </span>
        }
      />
    )
  }

  if (!open) return null

  const panelWidthClass = 'max-w-[min(100vw,520px)]'

  const panel = (
      <div
        role={isSheet ? undefined : 'dialog'}
        aria-modal={isSheet || panelOnly ? undefined : true}
        aria-labelledby={isSheet ? undefined : titleId}
        className={
          isSheet
            ? 'relative flex min-h-0 flex-1 flex-col overflow-hidden bg-white'
            : adminRightRailPanelClass(stackedPosition, panelWidthClass)
        }
      >
        <button
          type="button"
          onClick={handleRailDismiss}
          disabled={saving || messageSending}
          aria-label="Close"
          className="sa-press absolute right-4 top-4 z-10 rounded-lg p-1 text-[#9ca3af] outline-none hover:bg-black/5 hover:text-[#364153] focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-2 disabled:opacity-50"
        >
          <CloseIcon />
        </button>

        {messageVendor ? (
          <div
            key={messageVendor.providerRef ?? messageVendor.name}
            className="sa-enter-scale relative flex min-h-0 flex-1 flex-col overflow-hidden pt-2"
            style={ASK_ULO_SURFACE_STYLE}
          >
            <div className="mx-auto mb-2.5 flex h-8 w-full shrink-0 items-center gap-2.5 px-4 pr-11">
              <VendorProfileImage
                name={messageVendor.name}
                imageUrl={messageVendor.imageUrl}
                sizeClass="size-8"
              />
              <h2
                id={titleId}
                className="m-0 min-w-0 truncate translate-y-px text-[18px] font-semibold leading-8 tracking-[-0.2px] text-[#0a0a0a]"
              >
                Message {messageVendor.name}
              </h2>
            </div>

            <div className="ask-ulo-section-enter min-h-0 w-full flex-1 overflow-y-auto overscroll-y-contain [scrollbar-gutter:stable]">
              <div className="mx-auto w-full space-y-4 px-4 pb-4">
                {composerThread.map((line) => (
                  <div
                    key={line.id}
                    className={`ask-ulo-msg-enter flex ${
                      line.direction === 'outbound' ? 'justify-end' : 'justify-start'
                    }`}
                  >
                    {line.direction === 'outbound' ? (
                      <p className="max-w-[85%] whitespace-pre-wrap rounded-[16px] bg-[#B4DFD6] px-4 py-3 text-[14px] leading-5 text-[#0a0a0a]">
                        {line.body}
                      </p>
                    ) : (
                      <p className="w-full max-w-[100%] whitespace-pre-wrap px-1 py-1 text-[14px] leading-5 text-[#0a0a0a]">
                        {line.body}
                      </p>
                    )}
                  </div>
                ))}
                {messageError ? (
                  <p className="sa-enter text-[13px] leading-5 text-error" role="alert">
                    {messageError}
                  </p>
                ) : null}
                <div ref={messagesEndRef} />
              </div>
            </div>
            <div className="ask-ulo-actions-enter mx-auto mt-auto w-full shrink-0 px-4 pb-2 pt-2">
              {vendorComposer()}
            </div>

            <div className="sa-enter shrink-0 border-t border-[#e5e7eb] bg-white/80 px-6 py-4">
              <h3 className="text-[14px] font-semibold leading-5 text-[#0a0a0a]">
                Assign vendor
              </h3>
              <p className="mt-1 text-[12px] leading-[18px] text-[#717182]">
                Add {messageVendor.name} to your vendor list and assign them to this job.
              </p>
              {saveError ? (
                <p className="sa-enter mt-3 text-[13px] leading-5 text-error" role="alert">
                  {saveError}
                </p>
              ) : null}
            </div>
            <footer className={ADMIN_RAIL_FOOTER_CLASS}>
              <button
                type="button"
                disabled={messageSending || saving}
                onClick={() => void onSelect(messageVendor)}
                className={ADMIN_RAIL_FOOTER_PRIMARY_BUTTON_CLASS}
              >
                {saving ? 'Assigning…' : 'Assign Vendor'}
              </button>
              <button
                type="button"
                disabled={messageSending || saving}
                onClick={leaveMessageView}
                className={ADMIN_RAIL_FOOTER_SECONDARY_BUTTON_CLASS}
              >
                Cancel
              </button>
            </footer>
          </div>
        ) : (
        <div
          className={[
            'flex min-h-0 flex-1 flex-col overflow-hidden',
            listReentered ? 'sa-enter' : '',
          ].join(' ')}
        >
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <header className="sa-enter border-b border-[#e5e7eb] px-6 pb-5 pt-6 pr-12">
            {showBackNav ? (
              <button
                type="button"
                disabled={saving}
                onClick={handleBack}
                className="sa-link inline-flex items-center gap-1 text-[12px] font-medium text-[#717182] outline-none hover:text-[#0a0a0a] focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-2 disabled:opacity-50"
              >
                <ChevronLeftIcon />
                {cancelLabel}
              </button>
            ) : null}
            <h2 id={titleId} className={`${showBackNav ? 'mt-3' : ''} text-[18px] font-semibold leading-7 tracking-[-0.3px] text-[#0a0a0a]`}>
              Find External Vendor
            </h2>
            {areaLabel ? (
              <p className="mt-1 text-[12px] leading-[18px] text-[#9ca3af]">{areaLabel}</p>
            ) : null}
          </header>

          <div className="sa-enter border-b border-[#e5e7eb] bg-[#f9fafb] px-6 py-4">
            <div className="sa-surface flex items-center gap-2 rounded-[10px] border border-black/10 bg-white px-[13px] py-[9px]">
              <SearchIcon />
              <p className="min-w-0 flex-1 truncate text-[12px] leading-4 text-[#0a0a0a]">{searchQuery}</p>
            </div>
            <p className="mt-2 text-[11px] leading-[15px] text-[#717182]">
              {loading
                ? 'Searching…'
                : `${resultCount} business${resultCount === 1 ? '' : 'es'} found · not on your roster`}
            </p>
            {notice && !loading ? (
              <p className="mt-1 text-[11px] leading-[15px] text-[#717182]" role="status">
                {notice}
              </p>
            ) : null}
          </div>

          <div className="px-6">
            {loading ? (
              <p className="sa-enter py-6 text-[13px] leading-5 text-[#6a7282]">Searching external vendors…</p>
            ) : null}

            {error ? (
              <p className="sa-enter py-4 text-[13px] leading-5 text-error" role="alert">
                {error}
              </p>
            ) : null}

            {!loading && !error && displayRows.length === 0 ? (
              <p className="sa-enter py-6 text-[13px] leading-5 text-[#6a7282]">
                No outside-network vendors found nearby for this trade. Check that live vendor
                search is configured, or invite a vendor from the roster.
              </p>
            ) : null}

            {!loading && !error && displayRows.length > 0 ? (
              <div>
                {displayRows.map((vendor, index) => {
                  const rowKey = `${vendor.name}-${vendor.primarySource}`
                  return (
                    <VendorResultRow
                      key={rowKey}
                      vendor={vendor}
                      saving={saving}
                      enterDelayMs={Math.min(index, 8) * 40}
                      onMessage={() => openMessageComposer(vendor)}
                    />
                  )
                })}
              </div>
            ) : null}

            {saveError ? (
              <p className="sa-enter pb-4 text-[13px] leading-4 text-error" role="alert">
                {saveError}
              </p>
            ) : null}
          </div>
        </div>

        {showBackNav ? (
          <footer className={ADMIN_RAIL_FOOTER_CLASS}>
            <button
              type="button"
              disabled={saving}
              onClick={handleBack}
              className={ADMIN_RAIL_FOOTER_SECONDARY_BUTTON_CLASS}
            >
              {cancelLabel}
            </button>
          </footer>
        ) : null}
        </div>
        )}
      </div>
  )

  if (isSheet) {
    return (
      <AdminBottomSheet open={open} onClose={handleRailDismiss} labelledBy={titleId}>
        {panel}
      </AdminBottomSheet>
    )
  }

  if (panelOnly) {
    return panel
  }

  return (
    <div className={ADMIN_RIGHT_RAIL_STACK_HOST}>
      <div
        role="presentation"
        className={ADMIN_RIGHT_RAIL_SCRIM}
        aria-hidden
        onClick={handleRailDismiss}
      />
      {panel}
    </div>
  )
}

export default FindExternalVendorRail
