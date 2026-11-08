import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import needsYourResponseIcon from '@/assets/try-demo/Needs your response.svg'
import unreadMessagesIcon from '@/assets/try-demo/Unread messages.svg'
import failedDeliveriesIcon from '@/assets/try-demo/Failed deliveries.svg'
import responseRateIcon from '@/assets/try-demo/Response rate.svg'
import { useSearchParams } from 'react-router-dom'
import { ConversationMonitoringModal } from '@/components/ConversationMonitoringModal'
import { TableCheckbox } from '@/components/TableCheckbox'
import { landlordUsesLimitedAlphaSurface } from '@shared/landlordCapabilities'
import { getActiveLandlordId } from '@/lib/activeLandlord'
import { TRY_DEMO_SPOTLIGHT_MESSAGES_KPI_ID } from '@/lib/tryDemoAttentionGuide'
import {
  mutateSearchParams,
  writeStringParam,
} from '@/lib/adminListUrlState'
import {
  isCommunicationConversationUnread,
  markCommunicationConversationRead,
} from '@/lib/communicationInboxRead'
import {
  COMMUNICATION_CLOSED_STATUSES,
  computeCommunicationInboxKpis,
} from '@/lib/communicationInboxKpis'
import {
  compactVendorName,
  conciseTopicSentence,
  isCompletedWorkOrderStatus,
  isGeneralistOfferedPestWork,
  offeredVendorNameFromAsk,
  replyToMessageIdFromPayload,
  unansweredLandlordTopics,
  workOrderIdFromMessagePayload,
} from '@/lib/communicationNeedsResponse'
import { isGeneralistTrade } from '@/lib/vendorTrades'
import { postSummarizeLandlordResponseTopics } from '@/api/summarizeLandlordResponseTopics'
import {
  inboxParticipantKind,
  inboxPhoneDigits,
} from '@/lib/communicationInboxKind'
import {
  conversationShowsResidentRepairRating,
  formatResidentFeedbackPreview,
  isResidentFeedbackAskBody,
  isTenantOnboardingInvite,
  isVendorOnboardingInvite,
  parseResidentFeedbackRatingBody,
} from '@/lib/conversationMonitoring'
import {
  deleteCommunicationConversationsForLandlord,
  isCommunicationInboxIdDismissed,
} from '@/lib/deleteCommunicationConversations'
import {
  classifyLimitedAlphaMessageLane,
  looksLikeNonOnboardingInboundSms,
  type LimitedAlphaMessageLane,
} from '@/lib/limitedAlphaMessageLanes'
import { ensureOnboardingDashboardMatchesPortfolio } from '@/lib/onboarding'
import {
  vendorSetupInboxContext,
  vendorSetupInboxStatus,
} from '@/lib/vendorOutreachCopy'
import { listVendorSetupInboxEntries } from '@/lib/vendorSetupConversation'
import { fetchCommunicationWorkOrderInboxRows } from '@/lib/workflowPipelineDetail'
import {
  isCommunicationInboxConversationType,
  landlordUpdateInboxDisplayName,
} from '@/lib/propertyConversations'
import { isPortalAdminEmailAllowed, isStaffAdminEmail } from '@shared/admin/staffAllowlist'
import { emailFromAuthSession, getAdminSession } from '@/lib/adminAuth'
import { inboxPreviewForSmsMessage } from '@/lib/smsMedia'
import { supabase } from '@/lib/supabase'
import {
  buildResidentByPhoneDigits,
  linkConversationToRosterByPhone,
  type InboxUnitRow,
  type RosterResidentForInboxLink,
} from '@/lib/linkConversationToRoster'
import {
  fetchCommunicationResponseRateKpi,
  MESSAGE_RESPONSE_RATE_TOOLTIP,
} from '@/lib/communicationResponseRate'

type ParticipantKind = 'tenant' | 'vendor' | 'ai' | 'landlord'

type Conversation = {
  id: string
  name: string
  kind: ParticipantKind
  context: string
  preview: string
  status: string
  unread: boolean
  /** Texts from Ulo on this thread that the landlord did not answer. */
  unansweredLandlordMessages: number
  lastActivity: number
  threadLane: LimitedAlphaMessageLane
}

type WaitingResponseTopic = {
  key: string
  conversationId: string
  messageId: string
  createdAtMs: number
  source: string
  summary: string
}

type CommMetrics = {
  needsYourResponse: number
  unreadMessages: number
  failedDeliveries: number
  responseRate: number | null
  needsYourResponseDelta: number | null
  unreadDelta: number | null
  failedDelta: number | null
  responseRateDelta: number | null
  lastUpdated: Date
}

const KIND_BADGE: Record<ParticipantKind, { label: string; className: string }> = {
  tenant: { label: 'TENANT', className: 'bg-[#dbeafe] text-[#1447e6]' },
  vendor: { label: 'VENDOR', className: 'bg-[#f3f4f6] text-[#364153]' },
  ai: { label: 'AI', className: 'bg-[#f3e8ff] text-[#7c3aed]' },
  landlord: { label: 'TEAM', className: 'bg-[#dbfce7] text-[#008236]' },
}

const AVATAR_COLORS = [
  'bg-[#dbeafe] text-[#1447e6]',
  'bg-[#dbfce7] text-[#008236]',
  'bg-[#fef9c2] text-[#a65f00]',
  'bg-[#ffe2e2] text-[#c10007]',
  'bg-[#e0f2fe] text-[#0069a8]',
  'bg-[#f3e8ff] text-[#7c3aed]',
]

function asString(value: unknown): string {
  if (value == null) return ''
  return String(value).trim()
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

function avatarColor(seed: string): string {
  let hash = 0
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) | 0
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]
}

function humanizeStatus(status: string): string {
  return status
    .split(/[_-]/)
    .map((p) => (p ? p[0].toUpperCase() + p.slice(1) : p))
    .join(' ')
}

function conversationStatusLabel(
  conversationType: string,
  status: string,
  hasMaintenanceRequest: boolean,
  latestBody?: string,
  residentFeedbackRating?: number | null,
  awaitingResidentFeedback?: boolean,
): string {
  if (residentFeedbackRating != null && residentFeedbackRating >= 1 && residentFeedbackRating <= 5) {
    return `Rated ${residentFeedbackRating}/5`
  }
  if (awaitingResidentFeedback || (latestBody && isResidentFeedbackAskBody(latestBody))) {
    return 'Awaiting rating'
  }
  if (
    latestBody &&
    parseResidentFeedbackRatingBody(latestBody) != null &&
    hasMaintenanceRequest
  ) {
    return `Rated ${parseResidentFeedbackRatingBody(latestBody)}/5`
  }
  if (latestBody && /finished the vendor verification form|verification form submitted/i.test(latestBody)) {
    return 'Form submitted'
  }
  if (
    latestBody &&
    /submitted an estimate for this job|reply approve or decline/i.test(latestBody)
  ) {
    return 'Estimate pending'
  }
  if (hasMaintenanceRequest) {
    return `Maintenance · ${humanizeStatus(status)}`
  }
  if (conversationType === 'ai_copilot') {
    return 'Handled by Ulo'
  }
  if (
    conversationType === 'vendor_alert' &&
    latestBody &&
    /preferred vendor network|quick verification/i.test(latestBody)
  ) {
    return 'Waiting for reply'
  }
  return humanizeStatus(status)
}

