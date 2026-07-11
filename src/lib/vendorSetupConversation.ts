import type {
  ConversationMonitoringDetail,
  MonitoringTranscriptItem,
  VendorOutreachChannel,
} from '@/lib/conversationMonitoring'
import { hasVendorIntakeSubmission } from '@/lib/vendorIntakeForm'
import { markAdminPricingConfirmed } from '@/lib/vendorPricingConfirmation'
import { normIssueCategory } from '@/lib/vendorIssueCategory'
import {
  buildVendorVerificationEmail,
  buildVendorVerificationSms,
  vendorOutreachLocationPhrase,
  vendorSetupAdminHourlyRateConfirmationSms,
  vendorSetupEmailDeliveryLabel,
  vendorSetupEmailMonitoringSummary,
  vendorSetupEmailReadOnlyNote,
  vendorSetupInboxPreview,
  vendorSetupSmsDeliveryLabel,
  vendorSetupSmsMonitoringSummary,
  vendorSetupSmsReadOnlyNote,
} from '@/lib/vendorOutreachCopy'

export const VENDOR_SETUP_THREAD_ID_PREFIX = 'vendor-setup-'
const LEGACY_PRICING_THREAD_ID_PREFIX = 'vendor-pricing-'

export type VendorSetupThreadContext = {
  vendorName: string
  vendorPhone: string | null
  vendorEmail: string | null
  locationLabel: string
  tradeLabel: string
  sentAtMs?: number
}

export type VendorSetupInboxEntry = {
  conversationId: string
  vendorName: string
  vendorPhone: string | null
  locationLabel: string
  tradeLabel: string
  createdAtMs: number
  lastActivityMs: number
  preview: string
}

const CONTEXT_STORAGE_PREFIX = 'ulo.vendorSetupThread.'
const QUOTES_STORAGE_PREFIX = 'ulo.vendorSetupQuotes.'
const INBOX_STORAGE_KEY = 'ulo.vendorSetupInbox'
const TOKEN_STORAGE_PREFIX = 'ulo.vendorSetupIntakeToken.'

function stableKey(input: string): string {
  let hash = 0
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash + input.charCodeAt(i) * (i + 5)) % 10_000
  }
  return String(hash)
}

export function vendorEmailFromWebsite(website: string | null | undefined): string | null {
  if (!website?.trim()) return null
  const domain = website.replace(/^https?:\/\//i, '').split('/')[0]?.trim()
  if (!domain || !domain.includes('.')) return null
  return `office@${domain}`
}

function normalizeVendorPhone(phone: string | null | undefined): string {
  return (phone ?? '').replace(/\D/g, '') || 'unknown'
}

export function buildVendorSetupConversationId(context: VendorSetupThreadContext): string {
  const phone = normalizeVendorPhone(context.vendorPhone)
  return `${VENDOR_SETUP_THREAD_ID_PREFIX}${phone}-${stableKey(context.vendorName)}`
}

function tradeLabelFromIssueCategory(issueCategory: string | null | undefined): string {
  const n = normIssueCategory(issueCategory)
  if (!n) return 'MAINTENANCE'
  if (n === 'hvac') return 'HVAC'
  return n.replace(/_/g, ' ').toUpperCase()
}

export function buildVendorSetupContextFromExternalVendor(input: {
  vendorName: string
  vendorPhone: string | null
  vendorWebsite?: string | null
  locationLabel: string
  issueCategory?: string | null
}): VendorSetupThreadContext {
  return {
    vendorName: input.vendorName,
    vendorPhone: input.vendorPhone,
    vendorEmail: vendorEmailFromWebsite(input.vendorWebsite),
    locationLabel: input.locationLabel,
    tradeLabel: tradeLabelFromIssueCategory(input.issueCategory),
  }
}

/** True when setup outreach was sent and the vendor has not submitted the intake form yet. */
export function isVendorSetupAwaitingResponse(context: VendorSetupThreadContext): boolean {
  const conversationId = resolveVendorSetupConversationId(context)
  const hasThreadContext = readVendorSetupThreadContext(conversationId) != null
  const hasInboxEntry = readVendorSetupInbox().some(
    (entry) =>
      entry.vendorName === context.vendorName &&
      normalizeVendorPhone(entry.vendorPhone) === normalizeVendorPhone(context.vendorPhone) &&
      entry.locationLabel === context.locationLabel,
  )
  if (!hasThreadContext && !hasInboxEntry) return false
  return !hasVendorIntakeSubmission(conversationId)
}

type VendorSetupTokenSession = VendorSetupThreadContext & {
  conversationId: string
  token: string
}

function readVendorSetupTokenSession(context: VendorSetupThreadContext): VendorSetupTokenSession | null {
  const token = buildVendorSetupFormToken(context)
  return readJson<VendorSetupTokenSession>(`${TOKEN_STORAGE_PREFIX}${token}`)
}

/** Conversation id for the selected vendor — matches intake form submission + Communication inbox. */
export function resolveVendorSetupConversationId(context: VendorSetupThreadContext): string {
  const fromToken = readVendorSetupTokenSession(context)
  if (fromToken?.conversationId) return fromToken.conversationId

  const canonical = buildVendorSetupConversationId(context)
  if (readVendorSetupThreadContext(canonical)) return canonical

  const phone = normalizeVendorPhone(context.vendorPhone)
  const inboxMatch = readVendorSetupInbox().find(
    (entry) =>
      entry.vendorName === context.vendorName &&
      normalizeVendorPhone(entry.vendorPhone) === phone &&
      entry.locationLabel === context.locationLabel,
  )
  if (inboxMatch) return inboxMatch.conversationId

  return canonical
}

export function parseVendorSetupConversationId(conversationId: string): boolean {
  return (
    conversationId.startsWith(VENDOR_SETUP_THREAD_ID_PREFIX) ||
    conversationId.startsWith(LEGACY_PRICING_THREAD_ID_PREFIX)
  )
}

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* ignore */
  }
}

