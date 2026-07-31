import { formatVendorTradeLabel } from '@/lib/vendorTrades'

export type EmergencyApprovalQuoteLine = {
  label: string
  amount: number
}

export type EmergencyApprovalReview = {
  ticketId: string
  title: string
  summary: string
  urgentReasons: string[]
  tenantNotes: string[]
  vendorName: string
  quoteLines: EmergencyApprovalQuoteLine[]
  totalAmount: number
  autoApprovalCap: number
  vendorRating: number | null
  vendorEtaMinutes: number | null
  footerNote: string
  hasQuote: boolean
}

type TicketLike = {
  id: string
  createdAt: string
  unit: string
  building: string | null
  issueCategory: string | null
  description?: string | null
  urgency?: string | null
  vendorWorkStatus?: string | null
  estimatedMinutes: number | null
  totalCost?: number | null
  laborCost?: number | null
  materialCost?: number | null
}

/** Conversation-inbox state for the assigned vendor SMS thread. */
export type VendorSmsReviewState =
  | 'no_thread'
  | 'awaiting_vendor_reply'
  | 'awaiting_vendor_followup'
  | 'awaiting_landlord'
  | 'vendor_replied'

export type BuildEmergencyApprovalReviewOptions = {
  vendorName?: string | null
  vendorSmsState?: VendorSmsReviewState | null
}

type VendorSmsTranscriptMessage = {
  type: string
  sender?: string
}

type VendorSmsThreadLike = {
  transcript: VendorSmsTranscriptMessage[]
  pendingEstimateDecision?: unknown
} | null

/** Derive vendor SMS review state from the Communication inbox thread. */
export function deriveVendorSmsReviewState(
  detail: VendorSmsThreadLike,
): VendorSmsReviewState {
  if (!detail) return 'no_thread'

  if (detail.pendingEstimateDecision) return 'awaiting_landlord'

  const messages = detail.transcript.filter((item) => item.type === 'message')
  if (messages.length === 0) return 'no_thread'

  const vendorReplied = messages.some((item) => item.sender === 'vendor')
  const hasOutbound = messages.some((item) => item.sender === 'ulo')

  if (!vendorReplied) {
    return hasOutbound ? 'awaiting_vendor_reply' : 'no_thread'
  }

  const lastMessage = messages[messages.length - 1]
  if (lastMessage?.sender === 'ulo') return 'awaiting_vendor_followup'
  return 'vendor_replied'
}

function vendorSmsReason(state: VendorSmsReviewState | null | undefined): string | null {
  switch (state) {
    case 'awaiting_vendor_reply':
      return 'Vendor has not responded to text yet'
    case 'awaiting_vendor_followup':
      return 'Waiting for the vendor to reply to the latest text'
    case 'awaiting_landlord':
      return 'Vendor submitted a quote and is waiting on your approval'
    case 'vendor_replied':
      return 'Vendor replied — review their latest message in the conversation'
    case 'no_thread':
    case null:
    case undefined:
      return null
    default:
      return null
  }
}