function formatRelativeTime(ms: number): string {
  if (Number.isNaN(ms)) return ''
  const diff = Date.now() - ms
  const minutes = Math.round(diff / 60_000)
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.round(hours / 24)
  if (days < 7) return `${days}d`
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

// Statuses that count as needing attention (unread dot), and ones that are done.
const NEEDS_ATTENTION_STATUSES = new Set([
  'open',
  'unread',
  'new',
  'action_required',
])
const CLOSED_STATUSES = COMMUNICATION_CLOSED_STATUSES

function parseMs(value: string): number {
  const ms = Date.parse(value)
  return Number.isNaN(ms) ? 0 : ms
}

function KpiCard({
  label,
  value,
  title,
  icon,
  selected = false,
  onSelect,
}: {
  label: string
  value: string
  title?: string
  icon?: string
  selected?: boolean
  /** Omit when the card is a readout and must not filter the list. */
  onSelect?: () => void
}) {
  const className = [
    'sa-enter-scale flex min-w-0 items-center gap-2 rounded-[10px] border px-3 py-3 text-left shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)] sm:gap-3 sm:px-5 sm:py-4',
    onSelect
      ? 'cursor-pointer outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[#101828]/20'
      : '',
    selected
      ? 'border-[#186179] bg-[#f9fafb]'
      : 'border-[#e5e7eb] bg-white',
    onSelect && !selected ? 'hover:bg-[#f9fafb]' : '',
  ].join(' ')
  const body = (
    <>
      {icon ? (
        <span
          className="flex size-8 shrink-0 items-center justify-center rounded-[8px] bg-[#f3f4f6]"
          aria-hidden
        >
          <img src={icon} alt="" className="size-[1.15rem] object-contain" />
        </span>
      ) : null}
      <p className="min-w-0 truncate whitespace-nowrap text-[14px] leading-5 tracking-[-0.1504px] text-[#6a7282]">
        {label}
      </p>
      <p className="shrink-0 whitespace-nowrap text-[22px] font-medium leading-none tracking-[0.4px] text-[#0a0a0a] tabular-nums sm:text-[28px]">
        {value}
      </p>
      {onSelect ? (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          className="ml-auto size-4 shrink-0 text-[#6a7282]"
          aria-hidden
        >
          <path d="M9 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : null}
    </>
  )
  if (!onSelect) {
    return (
      <div className={className} title={title}>
        {body}
      </div>
    )
  }
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={className}
      title={title}
    >
      {body}
    </button>
  )
}

function KpiCardSkeleton({ icon = false, chevron = true }: { icon?: boolean; chevron?: boolean }) {
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-[10px] border border-[#e5e7eb] bg-white px-3 py-3 shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)] sm:gap-3 sm:px-5 sm:py-4">
      {icon ? <div className="size-8 shrink-0 animate-pulse rounded-[8px] bg-[#f3f4f6]" /> : null}
      <div className="h-4 w-28 animate-pulse rounded bg-[#f3f4f6]" />
      <div className="h-7 w-10 animate-pulse rounded bg-[#f3f4f6]" />
      {chevron ? <div className="ml-auto size-4 shrink-0 animate-pulse rounded bg-[#f3f4f6]" /> : null}
    </div>
  )
}

function AiSparkleAvatar() {
  return (
    <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#a78bfa] to-[#7c3aed] text-white">
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.7}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="size-[18px]"
        aria-hidden
      >
        <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3Z" />
        <path d="M18 15.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7.7-1.8Z" />
      </svg>
    </span>
  )
}

type ParticipantFilterKey = 'all' | 'tenant' | 'vendor'

const PARTICIPANT_FILTER_OPTIONS: { id: ParticipantFilterKey; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'tenant', label: 'Tenant' },
  { id: 'vendor', label: 'Vendor' },
]

function parseParticipantFilter(raw: string | null | undefined): ParticipantFilterKey {
  const value = raw?.trim()
  if (value === 'tenant' || value === 'vendor') return value
  return 'all'
}

function parseMessageLane(raw: string | null | undefined): LimitedAlphaMessageLane {
  return raw?.trim() === 'onboarding' ? 'onboarding' : 'request'
}

type MessageMetricFilter = 'needs' | 'unread' | 'failed'

function parseMessageMetricFilter(raw: string | null | undefined): MessageMetricFilter | null {
  const value = raw?.trim()
  if (value === 'needs' || value === 'unread' || value === 'failed') {
    return value
  }
  return null
}

const MESSAGE_METRIC_FILTER_LABELS: Record<MessageMetricFilter, string> = {
  needs: 'Needs your response',
  unread: 'Unread Messages',
  failed: 'Failed Deliveries',
}

function MessageMetricFilterChip({
  filter,
  onClear,
}: {
  filter: MessageMetricFilter
  onClear: () => void
}) {
  const label = MESSAGE_METRIC_FILTER_LABELS[filter]
  return (
    <span className="inline-flex h-8 shrink-0 items-center gap-1 rounded-full border border-[#e5e7eb] bg-[#f3f4f6] pl-3 pr-1 text-[12px] font-medium text-[#364153]">
      {label}
      <button
        type="button"
        aria-label={`Remove ${label} filter`}
        onClick={onClear}
        className="inline-flex size-6 cursor-pointer items-center justify-center rounded-full text-[#6a7282] outline-none hover:bg-[#e5e7eb] hover:text-[#101828] focus-visible:ring-2 focus-visible:ring-[#186179]"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="size-3.5" aria-hidden>
          <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
        </svg>
      </button>
    </span>
  )
}

function conversationMatchesParticipantFilters(
  conversation: Conversation,
  filter: ParticipantFilterKey,
): boolean {
  if (filter === 'all') return true
  if (filter === 'tenant') return conversation.kind === 'tenant'
  if (filter === 'vendor') return conversation.kind === 'vendor'
  return true
}