export function buildVendorSetupFormToken(context: VendorSetupThreadContext): string {
  return stableKey(`${context.vendorName}-${context.vendorPhone ?? 'unknown'}-${context.tradeLabel}`)
}

export function buildVendorSetupFormLink(context: VendorSetupThreadContext): string {
  const token = buildVendorSetupFormToken(context)
  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://onboard.ulo.app'
  return `${origin}/v/${token}`
}

export function buildVendorSetupSmsMessage(context: VendorSetupThreadContext): string {
  return buildVendorVerificationSms({
    vendorName: context.vendorName,
    tradeLabel: context.tradeLabel,
    locationLabel: context.locationLabel,
    formLink: buildVendorSetupFormLink(context),
  })
}

export function buildVendorSetupEmailMessage(context: VendorSetupThreadContext): string {
  return buildVendorVerificationEmail({
    vendorName: context.vendorName,
    tradeLabel: context.tradeLabel,
    locationLabel: context.locationLabel,
    formLink: buildVendorSetupFormLink(context),
  })
}

export function stashVendorSetupThreadContext(
  conversationId: string,
  context: VendorSetupThreadContext,
): void {
  writeJson(`${CONTEXT_STORAGE_PREFIX}${conversationId}`, context)
}

export function readVendorSetupThreadContext(conversationId: string): VendorSetupThreadContext | null {
  const stored = readJson<VendorSetupThreadContext>(`${CONTEXT_STORAGE_PREFIX}${conversationId}`)
  if (stored) return stored

  if (conversationId.startsWith(LEGACY_PRICING_THREAD_ID_PREFIX)) {
    try {
      const legacy = localStorage.getItem(`ulo.vendorPricingThread.${conversationId}`)
      if (legacy) return JSON.parse(legacy) as VendorSetupThreadContext
    } catch {
      /* ignore */
    }
  }

  return null
}

export function readVendorSetupLoggedQuotes(conversationId: string): MonitoringTranscriptItem[] {
  const stored =
    readJson<MonitoringTranscriptItem[]>(`${QUOTES_STORAGE_PREFIX}${conversationId}`) ??
    readJson<MonitoringTranscriptItem[]>(`ulo.vendorPricingQuotes.${conversationId}`)
  return stripLegacyVerbalQuoteAuditItems(stored ?? [])
}

function readVendorSetupInbox(): VendorSetupInboxEntry[] {
  const current = readJson<VendorSetupInboxEntry[]>(INBOX_STORAGE_KEY) ?? []
  const legacy = readJson<VendorSetupInboxEntry[]>('ulo.vendorPricingInbox') ?? []
  const byId = new Map<string, VendorSetupInboxEntry>()
  for (const row of [...legacy, ...current]) byId.set(row.conversationId, row)
  return [...byId.values()]
}

function writeVendorSetupInbox(entries: VendorSetupInboxEntry[]): void {
  writeJson(INBOX_STORAGE_KEY, entries)
}

export function upsertVendorSetupInboxEntry(entry: VendorSetupInboxEntry): void {
  const entries = readVendorSetupInbox().filter((row) => row.conversationId !== entry.conversationId)
  entries.push(entry)
  writeVendorSetupInbox(entries)
}