function formatMinutesAgo(iso: string): string {
  const ts = new Date(iso).getTime()
  if (Number.isNaN(ts)) return 'recently'
  const minutes = Math.max(1, Math.round((Date.now() - ts) / 60_000))
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours} hr${hours === 1 ? '' : 's'} ago`
  const days = Math.round(hours / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}

function formatLocation(building: string | null, unit: string): string {
  const shortBuilding = building?.replace(/\s+Apartments$/i, '').trim() || 'Property'
  const unitLabel = unit.trim() || 'Unit'
  return `${shortBuilding} · ${unitLabel}`
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(amount)
}

function titleCaseCategory(issueCategory: string | null): string {
  return formatVendorTradeLabel(issueCategory, { emptyLabel: 'Maintenance' })
}

function truncate(text: string, max: number): string {
  const cleaned = text.replace(/\s+/g, ' ').trim()
  if (cleaned.length <= max) return cleaned
  return `${cleaned.slice(0, max - 1).trimEnd()}…`
}

function splitTenantNoteSentences(description: string): string[] {
  const cleaned = description.replace(/\s+/g, ' ').trim()
  if (!cleaned) return []

  const parts = cleaned
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter(Boolean)

  const sentences = (parts.length > 0 ? parts : [cleaned]).map((sentence) =>
    truncate(sentence, 160),
  )

  return sentences.slice(0, 6)
}

function buildUrgentReasons(
  ticket: TicketLike,
  vendorSmsState?: VendorSmsReviewState | null,
): string[] {
  const reasons: string[] = []
  const urgency = (ticket.urgency ?? '').toLowerCase()

  if (urgency === 'emergency' || urgency === 'urgent' || urgency === 'critical') {
    reasons.push(`Marked ${urgency} — same-day response required`)
  } else if (urgency) {
    reasons.push(`Priority: ${urgency}`)
  } else {
    reasons.push('Open maintenance issue requiring landlord review')
  }

  const smsReason = vendorSmsReason(vendorSmsState)
  if (smsReason) reasons.push(smsReason)

  if (ticket.estimatedMinutes != null && ticket.estimatedMinutes > 0) {
    const hours = Math.round(ticket.estimatedMinutes / 60)
    reasons.push(
      hours >= 2
        ? `Estimated scope ~${hours} hours`
        : `Estimated scope ~${ticket.estimatedMinutes} minutes`,
    )
  }

  return reasons.slice(0, 3)
}

function buildQuoteLines(ticket: TicketLike): {
  quoteLines: EmergencyApprovalQuoteLine[]
  totalAmount: number
  hasQuote: boolean
} {
  const labor =
    typeof ticket.laborCost === 'number' && Number.isFinite(ticket.laborCost) && ticket.laborCost > 0
      ? ticket.laborCost
      : null
  const materials =
    typeof ticket.materialCost === 'number' &&
    Number.isFinite(ticket.materialCost) &&
    ticket.materialCost > 0
      ? ticket.materialCost
      : null
  const total =
    typeof ticket.totalCost === 'number' && Number.isFinite(ticket.totalCost) && ticket.totalCost > 0
      ? ticket.totalCost
      : null

  const quoteLines: EmergencyApprovalQuoteLine[] = []
  if (labor != null) quoteLines.push({ label: 'Labor', amount: Math.round(labor) })
  if (materials != null) quoteLines.push({ label: 'Materials', amount: Math.round(materials) })

  if (quoteLines.length > 0) {
    const lineSum = quoteLines.reduce((sum, line) => sum + line.amount, 0)
    if (total != null && Math.abs(total - lineSum) > 1) {
      const other = Math.round(total - lineSum)
      if (other > 0) quoteLines.push({ label: 'Other / tax', amount: other })
    }
    const totalAmount = total ?? lineSum
    return { quoteLines, totalAmount: Math.round(totalAmount), hasQuote: true }
  }

  if (total != null) {
    return {
      quoteLines: [{ label: 'Vendor quote', amount: Math.round(total) }],
      totalAmount: Math.round(total),
      hasQuote: true,
    }
  }

  return { quoteLines: [], totalAmount: 0, hasQuote: false }
}

/** Build the property-detail Review rail from the real work order. */
export function buildEmergencyApprovalReview(
  ticket: TicketLike,
  building: string | null,
  autoApprovalCap: number,
  options?: BuildEmergencyApprovalReviewOptions,
): EmergencyApprovalReview {
  const cap = autoApprovalCap > 0 ? autoApprovalCap : 1000
  const category = titleCaseCategory(ticket.issueCategory)
  const location = formatLocation(building ?? ticket.building, ticket.unit)
  const propertyName =
    (building ?? ticket.building)?.replace(/\s+Apartments$/i, '').trim() || 'Property'
  const reported = formatMinutesAgo(ticket.createdAt)
  const vendorName = options?.vendorName?.trim() || 'Assigned vendor'
  const { quoteLines, totalAmount, hasQuote } = buildQuoteLines(ticket)

  const overCap = hasQuote && totalAmount > cap
  const title = overCap
    ? `${category} quote needs your approval`
    : hasQuote
      ? `Review ${category.toLowerCase()} quote at ${location}`
      : `Review ${category.toLowerCase()} work at ${location}`

  const summary = `Reported ${reported} at ${propertyName}`

  const footerNote = hasQuote
    ? overCap
      ? `This quote is over your ${formatCurrency(cap)} auto-approval cap, so Ulo needs your sign-off before work continues.`
      : `Review this work order and approve to let the assigned vendor proceed.`
    : `No vendor quote amount is on file yet. Review the work order details, then approve to continue or decline to stop the job.`

  return {
    ticketId: ticket.id,
    title,
    summary,
    urgentReasons: buildUrgentReasons(ticket, options?.vendorSmsState),
    tenantNotes: splitTenantNoteSentences(ticket.description ?? ''),
    vendorName: vendorName.toUpperCase(),
    quoteLines,
    totalAmount,
    autoApprovalCap: cap,
    vendorRating: null,
    vendorEtaMinutes: null,
    footerNote,
    hasQuote,
  }
}

export function formatEmergencyCurrency(amount: number): string {
  return formatCurrency(amount)
}