function ParticipantFilterChip({
  value,
  onChange,
}: {
  value: ParticipantFilterKey
  onChange: (value: ParticipantFilterKey) => void
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const listId = useId()
  const label =
    PARTICIPANT_FILTER_OPTIONS.find((option) => option.id === value)?.label ?? 'All'

  useEffect(() => {
    if (!open) return
    function handlePointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handlePointerDown)
    return () => document.removeEventListener('mousedown', handlePointerDown)
  }, [open])

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={listId}
        aria-label={`Participant filter: ${label}`}
        onClick={() => setOpen((current) => !current)}
        className="sa-press inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full border border-[#e5e7eb] bg-white px-3 text-[12px] font-medium text-[#364153] hover:bg-[#f9fafb] outline-none focus-visible:ring-2 focus-visible:ring-[#186179] focus-visible:ring-offset-2"
      >
        {label}
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          className="size-3.5 text-[#6a7282]"
          aria-hidden
        >
          <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open ? (
        <div
          id={listId}
          role="listbox"
          className="absolute right-0 z-20 mt-1.5 min-w-[140px] rounded-[10px] border border-[#e5e7eb] bg-white p-1.5 shadow-lg"
        >
          {PARTICIPANT_FILTER_OPTIONS.map((option) => {
            const selected = value === option.id
            return (
              <button
                key={option.id}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => {
                  onChange(option.id)
                  setOpen(false)
                }}
                className={[
                  'sa-press flex w-full cursor-pointer items-center rounded-[8px] px-2.5 py-2 text-left text-[13px] font-medium',
                  selected
                    ? 'bg-[#e8f3f6] text-[#186179]'
                    : 'text-[#364153] hover:bg-[#f9fafb]',
                ].join(' ')}
              >
                {option.label}
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}

function SelectionTrashIcon({ className = 'size-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14zM10 11v6M14 11v6"
        stroke="currentColor"
        strokeWidth={1.65}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function ConversationListRow({
  conversation: c,
  index,
  selected,
  onToggleSelect,
  onOpen,
}: {
  conversation: Conversation
  index: number
  selected: boolean
  onToggleSelect: (id: string) => void
  onOpen: (id: string) => void
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      style={{ animationDelay: `${Math.min(index, 10) * 35}ms` }}
      onClick={() => onOpen(c.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpen(c.id)
        }
      }}
      className={`sa-enter sa-row flex w-full cursor-pointer items-center gap-3 px-6 py-4 outline-none hover:bg-[#f9fafb] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#0030b5] ${
        selected ? 'bg-[#f5f3ff]' : ''
      }`}
    >
      <div
        className="flex size-9 shrink-0 items-center justify-center"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <TableCheckbox
          aria-label={`Select conversation with ${c.name}`}
          checked={selected}
          onChange={() => onToggleSelect(c.id)}
        />
      </div>
      <div className="flex min-w-0 flex-1 items-center gap-3 text-left">
        <span className="relative flex size-9 shrink-0 items-center justify-center">
          {c.unread ? (
            <span className="absolute -left-3 top-1/2 size-2 -translate-y-1/2 rounded-full bg-[#1447e6]" />
          ) : null}
          {c.kind === 'ai' ? (
            <AiSparkleAvatar />
          ) : (
            <span
              className={`flex size-9 items-center justify-center rounded-full text-[12px] font-semibold ${avatarColor(c.name)}`}
            >
              {initials(c.name)}
            </span>
          )}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span
              className={`truncate text-[14px] leading-5 ${
                c.unread ? 'font-semibold text-[#0a0a0a]' : 'font-medium text-[#101828]'
              }`}
            >
              {c.name}
            </span>
            <span
              className={`shrink-0 rounded-[4px] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.04em] ${KIND_BADGE[c.kind].className}`}
            >
              {KIND_BADGE[c.kind].label}
            </span>
            {c.context ? (
              <span className="truncate text-[12px] leading-4 text-[#6a7282]">
                · {c.context}
              </span>
            ) : null}
          </div>
          <p
            className={`mt-0.5 truncate text-[13px] leading-5 ${c.unread ? 'font-medium text-[#364153]' : 'text-[#6a7282]'}`}
          >
            {c.preview}
          </p>
        </div>

        <span className="shrink-0 pl-2 text-[12px] leading-4 text-[#6a7282]">
          {formatRelativeTime(c.lastActivity)}
        </span>
      </div>
    </div>
  )
}

function MessageLaneTabList({
  active,
  onChange,
  requestCount,
  onboardingCount,
  participantFilter,
  onParticipantFilterChange,
  metricFilter,
  onClearMetricFilter,
  trailing,
}: {
  active: LimitedAlphaMessageLane
  onChange: (lane: LimitedAlphaMessageLane) => void
  requestCount: number
  onboardingCount: number
  participantFilter: ParticipantFilterKey
  onParticipantFilterChange: (value: ParticipantFilterKey) => void
  metricFilter: MessageMetricFilter | null
  onClearMetricFilter: () => void
  trailing?: ReactNode
}) {
  const tabs: { id: LimitedAlphaMessageLane; label: string; count: number }[] = [
    { id: 'request', label: 'Maintenance requests', count: requestCount },
    { id: 'onboarding', label: 'Onboarding', count: onboardingCount },
  ]
  return (
    <div className="flex items-end gap-4 border-b border-[#e5e7eb] px-6">
      <div
        className="flex min-w-0 flex-1 items-end gap-5"
        role="tablist"
        aria-label="Message sections"
      >
        {tabs.map((tab) => {
          const selected = active === tab.id
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => onChange(tab.id)}
              className={[
                'sa-press -mb-px inline-flex items-center gap-2 border-b-2 px-0 pb-2.5 pt-3 text-[13px] font-medium leading-5 outline-none focus-visible:ring-2 focus-visible:ring-[#186179] focus-visible:ring-offset-2',
                selected
                  ? 'border-[#186179] text-[#186179]'
                  : 'border-transparent text-[#6a7282] hover:text-[#186179]',
              ].join(' ')}
            >
              {tab.label}
              <span
                className={[
                  'inline-flex min-w-5 items-center justify-center rounded-full px-1.5 py-0.5 text-[11px] font-medium tabular-nums',
                  selected
                    ? 'bg-[#e8f3f6] text-[#186179]'
                    : 'bg-[#f3f4f6] text-[#6a7282]',
                ].join(' ')}
              >
                {tab.count}
              </span>
            </button>
          )
        })}
      </div>
      <div className="flex shrink-0 items-center gap-2 pb-2">
        {metricFilter ? (
          <MessageMetricFilterChip filter={metricFilter} onClear={onClearMetricFilter} />
        ) : null}
        <ParticipantFilterChip
          value={participantFilter}
          onChange={onParticipantFilterChange}
        />
        {trailing}
      </div>
    </div>
  )
}

export function AdminCommunicationDashboard() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [responseTopics, setResponseTopics] = useState<WaitingResponseTopic[]>([])
  const [metrics, setMetrics] = useState<CommMetrics | null>(null)
  const [metricThreadIds, setMetricThreadIds] = useState<{
    failed: Set<string>
  }>({ failed: new Set() })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const participantFilter = parseParticipantFilter(searchParams.get('who'))
  const messageLaneTab = parseMessageLane(searchParams.get('lane'))
  const metricFilter = parseMessageMetricFilter(searchParams.get('metric'))
  const responseTopicFingerprint = responseTopics.map((topic) => topic.source).join('\n')
  useEffect(() => {
    if (metricFilter !== 'needs' || !responseTopicFingerprint) return
    const sources = responseTopicFingerprint.split('\n')
    let cancelled = false
    void postSummarizeLandlordResponseTopics(sources)
      .then((summaries) => {
        if (cancelled || summaries.length !== sources.length) return
        setResponseTopics((current) => {
          if (current.map((topic) => topic.source).join('\n') !== responseTopicFingerprint) {
            return current
          }
          return current.map((topic, index) => ({
            ...topic,
            summary: summaries[index]?.trim() || topic.summary,
          }))
        })
      })
      .catch(() => {
        /* Keep the local one-sentence version when the function is not deployed. */
      })
    return () => {
      cancelled = true
    }
  }, [metricFilter, responseTopicFingerprint])
  const monitoringConversationId = searchParams.get('thread')?.trim() || null
  const focusMessageId = searchParams.get('msg')?.trim() || null
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [deleteSaving, setDeleteSaving] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const deleteConfirmTitleId = useId()

  const setParticipantFilter = useCallback(
    (value: ParticipantFilterKey) => {
      setSearchParams(
        mutateSearchParams(searchParams, (next) => {
          writeStringParam(next, 'who', value, 'all')
        }),
        { replace: true },
      )
    },
    [searchParams, setSearchParams],
  )

  const setMessageLaneTab = useCallback(
    (value: LimitedAlphaMessageLane) => {
      setSearchParams(
        mutateSearchParams(searchParams, (next) => {
          writeStringParam(next, 'lane', value, 'request')
        }),
        { replace: true },
      )
    },
    [searchParams, setSearchParams],
  )

  const clearMetricFilter = useCallback(() => {
    if (!metricFilter) return
    setSearchParams(
      mutateSearchParams(searchParams, (next) => {
        next.delete('metric')
      }),
      { replace: true },
    )
  }, [metricFilter, searchParams, setSearchParams])

  const toggleMetricFilter = useCallback(
    (value: MessageMetricFilter) => {
      setSearchParams(
        mutateSearchParams(searchParams, (next) => {
          writeStringParam(next, 'metric', metricFilter === value ? '' : value, '')
        }),
        { replace: true },
      )
    },
    [metricFilter, searchParams, setSearchParams],
  )

  const closeMonitoring = useCallback(() => {
    if (!searchParams.get('thread')) return
    setSearchParams(
      mutateSearchParams(searchParams, (next) => {
        next.delete('thread')
        next.delete('msg')
      }),
      { replace: true },
    )
  }, [searchParams, setSearchParams])

  const monitoringHeadingName = useMemo(() => {
    if (!monitoringConversationId) return null
    const row = conversations.find((entry) => entry.id === monitoringConversationId)
    if (!row || row.kind === 'ai') return null
    const name = row.name.trim()
    if (!name || name === 'Unknown' || name === 'Vendor') return null
    return name
  }, [conversations, monitoringConversationId])

  useEffect(() => {
    let cancelled = false

    async function load() {
      if (!supabase) {
        setLoading(false)
        setError('Supabase is not configured — connect a project to see live conversations.')
        return
      }

      setLoading(true)
      setError(null)
      setMetrics(null)
      setMetricThreadIds({ failed: new Set() })
      setResponseTopics([])
      const landlordId = getActiveLandlordId()
      const loadStartedAt =
        typeof performance !== 'undefined' ? performance.now() : Date.now()

      const session = await getAdminSession()
      if (cancelled) return
      const sessionEmail = emailFromAuthSession(session)
      // Staff + portal landlords: show Ulo ↔ landlord ops SMS on Messages.
      // (Previously staff-only; portal logins only saw the phone, so Alpha
      // looked "stale" even when attention SMS had already been delivered.)
      const includeLandlordUpdate =
        isStaffAdminEmail(sessionEmail) || isPortalAdminEmailAllowed(sessionEmail)

      // Strict rule: guided New Landlord only surfaces portfolio-matched threads.
      const dashboardSync = await ensureOnboardingDashboardMatchesPortfolio(landlordId)
      if (cancelled) return
      const allowImportedOperations = dashboardSync.allowImportedOperations

      // Start work-order inbox enrichment in parallel with the SMS list path.
      const workOrderInboxPromise = allowImportedOperations
        ? fetchCommunicationWorkOrderInboxRows().catch(() => [] as Awaited<
            ReturnType<typeof fetchCommunicationWorkOrderInboxRows>
          >)
        : Promise.resolve(
            [] as Awaited<ReturnType<typeof fetchCommunicationWorkOrderInboxRows>>,
          )

      // KPI metrics — open/unread/failed still use landlord-scoped conversation
      // rows; Response rate is a DB aggregate (not the capped message sample).
      void (async () => {
        if (!supabase) return
        const now = Date.now()

        const [allConvResult, allMsgResult, responseRateKpi] = await Promise.all([
          supabase
            .from('sms_conversations')
            .select('id, status, conversation_type, created_at, updated_at')
            .eq('landlord_id', landlordId)
            .limit(2000)
            .then((r) => r),
          supabase
            .from('sms_messages')
            .select('conversation_id, direction, provider_status, created_at')
            .eq('landlord_id', landlordId)
            .order('created_at', { ascending: false })
            .limit(5000)
            .then((r) => r),
          fetchCommunicationResponseRateKpi({ landlordId, nowMs: now }).catch(
            (err) => {
              console.error('[messages] response rate rpc', err)
              return null
            },
          ),
        ])

        if (cancelled) return

        const conversations = []
        if (!allConvResult.error) {
          for (const raw of (allConvResult.data ?? []) as Record<string, unknown>[]) {
            const id = asString(raw.id)
            if (!id) continue
            conversations.push({
              id,
              status: asString(raw.status) || 'open',
              conversationType: asString(raw.conversation_type),
              createdAtMs: parseMs(asString(raw.created_at)),
              updatedAtMs: parseMs(asString(raw.updated_at) || asString(raw.created_at)),
            })
          }
        }

        const messages = []
        if (!allMsgResult.error) {
          for (const raw of (allMsgResult.data ?? []) as Record<string, unknown>[]) {
            messages.push({
              conversationId: asString(raw.conversation_id),
              direction: asString(raw.direction),
              providerStatus: asString(raw.provider_status),
              createdAtMs: parseMs(asString(raw.created_at)),
            })
          }
        }

        const kpis = computeCommunicationInboxKpis({
          conversations,
          messages,
          nowMs: now,
          responseRate: responseRateKpi?.responseRate ?? null,
          responseRateDelta: responseRateKpi?.responseRateDelta ?? null,
          isUnread: ({ conversationId, lastActivityMs, activityLooksUnread }) =>
            isCommunicationConversationUnread({
              landlordId,
              conversationId,
              lastActivityMs,
              activityLooksUnread,
            }),
        })
        setMetricThreadIds({
          failed: new Set(kpis.failedDeliveryThreadIds),
        })
        setMetrics({
          needsYourResponse: kpis.needsYourResponse,
          unreadMessages: kpis.unreadMessages,
          failedDeliveries: kpis.failedDeliveries,
          responseRate: kpis.responseRate,
          needsYourResponseDelta: kpis.needsYourResponseDelta,
          unreadDelta: kpis.unreadDelta,
          failedDelta: kpis.failedDelta,
          responseRateDelta: kpis.responseRateDelta,
          lastUpdated: new Date(),
        })
      })()

      const conversationColumns =
        'id, conversation_type, status, external_phone_number, unit_id, resident_id, vendor_id, maintenance_request_id, updated_at, created_at'
      const [{ data: convRows, error: convError }, { data: landlordConvRows, error: landlordConvError }] =
        await Promise.all([
          supabase
            .from('sms_conversations')
            .select(conversationColumns)
            .eq('landlord_id', landlordId)
            .order('updated_at', { ascending: false })
            .limit(50),
          supabase
            .from('sms_conversations')
            .select(conversationColumns)
            .eq('landlord_id', landlordId)
            .eq('conversation_type', 'landlord_update')
            .order('updated_at', { ascending: false })
            .limit(10),
        ])

      if (cancelled) return

      if (convError) {
        console.error('[admin communication] sms_conversations fetch failed', convError.message)
        setConversations([])
        setLoading(false)
        return
      }
      if (landlordConvError) {
        console.error('[admin communication] landlord thread fetch failed', landlordConvError.message)
      }

      const mergedConvRows = [...((convRows ?? []) as Record<string, unknown>[])]
      const seenConversationIds = new Set(mergedConvRows.map((row) => asString(row.id)))
      for (const row of (landlordConvRows ?? []) as Record<string, unknown>[]) {
        const id = asString(row.id)
        if (!id || seenConversationIds.has(id)) continue
        mergedConvRows.push(row)
        seenConversationIds.add(id)
      }

      const rows = mergedConvRows.filter((row) =>
        isCommunicationInboxConversationType(
          asString(row.conversation_type),
          { includeLandlordUpdate: true },
        ),
      )

      // Fail-closed for guided + always load roster so orphan SMS threads can link by phone.
      const [portfolioResidents, portfolioVendors, portfolioUnits, landlordRow] = await Promise.all([
        supabase
          .from('users')
          .select('id, full_name, phone, unit, building, status')
          .eq('landlord_id', landlordId)
          .in('status', ['active', 'pending'])
          .limit(2000),
        supabase.from('vendors').select('id, phone').eq('landlord_id', landlordId).limit(500),
        supabase
          .from('units')
          .select('id, unit_label, building')
          .eq('landlord_id', landlordId)
          .limit(2000),
        includeLandlordUpdate
          ? supabase
              .from('landlords')
              .select('id, name')
              .eq('id', landlordId)
              .maybeSingle()
          : Promise.resolve({ data: null as { name?: string } | null }),
      ])
      if (cancelled) return

      const landlordCompanyName = asString(landlordRow.data?.name) || ''

      const rosterResidents: RosterResidentForInboxLink[] = (
        (portfolioResidents.data ?? []) as Record<string, unknown>[]
      )
        .map((row) => ({
          id: asString(row.id),
          name: asString(row.full_name),
          phone: asString(row.phone),
          unit: asString(row.unit),
          building: asString(row.building),
        }))
        .filter((row) => row.id)
      const residentByPhone = buildResidentByPhoneDigits(rosterResidents)
      const inventoryUnits: InboxUnitRow[] = (
        (portfolioUnits.data ?? []) as Record<string, unknown>[]
      )
        .map((row) => ({
          id: asString(row.id),
          label: asString(row.unit_label),
          building: asString(row.building),
        }))
        .filter((row) => row.id)

      let scopedRows = rows
      if (!allowImportedOperations) {
        const allowedResidentIds = new Set(rosterResidents.map((r) => r.id))
        const allowedVendorIds = new Set(
          (portfolioVendors.data ?? [])
            .map((r) => asString((r as { id: string }).id))
            .filter(Boolean),
        )
        const allowedPhones = new Set<string>([...residentByPhone.keys()])
        for (const v of portfolioVendors.data ?? []) {
          const digits = inboxPhoneDigits(asString((v as { phone?: string }).phone))
          if (digits) allowedPhones.add(digits)
        }
        scopedRows = rows.filter((r) => {
          // Staff Messages: Ulo ↔ landlord ops threads are not roster-bound.
          if (
            includeLandlordUpdate &&
            asString(r.conversation_type) === 'landlord_update'
          ) {
            return true
          }
          const residentId = asString(r.resident_id)
          const vendorId = asString(r.vendor_id)
          const phone = inboxPhoneDigits(asString(r.external_phone_number))
          if (residentId && allowedResidentIds.has(residentId)) return true
          if (vendorId && allowedVendorIds.has(vendorId)) return true
          if (phone && allowedPhones.has(phone)) return true
          return false
        })
      }

      const conversationBackfills: Array<{
        id: string
        residentId: string
        unitId: string | null
      }> = []
      for (const row of scopedRows) {
        const id = asString(row.id)
        if (!id) continue
        if (asString(row.resident_id) && asString(row.unit_id)) continue
        const linked = linkConversationToRosterByPhone({
          externalPhone: asString(row.external_phone_number),
          residentByPhone,
          units: inventoryUnits,
        })
        if (!linked) continue
        if (!asString(row.resident_id)) row.resident_id = linked.residentId
        if (!asString(row.unit_id) && linked.unitId) row.unit_id = linked.unitId
        conversationBackfills.push({
          id,
          residentId: linked.residentId,
          unitId: linked.unitId,
        })
      }
      if (conversationBackfills.length > 0 && supabase) {
        const client = supabase
        void Promise.all(
          conversationBackfills.map((entry) =>
            client
              .from('sms_conversations')
              .update({
                resident_id: entry.residentId,
                ...(entry.unitId ? { unit_id: entry.unitId } : {}),
              })
              .eq('id', entry.id)
              .eq('landlord_id', landlordId),
          ),
        ).catch((err) => {
          console.warn('[admin communication] conversation roster backfill failed', err)
        })
      }

      const conversationIds = scopedRows.map((r) => asString(r.id)).filter(Boolean)
      const residentIds = [
        ...new Set([
          ...scopedRows.map((r) => asString(r.resident_id)).filter(Boolean),
          ...rosterResidents.map((r) => r.id),
        ]),
      ]
      const unitIds = [
        ...new Set([
          ...scopedRows.map((r) => asString(r.unit_id)).filter(Boolean),
          ...inventoryUnits.map((u) => u.id),
        ]),
      ]
      const ticketIds = [
        ...new Set(scopedRows.map((r) => asString(r.maintenance_request_id)).filter(Boolean)),
      ]
      const landlordThreadIds = scopedRows
        .filter((row) => asString(row.conversation_type) === 'landlord_update')
        .map((row) => asString(row.id))
        .filter(Boolean)

      const [messagesResult, residentsResult, vendorsResult, unitsResult, feedbackResult, feedbackRequestResult, landlordMessagesResult] =
        await Promise.allSettled([
          conversationIds.length
            ? supabase
                .from('sms_messages')
                .select('conversation_id, body, direction, media_urls, created_at')
                .eq('landlord_id', landlordId)
                .in('conversation_id', conversationIds)
                .order('created_at', { ascending: false })
                .limit(500)
            : Promise.resolve({ data: [], error: null }),
          residentIds.length
            ? supabase
                .from('users')
                .select('id, full_name, unit, building')
                .eq('landlord_id', landlordId)
                .in('id', residentIds)
            : Promise.resolve({ data: [], error: null }),
          supabase
            .from('vendors')
            .select('id, name, phone, category')
            .eq('landlord_id', landlordId)
            .limit(500),
          unitIds.length
            ? supabase
                .from('units')
                .select('id, unit_label, building')
                .eq('landlord_id', landlordId)
                .in('id', unitIds)
            : Promise.resolve({ data: [], error: null }),
          ticketIds.length
            ? supabase
                .from('vendor_feedback')
                .select('maintenance_request_id, rating')
                .eq('landlord_id', landlordId)
                .eq('rater_type', 'resident')
                .in('maintenance_request_id', ticketIds)
            : Promise.resolve({ data: [], error: null }),
          ticketIds.length
            ? supabase
                .from('vendor_feedback_requests')
                .select('maintenance_request_id, status')
                .eq('landlord_id', landlordId)
                .eq('rater_type', 'resident')
                .eq('status', 'open')
                .in('maintenance_request_id', ticketIds)
            : Promise.resolve({ data: [], error: null }),
          landlordThreadIds.length
            ? supabase
                .from('sms_messages')
                .select('id, conversation_id, direction, body, created_at, raw_payload')
                .eq('landlord_id', landlordId)
                .in('conversation_id', landlordThreadIds)
                .order('created_at', { ascending: true })
                .limit(2000)
            : Promise.resolve({ data: [], error: null }),
        ])

      if (cancelled) return

      const latestMessageByConversation = new Map<
        string,
        { body: string; direction: string; createdAt: number; mediaUrls: unknown }
      >()
      const vendorOnboardingCopyConversationIds = new Set<string>()
      const onboardingCopyConversationIds = new Set<string>()
      const nonOnboardingInboundConversationIds = new Set<string>()
      if (messagesResult.status === 'fulfilled' && !messagesResult.value.error) {
        for (const m of (messagesResult.value.data ?? []) as Record<string, unknown>[]) {
          const convId = asString(m.conversation_id)
          if (!convId) continue
          const body = asString(m.body)
          const direction = asString(m.direction)
          if (isVendorOnboardingInvite(body)) {
            vendorOnboardingCopyConversationIds.add(convId)
            onboardingCopyConversationIds.add(convId)
          } else if (isTenantOnboardingInvite(body)) {
            onboardingCopyConversationIds.add(convId)
          }
          if (direction === 'inbound' && looksLikeNonOnboardingInboundSms(body)) {
            nonOnboardingInboundConversationIds.add(convId)
          }
          if (latestMessageByConversation.has(convId)) continue
          latestMessageByConversation.set(convId, {
            body,
            direction,
            createdAt: new Date(asString(m.created_at)).getTime(),
            mediaUrls: m.media_urls,
          })
        }
      }

      const landlordTicketByThread = new Map<string, string>()
      for (const row of scopedRows) {
        if (asString(row.conversation_type) !== 'landlord_update') continue
        const id = asString(row.id)
        const ticketId = asString(row.maintenance_request_id)
        if (id && ticketId) landlordTicketByThread.set(id, ticketId)
      }

      const unansweredByLandlordThread = new Map<string, number>()
      const waitingTopics: WaitingResponseTopic[] = []
      if (landlordMessagesResult.status === 'fulfilled' && !landlordMessagesResult.value.error) {
        const landlordMessageRows = (landlordMessagesResult.value.data ?? []) as Record<string, unknown>[]
        const workOrderIds = new Set(landlordTicketByThread.values())
        for (const raw of landlordMessageRows) {
          const ticketId = workOrderIdFromMessagePayload(raw.raw_payload)
          if (ticketId) workOrderIds.add(ticketId)
        }
        const completedWorkOrderIds = new Set<string>()
        const issueCategoryByWorkOrder = new Map<string, string>()
        if (workOrderIds.size > 0) {
          const { data: workOrders } = await supabase
            .from('maintenance_requests')
            .select('id, vendor_work_status, issue_category')
            .eq('landlord_id', landlordId)
            .in('id', [...workOrderIds])
          if (cancelled) return
          for (const workOrder of (workOrders ?? []) as Record<string, unknown>[]) {
            const id = asString(workOrder.id)
            if (!id) continue
            issueCategoryByWorkOrder.set(id, asString(workOrder.issue_category))
            if (isCompletedWorkOrderStatus(asString(workOrder.vendor_work_status))) {
              completedWorkOrderIds.add(id)
            }
          }
        }
        const generalistVendorNames = new Set<string>()
        const specialistVendorNames = new Set<string>()
        if (vendorsResult.status === 'fulfilled' && !vendorsResult.value.error) {
          for (const vendor of (vendorsResult.value.data ?? []) as Record<string, unknown>[]) {
            const compact = compactVendorName(asString(vendor.name))
            if (!compact) continue
            if (isGeneralistTrade(asString(vendor.category) || null)) generalistVendorNames.add(compact)
            else specialistVendorNames.add(compact)
          }
        }
        const byThread = new Map<
          string,
          {
            id: string
            direction: string
            createdAtMs: number
            text: string
            replyToMessageId?: string
            workOrderCompleted?: boolean
            generalistPestOffer?: boolean
          }[]
        >()
        for (const raw of landlordMessageRows) {
          const convId = asString(raw.conversation_id)
          if (!convId) continue
          const text = asString(raw.body)
          const workOrderId =
            workOrderIdFromMessagePayload(raw.raw_payload) || landlordTicketByThread.get(convId) || ''
          const offeredName = offeredVendorNameFromAsk(text)
          const offeredCompact = offeredName ? compactVendorName(offeredName) : ''
          const vendorFound = Boolean(
            offeredCompact &&
              (generalistVendorNames.has(offeredCompact) || specialistVendorNames.has(offeredCompact)),
          )
          const bucket = byThread.get(convId) ?? []
          bucket.push({
            id: asString(raw.id),
            direction: asString(raw.direction),
            createdAtMs: new Date(asString(raw.created_at)).getTime(),
            text,
            replyToMessageId: replyToMessageIdFromPayload(raw.raw_payload),
            workOrderCompleted: Boolean(workOrderId && completedWorkOrderIds.has(workOrderId)),
            generalistPestOffer: isGeneralistOfferedPestWork({
              text,
              vendorFound: vendorFound && !specialistVendorNames.has(offeredCompact),
              vendorCategory: generalistVendorNames.has(offeredCompact) ? 'general' : null,
              issueCategory: workOrderId ? issueCategoryByWorkOrder.get(workOrderId) : null,
            }),
          })
          byThread.set(convId, bucket)
        }
        for (const [convId, threadMessages] of byThread) {
          const topics = unansweredLandlordTopics(threadMessages)
          unansweredByLandlordThread.set(convId, topics.length)
          for (const topic of topics) {
            waitingTopics.push({
              key: `${convId}:${topic.messageId || topic.createdAtMs}:${waitingTopics.length}`,
              conversationId: convId,
              messageId: topic.messageId,
              createdAtMs: topic.createdAtMs,
              source: topic.text,
              summary: conciseTopicSentence(topic.text),
            })
          }
        }
      }
      waitingTopics.sort((a, b) => a.createdAtMs - b.createdAtMs)
      setResponseTopics(waitingTopics)

      const residentById = new Map<string, { name: string; unit: string; building: string }>()
      if (residentsResult.status === 'fulfilled' && !residentsResult.value.error) {
        for (const u of (residentsResult.value.data ?? []) as Record<string, unknown>[]) {
          residentById.set(asString(u.id), {
            name: asString(u.full_name),
            unit: asString(u.unit),
            building: asString(u.building),
          })
        }
      }

      const vendorById = new Map<string, string>()
      const vendorByPhone = new Map<string, string>()
      const vendorByName = new Map<string, string>()
      if (vendorsResult.status === 'fulfilled' && !vendorsResult.value.error) {
        for (const v of (vendorsResult.value.data ?? []) as Record<string, unknown>[]) {
          const name = asString(v.name)
          const id = asString(v.id)
          if (id && name) vendorById.set(id, name)
          const digits = inboxPhoneDigits(asString(v.phone))
          if (digits && name) vendorByPhone.set(digits, name)
          if (name) vendorByName.set(name.toLowerCase(), name)
        }
      }

      const unitById = new Map<string, { label: string; building: string }>()
      if (unitsResult.status === 'fulfilled' && !unitsResult.value.error) {
        for (const u of (unitsResult.value.data ?? []) as Record<string, unknown>[]) {
          unitById.set(asString(u.id), {
            label: asString(u.unit_label),
            building: asString(u.building),
          })
        }
      }

      const ratingByTicketId = new Map<string, number>()
      if (feedbackResult.status === 'fulfilled' && !feedbackResult.value.error) {
        for (const row of (feedbackResult.value.data ?? []) as Record<string, unknown>[]) {
          const ticketId = asString(row.maintenance_request_id)
          const rating = Number(row.rating)
          if (!ticketId || !Number.isInteger(rating) || rating < 1 || rating > 5) continue
          ratingByTicketId.set(ticketId, rating)
        }
      }

      const awaitingRatingTicketIds = new Set<string>()
      if (feedbackRequestResult.status === 'fulfilled' && !feedbackRequestResult.value.error) {
        for (const row of (feedbackRequestResult.value.data ?? []) as Record<string, unknown>[]) {
          const ticketId = asString(row.maintenance_request_id)
          if (ticketId && !ratingByTicketId.has(ticketId)) {
            awaitingRatingTicketIds.add(ticketId)
          }
        }
      }

      const mapped: Conversation[] = scopedRows.flatMap((r) => {
        const id = asString(r.id)
        let resident = residentById.get(asString(r.resident_id))
        const phoneDigits = inboxPhoneDigits(asString(r.external_phone_number))
        if (!resident && phoneDigits) {
          const linked = linkConversationToRosterByPhone({
            externalPhone: asString(r.external_phone_number),
            residentByPhone,
            units: inventoryUnits,
          })
          if (linked) {
            resident = {
              name: linked.name,
              unit: linked.unitLabel,
              building: linked.building,
            }
          }
        }
        const unit = unitById.get(asString(r.unit_id))
        const ticketId = asString(r.maintenance_request_id)
        const vendorId = asString(r.vendor_id)
        const rosterNameFromId = vendorById.get(vendorId)
        const rosterNameFromPhone = phoneDigits ? vendorByPhone.get(phoneDigits) : undefined
        const residentName = resident?.name || ''
        const rosterNameFromResident =
          residentName ? vendorByName.get(residentName.toLowerCase()) : undefined
        const vendorName =
          rosterNameFromId || rosterNameFromPhone || rosterNameFromResident || ''
        const kind = inboxParticipantKind({
          conversationType: asString(r.conversation_type),
          hasVendorId: Boolean(vendorId),
          matchedVendorByPhone: Boolean(rosterNameFromPhone),
          matchedVendorByName: Boolean(rosterNameFromResident),
          hasVendorOnboardingCopy: vendorOnboardingCopyConversationIds.has(id),
        })
        const name =
          kind === 'ai'
            ? 'Ulo AI'
            : kind === 'landlord'
              ? landlordUpdateInboxDisplayName(landlordCompanyName)
              : kind === 'vendor'
                ? vendorName || 'Vendor'
                : residentName || asString(r.external_phone_number) || 'Unknown'

        const building = unit?.building || resident?.building || ''
        const unitLabel = unit?.label || resident?.unit || ''
        const context =
          kind === 'landlord'
            ? 'Ulo ↔ landlord'
            : [building, unitLabel ? `Unit ${unitLabel}` : '']
                .filter(Boolean)
                .join(' · ')

        const latest = latestMessageByConversation.get(id)
        // Resident repair ratings belong on the tenant SMS thread only. Vendor /
        // landlord threads often share the same ticket id and must not show
        // "Waiting for the tenant to rate…" as if that ask were on their thread.
        const showResidentRating =
          kind === 'tenant' &&
          conversationShowsResidentRepairRating(asString(r.conversation_type))
        const residentRating =
          showResidentRating && ticketId
            ? ratingByTicketId.get(ticketId) ?? null
            : null
        const awaitingRating = Boolean(
          showResidentRating && ticketId && awaitingRatingTicketIds.has(ticketId),
        )
        // Empty SMS shells (no messages) show "No messages yet" and crowd the
        // tip top-5 — hide them unless we have feedback/rating context to show.
        if (!latest && residentRating == null && !awaitingRating) return []
        const status = asString(r.status) || 'open'
        const statusLabel = conversationStatusLabel(
          asString(r.conversation_type),
          status,
          Boolean(ticketId),
          latest?.body,
          residentRating,
          awaitingRating,
        )
        const lastActivity =
          latest?.createdAt ?? new Date(asString(r.updated_at)).getTime()
        const activityLooksUnread =
          kind !== 'ai' &&
          (NEEDS_ATTENTION_STATUSES.has(status) ||
            (latest?.direction === 'inbound' && !CLOSED_STATUSES.has(status)))

        let preview = inboxPreviewForSmsMessage(latest?.body ?? '', latest?.mediaUrls)
        if (showResidentRating && residentRating != null) {
          preview = formatResidentFeedbackPreview(residentRating)
        } else if (
          showResidentRating &&
          (awaitingRating || (latest?.body && isResidentFeedbackAskBody(latest.body)))
        ) {
          preview = latest?.body && isResidentFeedbackAskBody(latest.body)
            ? latest.body
            : 'Waiting for the tenant to rate their repair (1–5).'
        } else if (
          showResidentRating &&
          latest?.body &&
          parseResidentFeedbackRatingBody(latest.body) != null
        ) {
          preview = formatResidentFeedbackPreview(
            parseResidentFeedbackRatingBody(latest.body) as number,
          )
        }

        return [
          {
            id,
            name,
            kind,
            context,
            preview,
            status: statusLabel,
            unread: isCommunicationConversationUnread({
              landlordId,
              conversationId: id,
              lastActivityMs: lastActivity,
              activityLooksUnread,
            }),
            unansweredLandlordMessages: unansweredByLandlordThread.get(id) ?? 0,
            lastActivity,
            threadLane: classifyLimitedAlphaMessageLane({
              hasMaintenanceRequest: Boolean(ticketId),
              hasOnboardingCopy: onboardingCopyConversationIds.has(id),
              hasNonOnboardingInbound: nonOnboardingInboundConversationIds.has(id),
            }),
          },
        ]
      })

      // Guided onboarding: never merge synthetic workflow / leftover import threads.
      const workOrderInboxRows = await workOrderInboxPromise
      if (cancelled) return

      const existingIds = new Set(mapped.map((entry) => entry.id))
      for (const workOrder of workOrderInboxRows) {
        if (existingIds.has(workOrder.id)) continue
        if (isCommunicationInboxIdDismissed(workOrder.id, landlordId)) continue
        if (workOrder.uloThread.conversationId && existingIds.has(workOrder.uloThread.conversationId)) {
          continue
        }

        mapped.push({
          id: workOrder.id,
          name: workOrder.name,
          kind: 'tenant',
          context: workOrder.context,
          preview: workOrder.preview,
          status: workOrder.status,
          unread: false,
          unansweredLandlordMessages: 0,
          lastActivity: workOrder.lastActivity,
          threadLane: classifyLimitedAlphaMessageLane({
            hasMaintenanceRequest: false,
            isWorkOrderInboxRow: true,
            hasOnboardingCopy: false,
            hasNonOnboardingInbound: false,
          }),
        })
        existingIds.add(workOrder.id)
      }

      for (const setup of listVendorSetupInboxEntries(landlordId)) {
        if (existingIds.has(setup.conversationId)) continue
        mapped.push({
          id: setup.conversationId,
          name: setup.vendorName,
          kind: 'vendor',
          context: vendorSetupInboxContext(setup.locationLabel),
          preview: setup.preview,
          status: vendorSetupInboxStatus(),
          unread: isCommunicationConversationUnread({
            landlordId,
            conversationId: setup.conversationId,
            lastActivityMs: setup.lastActivityMs,
            activityLooksUnread:
              /submitted|finished the vendor verification|form submitted/i.test(setup.preview),
          }),
          unansweredLandlordMessages: 0,
          lastActivity: setup.lastActivityMs,
          threadLane: classifyLimitedAlphaMessageLane({
            hasMaintenanceRequest: false,
            isVendorSetupInbox: true,
            hasOnboardingCopy: true,
            hasNonOnboardingInbound: false,
          }),
        })
        existingIds.add(setup.conversationId)
      }

      setConversations(mapped)
      setLoading(false)
      if (import.meta.env.DEV) {
        const elapsedMs =
          (typeof performance !== 'undefined' ? performance.now() : Date.now()) - loadStartedAt
        console.info(
          `[messages] inbox hydrate ${Math.round(elapsedMs)}ms threads=${mapped.length}`,
        )
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [])

  function openConversation(conversationId: string, messageId?: string) {
    const threadId = conversationId.trim()
    if (!threadId) return
    const landlordId = getActiveLandlordId()
    setConversations((prev) => {
      const row = prev.find((entry) => entry.id === threadId)
      const readAt = Math.max(Date.now(), row?.lastActivity ?? 0)
      markCommunicationConversationRead(landlordId, threadId, readAt)
      const wasUnread = Boolean(row?.unread)
      if (wasUnread) {
        setMetrics((metricsPrev) =>
          metricsPrev
            ? {
                ...metricsPrev,
                unreadMessages: Math.max(0, metricsPrev.unreadMessages - 1),
              }
            : metricsPrev,
        )
      }
      return prev.map((entry) =>
        entry.id === threadId ? { ...entry, unread: false } : entry,
      )
    })
    const nextMessageId = messageId?.trim() || ''
    const sameThread = searchParams.get('thread')?.trim() === threadId
    const sameMessage = (searchParams.get('msg')?.trim() || '') === nextMessageId
    if (sameThread && sameMessage) return
    setSearchParams(
      mutateSearchParams(searchParams, (next) => {
        next.set('thread', threadId)
        if (nextMessageId) next.set('msg', nextMessageId)
        else next.delete('msg')
      }),
      { replace: false },
    )
  }

  useEffect(() => {
    const thread = searchParams.get('thread')?.trim()
    if (!thread) return
    // Deep-link / history restore — mark read when ?thread= is present.
    const landlordId = getActiveLandlordId()
    setConversations((prev) => {
      const row = prev.find((entry) => entry.id === thread)
      if (!row) return prev
      const readAt = Math.max(Date.now(), row.lastActivity ?? 0)
      markCommunicationConversationRead(landlordId, thread, readAt)
      if (!row.unread) return prev
      setMetrics((metricsPrev) =>
        metricsPrev
          ? {
              ...metricsPrev,
              unreadMessages: Math.max(0, metricsPrev.unreadMessages - 1),
            }
          : metricsPrev,
      )
      return prev.map((entry) =>
        entry.id === thread ? { ...entry, unread: false } : entry,
      )
    })
  }, [searchParams])

  // Demo follows Limited Alpha Messages lanes; data stays on DEMO_LANDLORD_ID.
  const splitOnboardingFromRequests = landlordUsesLimitedAlphaSurface(getActiveLandlordId())

  const filtered = useMemo(() => {
    const sorted = [...conversations].sort((a, b) => b.lastActivity - a.lastActivity)
    return sorted.filter((conversation) =>
      conversationMatchesParticipantFilters(conversation, participantFilter),
    )
  }, [conversations, participantFilter])

  const onboardingThreads = useMemo(
    () => filtered.filter((c) => c.threadLane === 'onboarding'),
    [filtered],
  )
  const requestThreads = useMemo(
    () => filtered.filter((c) => c.threadLane === 'request'),
    [filtered],
  )
  const laneThreads =
    messageLaneTab === 'onboarding' ? onboardingThreads : requestThreads
  const visibleThreads = splitOnboardingFromRequests ? laneThreads : filtered
  const unreadThreadCount = visibleThreads.filter((conversation) => conversation.unread).length
  const needsYourResponseCount = conversations.reduce(
    (sum, conversation) => sum + conversation.unansweredLandlordMessages,
    0,
  )
  const shownThreads =
    metricFilter === 'needs'
      ? filtered.filter((conversation) => conversation.unansweredLandlordMessages > 0)
      : metricFilter
        ? visibleThreads.filter((conversation) => {
            if (metricFilter === 'unread') return conversation.unread
            return metricThreadIds.failed.has(conversation.id)
          })
        : visibleThreads
  function toggleConversationSelected(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAllFilteredSelected() {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      const allOn =
        shownThreads.length > 0 &&
        shownThreads.every((conversation) => next.has(conversation.id))
      if (allOn) {
        for (const conversation of shownThreads) next.delete(conversation.id)
      } else {
        for (const conversation of shownThreads) next.add(conversation.id)
      }
      return next
    })
  }

  async function deleteSelectedConversations() {
    if (selectedIds.size === 0) {
      setDeleteConfirmOpen(false)
      return
    }
    setDeleteError(null)
    setDeleteSaving(true)
    const idsToDelete = Array.from(selectedIds)
    const result = await deleteCommunicationConversationsForLandlord({
      conversationIds: idsToDelete,
    })
    if (!result.ok) {
      setDeleteError(result.error)
      setDeleteSaving(false)
      return
    }
    const remove = new Set(idsToDelete)
    setConversations((prev) => prev.filter((row) => !remove.has(row.id)))
    setSelectedIds(new Set())
    if (monitoringConversationId && remove.has(monitoringConversationId)) {
      closeMonitoring()
    }
    setDeleteSaving(false)
    setDeleteConfirmOpen(false)
  }

  useEffect(() => {
    if (!deleteConfirmOpen) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !deleteSaving) setDeleteConfirmOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [deleteConfirmOpen, deleteSaving])

  useEffect(() => {
    if (deleteConfirmOpen && selectedIds.size === 0) {
      setDeleteConfirmOpen(false)
    }
  }, [deleteConfirmOpen, selectedIds.size])

  const selectedCount = selectedIds.size
  const allFilteredSelected =
    (filtered.length > 0 && filtered.every((conversation) => selectedIds.has(conversation.id))) ||
    (shownThreads.length > 0 &&
      shownThreads.every((conversation) => selectedIds.has(conversation.id)))
  const someFilteredSelected =
    shownThreads.some((conversation) => selectedIds.has(conversation.id)) &&
    !allFilteredSelected

  return (
    <>
      {deleteConfirmOpen ? (
        <div className="fixed inset-0 z-[81] flex items-center justify-center bg-black/40 p-4">
          <div
            role="presentation"
            className="absolute inset-0"
            aria-hidden
            onClick={() => {
              if (!deleteSaving) setDeleteConfirmOpen(false)
            }}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={deleteConfirmTitleId}
            className="relative flex w-full max-w-[440px] flex-col overflow-hidden rounded-[10px] bg-white shadow-[0px_20px_25px_-5px_rgba(0,0,0,0.1),0px_8px_10px_-6px_rgba(0,0,0,0.1)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-b border-[#e5e7eb] px-6 py-4">
              <h2
                id={deleteConfirmTitleId}
                className="text-[18px] font-semibold leading-[27px] tracking-[-0.4395px] text-[#0a0a0a]"
              >
                Delete message threads?
              </h2>
            </div>
            <div className="px-6 py-5 text-[14px] leading-5 text-[#364153]">
              {selectedCount === 1
                ? 'This permanently removes the selected conversation and its SMS history from Messages.'
                : `This permanently removes ${selectedCount} conversations and their SMS history from Messages.`}
            </div>
            <div className="flex justify-end gap-2 border-t border-[#e5e7eb] px-6 py-4">
              <button
                type="button"
                disabled={deleteSaving}
                onClick={() => setDeleteConfirmOpen(false)}
                className="sa-press inline-flex h-9 items-center justify-center rounded-lg border border-black/10 bg-white px-3 text-[14px] font-medium text-[#0a0a0a] outline-none hover:bg-[#f3f4f6] focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deleteSaving}
                onClick={() => void deleteSelectedConversations()}
                className="sa-press inline-flex h-9 items-center justify-center rounded-lg bg-[#b52a00] px-3 text-[14px] font-medium text-white outline-none hover:bg-[#9a2400] focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
              >
                {deleteSaving ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

    <main className="flex min-h-0 flex-1 flex-col px-8 pb-12">
      {/*
        Tip step 6: one stable host from title through the first five threads.
        Dual KPI/threads targets kept settling on KPIs alone after route changes.
      */}
      <div
        id={TRY_DEMO_SPOTLIGHT_MESSAGES_KPI_ID}
        data-try-demo-spotlight-cluster="1"
        data-try-demo-messages-ready={loading ? '0' : '1'}
        data-try-demo-messages-rows={loading ? '0' : String(Math.min(5, shownThreads.length))}
      >
        <div className="py-6">
          <h1 className="text-[24px] font-semibold leading-8 tracking-[0.0703px] text-[#0a0a0a]">
            Messages
          </h1>
          <p className="text-[14px] leading-5 tracking-[-0.1504px] text-[#6a7282]">
            Review conversations and handle anything that needs your response.
          </p>
        </div>

        <div className="mb-6 grid grid-cols-2 gap-4 xl:grid-cols-4">
          {metrics == null || loading ? (
            <>
              <KpiCardSkeleton icon />
              <KpiCardSkeleton icon />
              <KpiCardSkeleton icon />
              <KpiCardSkeleton icon chevron={false} />
            </>
          ) : (
            <>
              <KpiCard
                label="Needs your response"
                value={String(needsYourResponseCount)}
                icon={needsYourResponseIcon}
                selected={metricFilter === 'needs'}
                onSelect={() => toggleMetricFilter('needs')}
                title="Each text from Ulo that asked for a reply and did not get one. A notice does not count."
              />
              <KpiCard
                label="Unread Messages"
                value={String(unreadThreadCount)}
                icon={unreadMessagesIcon}
                selected={metricFilter === 'unread'}
                onSelect={() => toggleMetricFilter('unread')}
              />
              <KpiCard
                label="Failed Deliveries"
                value={String(metrics.failedDeliveries)}
                icon={failedDeliveriesIcon}
                selected={metricFilter === 'failed'}
                onSelect={() => toggleMetricFilter('failed')}
              />
              <KpiCard
                label="Response Rate"
                value={metrics.responseRate == null ? '—' : `${metrics.responseRate}%`}
                icon={responseRateIcon}
                title={MESSAGE_RESPONSE_RATE_TOOLTIP}
              />
            </>
          )}
        </div>

        {error ? (
          <div className="mb-4 rounded-[10px] border border-[#fde68a] bg-[#fffbeb] px-4 py-3 text-[13px] text-[#92400e]">
            {error}
          </div>
        ) : null}
        {deleteError ? (
          <div className="mb-4 rounded-[10px] border border-[#fecaca] bg-[#fef2f2] px-4 py-3 text-[13px] text-[#b91c1c]">
            Could not delete selected conversations: {deleteError}
          </div>
        ) : null}

        <section
          className={[
            'sa-surface flex min-w-0 flex-col border border-[#e5e7eb] bg-white shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)]',
            !loading && shownThreads.length > 5
              ? 'rounded-t-[10px] rounded-b-none border-b-0'
              : 'rounded-[10px]',
          ].join(' ')}
        >
          {splitOnboardingFromRequests ? (
            <MessageLaneTabList
              active={messageLaneTab}
              onChange={setMessageLaneTab}
              requestCount={requestThreads.length}
              onboardingCount={onboardingThreads.length}
              participantFilter={participantFilter}
              onParticipantFilterChange={setParticipantFilter}
              metricFilter={metricFilter}
              onClearMetricFilter={clearMetricFilter}
              trailing={
                selectedCount > 0 ? (
                  <>
                    <span className="text-[13px] font-medium text-[#364153]">
                      {selectedCount} selected
                    </span>
                    <button
                      type="button"
                      disabled={deleteSaving}
                      onClick={() => setDeleteConfirmOpen(true)}
                      className="sa-press inline-flex h-8 items-center justify-center gap-2 rounded-lg border border-black/10 bg-white px-3 text-[13px] font-medium text-[#b52a00] outline-none hover:bg-[#f3f4f6] focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
                    >
                      <SelectionTrashIcon />
                      Delete
                    </button>
                    <button
                      type="button"
                      disabled={deleteSaving}
                      onClick={() => setSelectedIds(new Set())}
                      className="sa-press inline-flex h-8 items-center justify-center rounded-lg border border-black/10 bg-white px-3 text-[13px] font-medium text-[#0a0a0a] outline-none hover:bg-[#f3f4f6] focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
                    >
                      Clear
                    </button>
                  </>
                ) : null
              }
            />
          ) : (
            <div className="flex items-center gap-3 border-b border-[#e5e7eb] px-6 py-3">
              {metricFilter ? (
                <MessageMetricFilterChip filter={metricFilter} onClear={clearMetricFilter} />
              ) : null}
              <ParticipantFilterChip
                value={participantFilter}
                onChange={setParticipantFilter}
              />
              {selectedCount > 0 ? (
                <div className="ml-auto flex shrink-0 items-center gap-2">
                  <span className="text-[13px] font-medium text-[#364153]">
                    {selectedCount} selected
                  </span>
                  <button
                    type="button"
                    disabled={deleteSaving}
                    onClick={() => setDeleteConfirmOpen(true)}
                    className="sa-press inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-black/10 bg-white px-3 text-[14px] font-medium text-[#b52a00] outline-none hover:bg-[#f3f4f6] focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
                  >
                    <SelectionTrashIcon />
                    Delete
                  </button>
                  <button
                    type="button"
                    disabled={deleteSaving}
                    onClick={() => setSelectedIds(new Set())}
                    className="sa-press inline-flex h-9 items-center justify-center rounded-lg border border-black/10 bg-white px-3 text-[14px] font-medium text-[#0a0a0a] outline-none hover:bg-[#f3f4f6] focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
                  >
                    Clear
                  </button>
                </div>
              ) : null}
            </div>
          )}
          {metricFilter === 'needs' ? null : (
            <div className="flex items-center gap-3 border-b border-[#e5e7eb] px-6 py-2.5">
              <div className="flex size-9 items-center justify-center">
                <TableCheckbox
                  aria-label="Select all visible conversations"
                  disabled={loading || shownThreads.length === 0}
                  checked={allFilteredSelected}
                  indeterminate={someFilteredSelected}
                  onChange={toggleAllFilteredSelected}
                />
              </div>
              <span className="text-[12px] font-medium text-[#6a7282]">Select all</span>
            </div>
          )}

          <div className="divide-y divide-[#f3f4f6]">
            {loading ? (
              <p className="px-6 py-10 text-center text-[13px] text-[#6a7282]">Loading…</p>
            ) : metricFilter === 'needs' ? (
              responseTopics.length === 0 ? (
                <p className="px-6 py-8 text-center text-[13px] text-[#6a7282]">
                  Nothing is waiting for a reply.
                </p>
              ) : (
                <ol className="list-none">
                  {responseTopics.map((topic) => (
                    <li key={topic.key} className="border-b border-[#f3f4f6] last:border-b-0">
                      <button
                        type="button"
                        onClick={() => openConversation(topic.conversationId, topic.messageId)}
                        className="sa-press w-full px-6 py-3.5 text-left text-[14px] leading-5 text-[#0a0a0a] outline-none hover:bg-[#f9fafb] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#0030b5]"
                      >
                        {topic.summary}
                      </button>
                    </li>
                  ))}
                </ol>
              )
            ) : filtered.length === 0 ? (
              <div className="px-6 py-12 text-center">
                <p className="text-[14px] font-medium text-[#0a0a0a]">
                  {conversations.length === 0
                    ? 'No conversations yet.'
                    : 'Nothing matches this filter.'}
                </p>
                <p className="mt-1 text-[13px] text-[#6a7282]">
                  {conversations.length === 0
                    ? splitOnboardingFromRequests
                      ? 'Tenant onboarding and maintenance request threads will appear under their tabs.'
                      : 'Tenant and vendor messages will appear here as they come in.'
                    : 'Try a different filter to see more conversations.'}
                </p>
              </div>
            ) : splitOnboardingFromRequests && laneThreads.length === 0 ? (
              <p className="px-6 py-8 text-center text-[13px] text-[#6a7282]">
                {messageLaneTab === 'onboarding'
                  ? 'No onboarding threads.'
                  : 'No maintenance request threads.'}
              </p>
            ) : shownThreads.length === 0 ? (
              <p className="px-6 py-8 text-center text-[13px] text-[#6a7282]">
                No threads in this list match that metric.
              </p>
            ) : (
              shownThreads.slice(0, 5).map((c, index) => (
                <ConversationListRow
                  key={c.id}
                  conversation={c}
                  index={index}
                  selected={selectedIds.has(c.id)}
                  onToggleSelect={toggleConversationSelected}
                  onOpen={openConversation}
                />
              ))
            )}
          </div>
        </section>
      </div>

      {!loading && metricFilter !== 'needs' && shownThreads.length > 5 ? (
        <div className="sa-surface -mt-px flex min-w-0 flex-col rounded-b-[10px] rounded-t-none border border-t-0 border-[#e5e7eb] bg-white shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)]">
          <div className="divide-y divide-[#f3f4f6]">
            {shownThreads.slice(5).map((c, index) => (
              <ConversationListRow
                key={c.id}
                conversation={c}
                index={index + 5}
                selected={selectedIds.has(c.id)}
                onToggleSelect={toggleConversationSelected}
                onOpen={openConversation}
              />
            ))}
          </div>
        </div>
      ) : null}
      <ConversationMonitoringModal
        open={monitoringConversationId != null}
        conversationId={monitoringConversationId}
        headingName={monitoringHeadingName}
        focusMessageId={focusMessageId}
        onClose={closeMonitoring}
      />
    </main>
    </>
  )
}