export function touchVendorSetupInboxActivity(
  conversationId: string,
  preview: string,
  lastActivityMs = Date.now(),
): void {
  const entries = readVendorSetupInbox()
  const index = entries.findIndex((row) => row.conversationId === conversationId)
  if (index < 0) return
  entries[index] = { ...entries[index], preview, lastActivityMs }
  writeVendorSetupInbox(entries)
}

/** Register vendor setup thread in Communication and persist context for review. */
export function registerVendorSetupConversation(
  context: VendorSetupThreadContext,
  options: { sentAtMs?: number } = {},
): string {
  const conversationId = buildVendorSetupConversationId(context)
  const existingContext = readVendorSetupThreadContext(conversationId)
  const sentAtMs =
    options.sentAtMs ??
    existingContext?.sentAtMs ??
    context.sentAtMs ??
    Date.now()
  const fullContext: VendorSetupThreadContext = { ...context, sentAtMs }
  stashVendorSetupThreadContext(conversationId, fullContext)

  const preview = vendorSetupInboxPreview(fullContext.locationLabel)
  const existing = readVendorSetupInbox().find((row) => row.conversationId === conversationId)
  upsertVendorSetupInboxEntry({
    conversationId,
    vendorName: context.vendorName,
    vendorPhone: context.vendorPhone,
    locationLabel: context.locationLabel,
    tradeLabel: context.tradeLabel,
    createdAtMs: existing?.createdAtMs ?? sentAtMs,
    lastActivityMs: sentAtMs,
    preview,
  })

  const token = buildVendorSetupFormToken(fullContext)
  writeJson(`${TOKEN_STORAGE_PREFIX}${token}`, {
    ...fullContext,
    conversationId,
    token,
  })

  return conversationId
}

export function listVendorSetupInboxEntries(): VendorSetupInboxEntry[] {
  return readVendorSetupInbox().sort((a, b) => b.lastActivityMs - a.lastActivityMs)
}

export function sortMonitoringTranscript(
  items: MonitoringTranscriptItem[],
): MonitoringTranscriptItem[] {
  return [...items].sort((a, b) => a.timestampMs - b.timestampMs)
}

const OUTREACH_DELIVERY_CHANNEL_RANK: Record<string, number> = {
  sms: 0,
  email: 1,
  grouped: 2,
}

/** Job invitation delivery rows always lead; remaining items sort by time. */
export function sortVendorSetupMonitoringTranscript(
  items: MonitoringTranscriptItem[],
): MonitoringTranscriptItem[] {
  const outreach: MonitoringTranscriptItem[] = []
  const rest: MonitoringTranscriptItem[] = []

  for (const item of items) {
    if (item.type === 'delivery_event') {
      outreach.push(item)
    } else {
      rest.push(item)
    }
  }

  outreach.sort((a, b) => {
    if (a.type !== 'delivery_event' || b.type !== 'delivery_event') return 0
    const rankA = OUTREACH_DELIVERY_CHANNEL_RANK[a.channel] ?? 99
    const rankB = OUTREACH_DELIVERY_CHANNEL_RANK[b.channel] ?? 99
    if (rankA !== rankB) return rankA - rankB
    return a.timestampMs - b.timestampMs
  })

  rest.sort((a, b) => a.timestampMs - b.timestampMs)
  return [...outreach, ...rest]
}

export function buildLoggedQuoteTranscriptItem(quote: string): MonitoringTranscriptItem {
  const trimmed = quote.trim()
  const timestampMs = Date.now()
  return {
    type: 'message',
    sender: 'ulo',
    senderName: 'Ulo',
    body: trimmed,
    timestampMs,
    outreachChannel: 'sms',
  }
}

export function appendVendorSetupLoggedQuote(
  conversationId: string,
  quote: string,
): MonitoringTranscriptItem {
  const item = buildLoggedQuoteTranscriptItem(quote)
  const next = [...readVendorSetupLoggedQuotes(conversationId), item]
  writeJson(`${QUOTES_STORAGE_PREFIX}${conversationId}`, next)
  const preview = quote.trim().slice(0, 96) || 'Follow-up sent'
  touchVendorSetupInboxActivity(conversationId, preview, item.timestampMs)
  return item
}

/** Landlord confirms submitted hourly rate — vendor gets an SMS-style thread message. */
export function confirmVendorSetupHourlyRate(
  conversationId: string,
  hourlyDisplay: string,
): MonitoringTranscriptItem {
  markAdminPricingConfirmed(conversationId)
  const body = vendorSetupAdminHourlyRateConfirmationSms(hourlyDisplay)
  return appendVendorSetupLoggedQuote(conversationId, body)
}

