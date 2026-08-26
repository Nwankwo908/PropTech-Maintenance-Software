import { formatEmergencyCurrency } from '@/lib/emergencyApprovalReview'
import { formatVendorTradeLabel } from '@/lib/vendorTrades'

export type VendorChatMessage = {
  id: string
  sender: 'vendor' | 'landlord' | 'ai'
  body: string
  timeLabel: string
  aiLabel?: string
  timestampMs?: number
}

export type VendorNegotiationBrief = {
  ticketId: string
  vendorName: string
  vendorInitials: string
  contextLine: string
  quoteAmount: number
  marketMedian: number
  targetPrice: number
  walkAwayPrice: number
  leverageSummary: string
  messages: VendorChatMessage[]
  suggestedReplies: string[]
  canSend: boolean
  sendBlockedReason: string | null
}

type TicketLike = {
  id: string
  unit: string
  building: string | null
  issueCategory: string | null
  totalCost?: number | null
  laborCost?: number | null
  materialCost?: number | null
  assignedVendorId?: string | null
}

export type VendorThreadMessageInput = {
  id?: string
  sender: 'vendor' | 'landlord' | 'ulo' | 'tenant'
  body: string
  timestampMs?: number
}

export type BuildVendorNegotiationBriefOptions = {
  vendorName?: string | null
  /** Real vendor job SMS transcript (oldest → newest). */
  threadMessages?: VendorThreadMessageInput[]
  /** Pending estimate total when ticket costs are empty. */
  pendingQuoteAmount?: number | null
}

function formatLocation(building: string | null, unit: string): string {
  const shortBuilding = building?.replace(/\s+Apartments$/i, '').trim() || 'Property'
  return `${shortBuilding} · ${unit}`
}

function formatCategoryLabel(category: string | null): string {
  return formatVendorTradeLabel(category, { emptyLabel: 'Maintenance' })
}

function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return 'VN'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return `${parts[0][0] ?? ''}${parts[1][0] ?? ''}`.toUpperCase()
}

function formatMessageTime(timestampMs?: number): string {
  if (typeof timestampMs !== 'number' || Number.isNaN(timestampMs)) return ''
  return new Date(timestampMs).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  })
}

function resolveQuoteAmount(
  ticket: TicketLike,
  pendingQuoteAmount?: number | null,
): number {
  if (
    typeof pendingQuoteAmount === 'number' &&
    Number.isFinite(pendingQuoteAmount) &&
    pendingQuoteAmount > 0
  ) {
    return Math.round(pendingQuoteAmount)
  }

  const total =
    typeof ticket.totalCost === 'number' && Number.isFinite(ticket.totalCost) && ticket.totalCost > 0
      ? ticket.totalCost
      : null
  if (total != null) return Math.round(total)

  const labor =
    typeof ticket.laborCost === 'number' && Number.isFinite(ticket.laborCost) ? ticket.laborCost : 0
  const materials =
    typeof ticket.materialCost === 'number' && Number.isFinite(ticket.materialCost)
      ? ticket.materialCost
      : 0
  const sum = labor + materials
  return sum > 0 ? Math.round(sum) : 0
}

function buildPricing(quoteAmount: number): {
  marketMedian: number
  targetPrice: number
  walkAwayPrice: number
} {
  if (quoteAmount <= 0) {
    return { marketMedian: 0, targetPrice: 0, walkAwayPrice: 0 }
  }
  const marketMedian = Math.round(quoteAmount * 0.82)
  const targetPrice = Math.round(quoteAmount * 0.88)
  const walkAwayPrice = Math.round(quoteAmount * 0.95)
  return { marketMedian, targetPrice, walkAwayPrice }
}

function stripProxiedPrefix(body: string): string {
  return body
    .replace(/^\[Property manager\]\s*/i, '')
    .replace(/^\[Ulo\]\s*/i, '')
    .replace(/^\[Your assigned vendor\]\s*/i, '')
    .replace(/^\[Tenant[^\]]*\]\s*/i, '')
    .trim()
}

