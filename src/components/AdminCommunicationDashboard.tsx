import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ConversationMonitoringModal } from '@/components/ConversationMonitoringModal'
import { AdminFilterToolbar } from '@/components/AdminFilterToolbar'
import { isLimitedAlpha1Landlord } from '@shared/landlordCapabilities'
import { getActiveLandlordId } from '@/lib/activeLandlord'
import {
  isCommunicationConversationUnread,
  markCommunicationConversationRead,
} from '@/lib/communicationInboxRead'
import {
  formatResidentFeedbackPreview,
  isResidentFeedbackAskBody,
  isTenantOnboardingInvite,
  isVendorOnboardingInvite,
  parseResidentFeedbackRatingBody,
} from '@/lib/conversationMonitoring'
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
import { isCommunicationInboxConversationType } from '@/lib/propertyConversations'
import { inboxPreviewForSmsMessage } from '@/lib/smsMedia'
import { supabase } from '@/lib/supabase'

type ParticipantKind = 'tenant' | 'vendor' | 'ai' | 'landlord'

type Conversation = {
  id: string
  name: string
  kind: ParticipantKind
  context: string
  preview: string
  status: string
  unread: boolean
  lastActivity: number
  threadLane: LimitedAlphaMessageLane
}

type CommMetrics = {
  openConversations: number
  unreadMessages: number
  failedDeliveries: number
  responseRate: number | null
  openDelta: number | null
  unreadDelta: number | null
  failedDelta: number | null
  responseRateDelta: number | null
  lastUpdated: Date
}

type ConvSnapshot = {
  id: string
  status: string
  createdAtMs: number
  updatedAtMs: number
}

type MessageSnapshot = {
  conversationId: string
  direction: string
  providerStatus: string
  createdAtMs: number
}