export function buildVendorSetupCommunicationPath(context: VendorSetupThreadContext): string {
  const threadId = registerVendorSetupConversation(context, {
    sentAtMs: context.sentAtMs ?? Date.now(),
  })
  return `/admin/communication?thread=${encodeURIComponent(threadId)}`
}

export function buildVendorSetupDeliveryTranscript(input: {
  sentAtMs: number
  smsBody: string
  emailBody: string
  smsSentAtMs?: number
  emailSentAtMs?: number
}): MonitoringTranscriptItem[] {
  const smsAt = input.smsSentAtMs ?? input.sentAtMs
  const emailAt = input.emailSentAtMs ?? input.sentAtMs

  return [
    {
      type: 'delivery_event',
      channel: 'sms',
      label: vendorSetupSmsDeliveryLabel(),
      body: input.smsBody,
      timestampMs: smsAt,
    },
    {
      type: 'delivery_event',
      channel: 'email',
      label: vendorSetupEmailDeliveryLabel(),
      body: input.emailBody,
      timestampMs: emailAt,
    },
  ]
}

export function filterVendorSetupTranscriptByChannel(
  transcript: MonitoringTranscriptItem[],
  channel: VendorOutreachChannel,
): MonitoringTranscriptItem[] {
  return transcript.flatMap((item) => {
    if (item.type === 'delivery_event') {
      if (item.channel === 'grouped') {
        const body = channel === 'sms' ? item.smsBody : item.emailBody
        if (!body?.trim()) return []
        return [
          {
            type: 'delivery_event' as const,
            channel,
            label:
              channel === 'sms'
                ? vendorSetupSmsDeliveryLabel()
                : vendorSetupEmailDeliveryLabel(),
            body,
            timestampMs: item.timestampMs,
          },
        ]
      }
      if (item.channel !== channel) return []
      return [item]
    }

    if (item.type === 'message' && item.sender === 'vendor') {
      return [item]
    }

    const itemChannel =
      item.type === 'message' || item.type === 'tool_action' ? item.outreachChannel : undefined
    if (itemChannel && itemChannel !== 'both' && itemChannel !== channel) return []
    return [item]
  })
}

export function isLegacyVerbalQuoteAuditItem(item: MonitoringTranscriptItem): boolean {
  return item.type === 'tool_action' && /verbal quote logged/i.test(item.label)
}

export function stripLegacyVerbalQuoteAuditItems(
  items: MonitoringTranscriptItem[],
): MonitoringTranscriptItem[] {
  return items.filter((item) => !isLegacyVerbalQuoteAuditItem(item))
}

export function buildVendorSetupMonitoringDetail(
  conversationId: string,
  context: VendorSetupThreadContext,
): ConversationMonitoringDetail {
  const inboxEntry = readVendorSetupInbox().find((row) => row.conversationId === conversationId)
  const sentAt =
    context.sentAtMs ?? inboxEntry?.createdAtMs ?? Date.now() - 2 * 60_000
  const phoneLabel = context.vendorPhone?.trim() || 'vendor phone on file'
  const emailLabel = context.vendorEmail?.trim() || 'vendor email on file'
  const smsBody = buildVendorSetupSmsMessage(context)
  const emailBody = buildVendorSetupEmailMessage(context)
  const areaPhrase = vendorOutreachLocationPhrase(context.locationLabel)

  const transcript = sortVendorSetupMonitoringTranscript(
    buildVendorSetupDeliveryTranscript({
      sentAtMs: sentAt,
      smsBody,
      emailBody,
    }),
  )

  return {
    conversationId,
    title: context.vendorName,
    subtitle: `New job · ${areaPhrase}`,
    riskLevel: null,
    riskLabel: null,
    summary: vendorSetupSmsMonitoringSummary(
      context.vendorName,
      phoneLabel,
      context.locationLabel,
    ),
    tenantName: context.vendorName,
    tenantInitials: context.vendorName
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? '')
      .join('') || 'V',
    transcript,
    readOnlyNote: vendorSetupSmsReadOnlyNote(),
    vendorOutreachChannels: {
      sms: {
        summary: vendorSetupSmsMonitoringSummary(
          context.vendorName,
          phoneLabel,
          context.locationLabel,
        ),
        readOnlyNote: vendorSetupSmsReadOnlyNote(),
      },
      email: {
        summary: vendorSetupEmailMonitoringSummary(
          context.vendorName,
          emailLabel,
          context.locationLabel,
        ),
        readOnlyNote: vendorSetupEmailReadOnlyNote(),
      },
    },
    canTakeOver: false,
  }
}