function mapThreadMessages(
  threadMessages: VendorThreadMessageInput[],
): VendorChatMessage[] {
  const out: VendorChatMessage[] = []
  for (let i = 0; i < threadMessages.length; i += 1) {
    const item = threadMessages[i]
    const raw = item.body.trim()
    if (!raw) continue

    // Vendor job thread: inbound = vendor, outbound (ulo) = property team / Ulo.
    let sender: VendorChatMessage['sender'] | null = null
    if (item.sender === 'vendor') sender = 'vendor'
    else if (item.sender === 'ulo' || item.sender === 'landlord') sender = 'landlord'
    else continue

    const timestampMs = item.timestampMs
    out.push({
      id: item.id?.trim() || `thread-${i + 1}`,
      sender,
      body: stripProxiedPrefix(raw),
      timeLabel: formatMessageTime(timestampMs),
      timestampMs,
    })
  }
  return out.slice(-12)
}

/** Negotiation brief for Message Vendor rail — real vendor job SMS when available. */
export function buildVendorNegotiationBrief(
  ticket: TicketLike,
  building: string | null,
  options?: BuildVendorNegotiationBriefOptions,
): VendorNegotiationBrief {
  const location = formatLocation(building, ticket.unit)
  const category = formatCategoryLabel(ticket.issueCategory)
  const vendorName = options?.vendorName?.trim() || 'Assigned Vendor'
  const hasAssignedVendor = Boolean(
    ticket.assignedVendorId?.trim() || options?.vendorName?.trim(),
  )
  const quoteAmount = resolveQuoteAmount(ticket, options?.pendingQuoteAmount)
  const { marketMedian, targetPrice, walkAwayPrice } = buildPricing(quoteAmount)

  const threadMapped = mapThreadMessages(options?.threadMessages ?? [])
  const messages: VendorChatMessage[] =
    threadMapped.length > 0
      ? [...threadMapped]
      : [
          {
            id: 'ai-empty',
            sender: 'ai',
            aiLabel: 'Ulo · Private',
            body: hasAssignedVendor
              ? 'No texts on this vendor job thread yet. Send a message below — it goes out as SMS to the assigned vendor.'
              : 'This work order has no assigned vendor yet. Assign a vendor before messaging.',
          },
        ]

  if (quoteAmount > 0 && marketMedian > 0 && threadMapped.length > 0) {
    messages.push({
      id: 'ai-guidance',
      sender: 'ai',
      aiLabel: 'AI suggestion · Private',
      body: `Quote on file is ${formatEmergencyCurrency(quoteAmount)}. A counter near ${formatEmergencyCurrency(targetPrice)} leaves room to close if the scope is unchanged.`,
    })
  }

  const suggestedReplies =
    quoteAmount > 0
      ? [
          `Can you do ${formatEmergencyCurrency(targetPrice)} if we approve in the next hour?`,
          'Please confirm what is included in this quote and your soonest ETA.',
          `Match ${formatEmergencyCurrency(marketMedian)} and we’ll prioritize you on the next job.`,
        ]
      : [
          'Please send a written estimate for this job when you can.',
          'Confirm you can still take this job today and share your ETA.',
          'What is included in your scope before we approve?',
        ]

  return {
    ticketId: ticket.id,
    vendorName,
    vendorInitials: initialsFromName(vendorName),
    contextLine: hasAssignedVendor
      ? `Vendor SMS · ${category} · ${location}`
      : `No vendor assigned · ${category} · ${location}`,
    quoteAmount,
    marketMedian,
    targetPrice,
    walkAwayPrice,
    leverageSummary:
      quoteAmount > 0
        ? 'Targets are guidance only — send your counter as SMS on this job thread.'
        : 'Ask for a clear estimate and ETA so you can approve or counter with confidence.',
    messages,
    suggestedReplies,
    canSend: hasAssignedVendor,
    sendBlockedReason: hasAssignedVendor
      ? null
      : 'Assign a vendor to this work order before sending a text.',
  }
}

export function formatQuoteBadge(amount: number): string {
  return formatEmergencyCurrency(amount)
}