const KIND_BADGE: Record<ParticipantKind, { label: string; className: string }> = {
  tenant: { label: 'TENANT', className: 'bg-[#dbeafe] text-[#1447e6]' },
  vendor: { label: 'VENDOR', className: 'bg-[#f3f4f6] text-[#364153]' },
  ai: { label: 'AI', className: 'bg-[#f3e8ff] text-[#7c3aed]' },
  landlord: { label: 'OWNER', className: 'bg-[#dbfce7] text-[#008236]' },
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

function conversationKind(
  conversationType: string,
  hasVendor: boolean,
): ParticipantKind {
  switch (conversationType) {
    case 'ai_copilot':
      return 'ai'
    case 'vendor_alert':
      return 'vendor'
    case 'landlord_update':
      return 'landlord'
    case 'vendor_tenant_proxy':
      return hasVendor ? 'vendor' : 'tenant'
    case 'resident_intake':
    default:
      return 'tenant'
  }
}

// Statuses that count as needing attention (unread dot), and ones that are done.
const NEEDS_ATTENTION_STATUSES = new Set([
  'open',
  'unread',
  'new',
  'action_required',
])
const CLOSED_STATUSES = new Set([
  'completed',
  'resolved',
  'closed',
  'scheduled',
  'cancelled',
])

// Provider delivery statuses (Twilio / Telnyx / email) that mean "not delivered".
function isFailedDelivery(providerStatus: string): boolean {
  const s = providerStatus.toLowerCase()
  if (!s) return false
  return (
    s.includes('fail') ||
    s.includes('undeliver') ||
    s.includes('bounce') ||
    s.includes('reject') ||
    s === 'error'
  )
}

function parseMs(value: string): number {
  const ms = Date.parse(value)
  return Number.isNaN(ms) ? 0 : ms
}

function wasOpenAt(conv: ConvSnapshot, atMs: number): boolean {
  if (conv.createdAtMs > atMs) return false
  if (!CLOSED_STATUSES.has(conv.status)) return true
  return conv.updatedAtMs > atMs
}

function latestDirectionAt(messages: MessageSnapshot[] | undefined, atMs: number): string | null {
  if (!messages?.length) return null
  for (const message of messages) {
    if (message.createdAtMs <= atMs) return message.direction
  }
  return null
}

function snapshotAt(
  conversations: ConvSnapshot[],
  messagesByConv: Map<string, MessageSnapshot[]>,
  atMs: number,
): { open: number; unread: number } {
  let open = 0
  let unread = 0
  for (const conv of conversations) {
    if (!wasOpenAt(conv, atMs)) continue
    open += 1
    if (latestDirectionAt(messagesByConv.get(conv.id), atMs) === 'inbound') unread += 1
  }
  return { open, unread }
}

function failedInWindow(messages: MessageSnapshot[], startMs: number, endMs: number): number {
  let count = 0
  for (const message of messages) {
    if (message.createdAtMs < startMs || message.createdAtMs >= endMs) continue
    if (isFailedDelivery(message.providerStatus)) count += 1
  }
  return count
}

function responseRateAt(
  conversations: ConvSnapshot[],
  messagesByConv: Map<string, MessageSnapshot[]>,
  atMs: number,
): number | null {
  let total = 0
  let replied = 0
  for (const conv of conversations) {
    if (conv.createdAtMs > atMs) continue
    const msgs = messagesByConv.get(conv.id)
    if (!msgs?.length) continue
    let hasMessage = false
    let hasOutbound = false
    for (const message of msgs) {
      if (message.createdAtMs > atMs) continue
      hasMessage = true
      if (message.direction === 'outbound') hasOutbound = true
    }
    if (!hasMessage) continue
    total += 1
    if (hasOutbound) replied += 1
  }
  if (total === 0) return null
  return Math.round((replied / total) * 100)
}

function formatUpdatedAt(date: Date): string {
  const startOfToday = new Date()
  startOfToday.setHours(0, 0, 0, 0)
  if (date >= startOfToday) {
    return `Updated ${date.toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
    })}`
  }
  const startOfYesterday = new Date(startOfToday)
  startOfYesterday.setDate(startOfYesterday.getDate() - 1)
  if (date >= startOfYesterday) return 'Updated yesterday'
  return `Updated ${date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  })}`
}

function formatSignedPercent(delta: number): string {
  const sign = delta > 0 ? '+' : delta < 0 ? '-' : ''
  return `${sign}${Math.abs(delta)}%`
}

function TrendingUpIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="size-4">
      <path d="M3 17l6-6 4 4 8-8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M15 7h6v6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function TrendingDownIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="size-4">
      <path d="M3 7l6 6 4-4 8 8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M15 17h6v-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function KpiCard({
  label,
  value,
  delta,
  deltaSuffix = '',
  deltaFormatter,
  goodWhenUp = false,
  caption,
}: {
  label: string
  value: string
  delta: number | null
  deltaSuffix?: string
  deltaFormatter?: (delta: number) => string
  goodWhenUp?: boolean
  caption: string
}) {
  const positive = (delta ?? 0) > 0
  const neutral = delta === 0
  const good = neutral ? false : positive === goodWhenUp
  return (
    <div className="sa-enter-scale flex min-w-0 flex-1 flex-col gap-4 rounded-[10px] border border-[#e5e7eb] bg-white p-6 shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)]">
      <p className="truncate text-[14px] leading-5 tracking-[-0.1504px] text-[#6a7282]">
        {label}
      </p>
      <div className="flex items-end justify-between gap-2">
        <p className="text-[36px] font-bold leading-none tracking-[0.4px] text-[#0a0a0a] tabular-nums xl:text-[44px]">
          {value}
        </p>
        {delta != null ? (
          <span
            className={[
              'flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[14px] leading-5 tracking-[-0.1504px]',
              neutral
                ? 'bg-[#f3f4f6] text-[#6a7282]'
                : good
                  ? 'bg-[rgba(16,185,129,0.08)] text-[#008236] [&>svg]:text-[#10b981]'
                  : 'bg-[rgba(255,83,83,0.08)] text-[#c10007] [&>svg]:text-[#fb2c36]',
            ].join(' ')}
          >
            {neutral ? null : positive ? <TrendingUpIcon /> : <TrendingDownIcon />}
            {deltaFormatter
              ? deltaFormatter(delta ?? 0)
              : positive
                ? `+${delta}${deltaSuffix}`
                : `${delta}${deltaSuffix}`}
          </span>
        ) : null}
      </div>
      <p className="text-[12px] leading-4 text-[#6a7282]">{caption}</p>
    </div>
  )
}

function KpiCardSkeleton() {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-4 rounded-[10px] border border-[#e5e7eb] bg-white p-6 shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)]">
      <div className="h-4 w-28 animate-pulse rounded bg-[#f3f4f6]" />
      <div className="h-10 w-20 animate-pulse rounded bg-[#f3f4f6]" />
      <div className="h-3 w-32 animate-pulse rounded bg-[#f3f4f6]" />
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

type ParticipantFilterKey = 'tenant' | 'vendor'

const PARTICIPANT_FILTER_OPTIONS: { id: ParticipantFilterKey; label: string }[] = [
  { id: 'tenant', label: 'Tenant' },
  { id: 'vendor', label: 'Vendor' },
]

function conversationMatchesParticipantFilters(
  conversation: Conversation,
  filters: Set<ParticipantFilterKey>,
): boolean {
  if (filters.size === 0) return true
  if (filters.has('tenant') && conversation.kind === 'tenant') return true
  if (filters.has('vendor') && conversation.kind === 'vendor') return true
  return false
}

function ConversationListRow({
  conversation: c,
  index,
  onOpen,
}: {
  conversation: Conversation
  index: number
  onOpen: (id: string) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen(c.id)}
      style={{ animationDelay: `${Math.min(index, 10) * 35}ms` }}
      className="sa-enter sa-row flex w-full items-start gap-3 px-6 py-4 text-left hover:bg-[#f9fafb]"
    >
      <span className="relative flex shrink-0 items-center pt-0.5">
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

      <div className="flex shrink-0 flex-col items-end gap-1 pl-2">
        <span className="text-[12px] leading-4 text-[#6a7282]">
          {formatRelativeTime(c.lastActivity)}
        </span>
        {c.status ? (
          <span className="text-[12px] leading-4 text-[#6a7282]">{c.status}</span>
        ) : null}
      </div>
    </button>
  )
}

function MessageLaneSection({
  title,
  description,
  rows,
  empty,
  indexOffset,
  onOpen,
}: {
  title: string
  description: string
  rows: Conversation[]
  empty: string
  indexOffset: number
  onOpen: (id: string) => void
}) {
  return (
    <>
      <div className="bg-[#f9fafb] px-6 py-3">
        <h2 className="text-[13px] font-semibold tracking-[0.02em] text-[#0a0a0a]">{title}</h2>
        <p className="mt-0.5 text-[12px] leading-4 text-[#6a7282]">{description}</p>
      </div>
      {rows.length === 0 ? (
        <p className="px-6 py-8 text-center text-[13px] text-[#6a7282]">{empty}</p>
      ) : (
        rows.map((c, index) => (
          <ConversationListRow
            key={c.id}
            conversation={c}
            index={indexOffset + index}
            onOpen={onOpen}
          />
        ))
      )}
    </>
  )
}

export function AdminCommunicationDashboard() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [metrics, setMetrics] = useState<CommMetrics | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [participantFilters, setParticipantFilters] = useState<Set<ParticipantFilterKey>>(
    () => new Set(),
  )
  const [monitoringConversationId, setMonitoringConversationId] = useState<string | null>(null)

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
      const landlordId = getActiveLandlordId()

      // Strict rule: guided New Landlord only surfaces portfolio-matched threads.
      const dashboardSync = await ensureOnboardingDashboardMatchesPortfolio(landlordId)
      if (cancelled) return
      const allowImportedOperations = dashboardSync.allowImportedOperations

      // KPI metrics — scoped to the active landlord, computed from the full
      // conversation/message history (not just the 50-row inbox window).
      void (async () => {
        if (!supabase) return
        const [allConvResult, allMsgResult] = await Promise.allSettled([
          supabase
            .from('sms_conversations')
            .select('id, status, created_at, updated_at')
            .eq('landlord_id', landlordId)
            .limit(2000),
          supabase
            .from('sms_messages')
            .select('conversation_id, direction, provider_status, created_at')
            .eq('landlord_id', landlordId)
            .order('created_at', { ascending: false })
            .limit(5000),
        ])

        if (cancelled) return

        const now = Date.now()
        const fourWeeksMs = 28 * 24 * 60 * 60 * 1000
        const recentStart = now - fourWeeksMs
        const previousStart = now - 2 * fourWeeksMs

        const conversations: ConvSnapshot[] = []
        const convStatusById = new Map<string, string>()
        if (allConvResult.status === 'fulfilled' && !allConvResult.value.error) {
          for (const raw of (allConvResult.value.data ?? []) as Record<string, unknown>[]) {
            const id = asString(raw.id)
            if (!id) continue
            const status = asString(raw.status) || 'open'
            convStatusById.set(id, status)
            conversations.push({
              id,
              status,
              createdAtMs: parseMs(asString(raw.created_at)),
              updatedAtMs: parseMs(asString(raw.updated_at) || asString(raw.created_at)),
            })
          }
        }

        const messages: MessageSnapshot[] = []
        const messagesByConv = new Map<string, MessageSnapshot[]>()
        const latestDirectionByConv = new Map<string, string>()
        const repliedConversations = new Set<string>()
        let failedDeliveries = 0
        if (allMsgResult.status === 'fulfilled' && !allMsgResult.value.error) {
          for (const raw of (allMsgResult.value.data ?? []) as Record<string, unknown>[]) {
            const convId = asString(raw.conversation_id)
            const direction = asString(raw.direction)
            const providerStatus = asString(raw.provider_status)
            const createdAtMs = parseMs(asString(raw.created_at))
            const message: MessageSnapshot = {
              conversationId: convId,
              direction,
              providerStatus,
              createdAtMs,
            }
            messages.push(message)
            if (isFailedDelivery(providerStatus)) failedDeliveries += 1
            if (!convId) continue
            if (!latestDirectionByConv.has(convId)) latestDirectionByConv.set(convId, direction)
            if (direction === 'outbound') repliedConversations.add(convId)
            const bucket = messagesByConv.get(convId) ?? []
            bucket.push(message)
            messagesByConv.set(convId, bucket)
          }
        }

        const totalConversations = convStatusById.size
        let openConversations = 0
        let unreadMessages = 0
        for (const [id, status] of convStatusById) {
          const closed = CLOSED_STATUSES.has(status)
          if (!closed) openConversations += 1
          const latest = messagesByConv.get(id)?.[0]
          const lastActivityMs = latest?.createdAtMs ?? 0
          const activityLooksUnread =
            latest?.direction === 'inbound' && !closed
          if (
            isCommunicationConversationUnread({
              landlordId,
              conversationId: id,
              lastActivityMs,
              activityLooksUnread,
            })
          ) {
            unreadMessages += 1
          }
        }

        let repliedCount = 0
        for (const id of repliedConversations) {
          if (convStatusById.has(id)) repliedCount += 1
        }

        const currentSnapshot = snapshotAt(conversations, messagesByConv, now)
        const previousSnapshot = snapshotAt(conversations, messagesByConv, recentStart)
        const recentFailed = failedInWindow(messages, recentStart, now)
        const previousFailed = failedInWindow(messages, previousStart, recentStart)
        const currentResponseRate = responseRateAt(conversations, messagesByConv, now)
        const previousResponseRate = responseRateAt(conversations, messagesByConv, recentStart)

        setMetrics({
          openConversations,
          unreadMessages,
          failedDeliveries,
          responseRate:
            totalConversations > 0
              ? Math.round((repliedCount / totalConversations) * 100)
              : null,
          openDelta: currentSnapshot.open - previousSnapshot.open,
          unreadDelta: currentSnapshot.unread - previousSnapshot.unread,
          failedDelta: recentFailed - previousFailed,
          responseRateDelta:
            currentResponseRate != null
              ? currentResponseRate - (previousResponseRate ?? 0)
              : null,
          lastUpdated: new Date(),
        })
      })()

      const { data: convRows, error: convError } = await supabase
        .from('sms_conversations')
        .select(
          'id, conversation_type, status, external_phone_number, unit_id, resident_id, vendor_id, maintenance_request_id, updated_at, created_at',
        )
        .eq('landlord_id', landlordId)
        .order('updated_at', { ascending: false })
        .limit(50)

      if (cancelled) return

      if (convError) {
        console.error('[admin communication] sms_conversations fetch failed', convError.message)
        setConversations([])
        setLoading(false)
        return
      }

      const rows = ((convRows ?? []).filter((row) =>
        isCommunicationInboxConversationType(
          asString((row as Record<string, unknown>).conversation_type),
        ),
      ) as Record<string, unknown>[])

      // Fail-closed for guided: only conversations tied to this landlord's residents/vendors.
      let scopedRows = rows
      if (!allowImportedOperations) {
        const [portfolioResidents, portfolioVendors] = await Promise.all([
          supabase.from('users').select('id, phone').eq('landlord_id', landlordId).limit(2000),
          supabase.from('vendors').select('id, phone').eq('landlord_id', landlordId).limit(500),
        ])
        if (cancelled) return
        const allowedResidentIds = new Set(
          (portfolioResidents.data ?? []).map((r) => asString((r as { id: string }).id)).filter(Boolean),
        )
        const allowedVendorIds = new Set(
          (portfolioVendors.data ?? []).map((r) => asString((r as { id: string }).id)).filter(Boolean),
        )
        const allowedPhones = new Set<string>()
        for (const r of portfolioResidents.data ?? []) {
          const digits = asString((r as { phone?: string }).phone).replace(/\D/g, '')
          if (digits) allowedPhones.add(digits)
        }
        for (const v of portfolioVendors.data ?? []) {
          const digits = asString((v as { phone?: string }).phone).replace(/\D/g, '')
          if (digits) allowedPhones.add(digits)
        }
        scopedRows = rows.filter((r) => {
          const residentId = asString(r.resident_id)
          const vendorId = asString(r.vendor_id)
          const phone = asString(r.external_phone_number).replace(/\D/g, '')
          if (residentId && allowedResidentIds.has(residentId)) return true
          if (vendorId && allowedVendorIds.has(vendorId)) return true
          if (phone && allowedPhones.has(phone)) return true
          return false
        })
      }

      const conversationIds = scopedRows.map((r) => asString(r.id)).filter(Boolean)
      const residentIds = [
        ...new Set(scopedRows.map((r) => asString(r.resident_id)).filter(Boolean)),
      ]
      const vendorIds = [
        ...new Set(scopedRows.map((r) => asString(r.vendor_id)).filter(Boolean)),
      ]
      const unitIds = [...new Set(scopedRows.map((r) => asString(r.unit_id)).filter(Boolean))]
      const ticketIds = [
        ...new Set(scopedRows.map((r) => asString(r.maintenance_request_id)).filter(Boolean)),
      ]

      const [messagesResult, residentsResult, vendorsResult, unitsResult, feedbackResult, feedbackRequestResult] =
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
          vendorIds.length
            ? supabase
                .from('vendors')
                .select('id, name')
                .eq('landlord_id', landlordId)
                .in('id', vendorIds)
            : Promise.resolve({ data: [], error: null }),
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
        ])

      if (cancelled) return

      const latestMessageByConversation = new Map<
        string,
        { body: string; direction: string; createdAt: number; mediaUrls: unknown }
      >()
      const onboardingCopyConversationIds = new Set<string>()
      const nonOnboardingInboundConversationIds = new Set<string>()
      if (messagesResult.status === 'fulfilled' && !messagesResult.value.error) {
        for (const m of (messagesResult.value.data ?? []) as Record<string, unknown>[]) {
          const convId = asString(m.conversation_id)
          if (!convId) continue
          const body = asString(m.body)
          const direction = asString(m.direction)
          if (isTenantOnboardingInvite(body) || isVendorOnboardingInvite(body)) {
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
      if (vendorsResult.status === 'fulfilled' && !vendorsResult.value.error) {
        for (const v of (vendorsResult.value.data ?? []) as Record<string, unknown>[]) {
          vendorById.set(asString(v.id), asString(v.name))
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

      const mapped: Conversation[] = scopedRows.map((r) => {
        const id = asString(r.id)
        const resident = residentById.get(asString(r.resident_id))
        const vendorName = vendorById.get(asString(r.vendor_id))
        const unit = unitById.get(asString(r.unit_id))
        const ticketId = asString(r.maintenance_request_id)
        const kind = conversationKind(
          asString(r.conversation_type),
          Boolean(asString(r.vendor_id)),
        )
        const name =
          kind === 'ai'
            ? 'Ulo AI'
            : kind === 'vendor'
              ? vendorName || 'Vendor'
              : resident?.name || asString(r.external_phone_number) || 'Unknown'

        const building = unit?.building || resident?.building || ''
        const unitLabel = unit?.label || resident?.unit || ''
        const context = [building, unitLabel ? `Unit ${unitLabel}` : '']
          .filter(Boolean)
          .join(' · ')

        const latest = latestMessageByConversation.get(id)
        const residentRating = ticketId ? ratingByTicketId.get(ticketId) ?? null : null
        const awaitingRating = Boolean(ticketId && awaitingRatingTicketIds.has(ticketId))
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
        if (residentRating != null) {
          preview = formatResidentFeedbackPreview(residentRating)
        } else if (awaitingRating || (latest?.body && isResidentFeedbackAskBody(latest.body))) {
          preview = latest?.body && isResidentFeedbackAskBody(latest.body)
            ? latest.body
            : 'Waiting for the tenant to rate their repair (1–5).'
        } else if (latest?.body && parseResidentFeedbackRatingBody(latest.body) != null) {
          preview = formatResidentFeedbackPreview(
            parseResidentFeedbackRatingBody(latest.body) as number,
          )
        }

        return {
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
          lastActivity,
          threadLane: classifyLimitedAlphaMessageLane({
            hasMaintenanceRequest: Boolean(ticketId),
            hasOnboardingCopy: onboardingCopyConversationIds.has(id),
            hasNonOnboardingInbound: nonOnboardingInboundConversationIds.has(id),
          }),
        }
      })

      // Guided onboarding: never merge synthetic workflow / leftover import threads.
      const workOrderInboxRows = allowImportedOperations
        ? await fetchCommunicationWorkOrderInboxRows().catch(() => [])
        : []
      if (cancelled) return

      const existingIds = new Set(mapped.map((entry) => entry.id))
      for (const workOrder of workOrderInboxRows) {
        if (existingIds.has(workOrder.id)) continue
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
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [])

  function openConversation(conversationId: string) {
    const landlordId = getActiveLandlordId()
    setConversations((prev) => {
      const row = prev.find((entry) => entry.id === conversationId)
      const readAt = Math.max(Date.now(), row?.lastActivity ?? 0)
      markCommunicationConversationRead(landlordId, conversationId, readAt)
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
        entry.id === conversationId ? { ...entry, unread: false } : entry,
      )
    })
    setMonitoringConversationId(conversationId)
  }

  useEffect(() => {
    const thread = searchParams.get('thread')?.trim()
    if (!thread) return
    openConversation(thread)
    // Deep-link open only — mark read when ?thread= is present.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  const splitOnboardingFromRequests = isLimitedAlpha1Landlord(getActiveLandlordId())

  const filtered = useMemo(() => {
    const sorted = [...conversations].sort((a, b) => b.lastActivity - a.lastActivity)
    return sorted.filter((conversation) =>
      conversationMatchesParticipantFilters(conversation, participantFilters),
    )
  }, [conversations, participantFilters])

  const onboardingThreads = useMemo(
    () => filtered.filter((c) => c.threadLane === 'onboarding'),
    [filtered],
  )
  const requestThreads = useMemo(
    () => filtered.filter((c) => c.threadLane === 'request'),
    [filtered],
  )

  function toggleParticipantFilter(key: ParticipantFilterKey) {
    setParticipantFilters((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const updatedCaption = metrics ? formatUpdatedAt(metrics.lastUpdated) : 'Updating…'

  return (
    <main className="flex min-h-0 flex-1 flex-col px-8 pb-12">
      <div className="py-6">
        <h1 className="text-[24px] font-semibold leading-8 tracking-[0.0703px] text-[#0a0a0a]">
          Messages
        </h1>
        <p className="text-[14px] leading-5 tracking-[-0.1504px] text-[#6a7282]">
          {splitOnboardingFromRequests
            ? 'Onboarding texts are listed separately from maintenance request threads.'
            : 'See all resident and vendor conversations in one place.'}
        </p>
      </div>

      {error ? (
        <div className="mb-4 rounded-[10px] border border-[#fde68a] bg-[#fffbeb] px-4 py-3 text-[13px] text-[#92400e]">
          {error}
        </div>
      ) : null}

      <div className="mb-6 grid grid-cols-2 gap-4 xl:grid-cols-4">
        {metrics == null ? (
          <>
            <KpiCardSkeleton />
            <KpiCardSkeleton />
            <KpiCardSkeleton />
            <KpiCardSkeleton />
          </>
        ) : (
          <>
            <KpiCard
              label="Open Conversations"
              value={String(metrics.openConversations)}
              delta={metrics.openDelta}
              goodWhenUp={false}
              caption={`Compared to 4 weeks ago · ${updatedCaption}`}
            />
            <KpiCard
              label="Unread Messages"
              value={String(metrics.unreadMessages)}
              delta={metrics.unreadDelta}
              goodWhenUp={false}
              caption={`Compared to 4 weeks ago · ${updatedCaption}`}
            />
            <KpiCard
              label="Failed Deliveries"
              value={String(metrics.failedDeliveries)}
              delta={metrics.failedDelta}
              goodWhenUp={false}
              caption={`vs previous 4 weeks · ${updatedCaption}`}
            />
            <KpiCard
              label="Response Rate"
              value={metrics.responseRate == null ? '—' : `${metrics.responseRate}%`}
              delta={metrics.responseRateDelta}
              deltaFormatter={formatSignedPercent}
              goodWhenUp={true}
              caption={`Compared to 4 weeks ago · ${updatedCaption}`}
            />
          </>
        )}
      </div>

      <section className="sa-surface flex min-w-0 flex-col rounded-[10px] border border-[#e5e7eb] bg-white shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)]">
        <AdminFilterToolbar
          options={PARTICIPANT_FILTER_OPTIONS}
          activeFilters={participantFilters}
          onToggle={toggleParticipantFilter}
          onClear={() => setParticipantFilters(new Set())}
        />

        <div className="divide-y divide-[#f3f4f6]">
          {loading ? (
            <p className="px-6 py-10 text-center text-[13px] text-[#6a7282]">Loading…</p>
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
                    ? 'Tenant onboarding and maintenance request threads will appear in separate sections.'
                    : 'Tenant and vendor messages will appear here as they come in.'
                  : 'Try a different filter to see more conversations.'}
              </p>
            </div>
          ) : splitOnboardingFromRequests ? (
            <>
              <MessageLaneSection
                title="Onboarding"
                description="Welcome texts and verification invites."
                rows={onboardingThreads}
                empty="No onboarding threads."
                indexOffset={0}
                onOpen={openConversation}
              />
              <MessageLaneSection
                title="Requests"
                description="Maintenance and work-order SMS."
                rows={requestThreads}
                empty="No maintenance request threads."
                indexOffset={onboardingThreads.length}
                onOpen={openConversation}
              />
            </>
          ) : (
            filtered.map((c, index) => (
              <ConversationListRow
                key={c.id}
                conversation={c}
                index={index}
                onOpen={openConversation}
              />
            ))
          )}
        </div>
      </section>
      <ConversationMonitoringModal
        open={monitoringConversationId != null}
        conversationId={monitoringConversationId}
        onClose={() => {
          setMonitoringConversationId(null)
          if (searchParams.get('thread')) {
            const next = new URLSearchParams(searchParams)
            next.delete('thread')
            setSearchParams(next, { replace: true })
          }
        }}
      />
    </main>
  )
}
