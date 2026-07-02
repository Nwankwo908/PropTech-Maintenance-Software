import { formatEmergencyCurrency } from '@/lib/emergencyApprovalReview'

export type VendorChatMessage = {
  id: string
  sender: 'vendor' | 'ai'
  body: string
  timeLabel: string
  aiLabel?: string
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
}

type TicketLike = {
  id: string
  unit: string
  building: string | null
  issueCategory: string | null
}

function formatLocation(building: string | null, unit: string): string {
  const shortBuilding = building?.replace(/\s+Apartments$/i, '').trim() || 'Property'
  return `${shortBuilding} · ${unit}`
}

function formatCategoryLabel(category: string | null): string {
  if (!category) return 'Maintenance'
  return category
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return 'VN'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return `${parts[0][0] ?? ''}${parts[1][0] ?? ''}`.toUpperCase()
}

/** Showcase negotiation for urgent plumbing (Figma Message Vendor rail). */
function plumbingNegotiationTemplate(
  ticket: TicketLike,
  building: string | null,
): VendorNegotiationBrief {
  const location = formatLocation(building, ticket.unit)
  const category = formatCategoryLabel(ticket.issueCategory)
  const vendorName = 'RapidDry Restoration'

  return {
    ticketId: ticket.id,
    vendorName,
    vendorInitials: 'RD',
    contextLine: `Negotiating · ${category} · ${location}`,
    quoteAmount: 2250,
    marketMedian: 1780,
    targetPrice: 1900,
    walkAwayPrice: 2050,
    leverageSummary:
      'Leverage: 14 jobs in last 6 months · 4.8★ rating you provided · payment in 7 days vs their standard 30.',
    messages: [
      {
        id: 'vendor-1',
        sender: 'vendor',
        body: 'Hi — quoting $2,250 total for the pipe burst job. Emergency rate + 3-day dry-out. Can dispatch in 25 min.',
        timeLabel: '2:14 PM',
      },
      {
        id: 'ai-1',
        sender: 'ai',
        aiLabel: 'AI suggestion · Private',
        body: 'Market benchmark for this scope in your ZIP is $1,650–$1,900. RapidDry is ~18% above median. They\'ve accepted 12% discounts on 3 past jobs with you.',
        timeLabel: '2:14 PM',
      },
    ],
    suggestedReplies: [
      'Can you do $1,900 flat if we approve in the next 10 min and pay in 7 days?',
      'Drop the drying equipment to 2 days — resident confirmed kitchen ventilates well.',
      'Match the $1,780 market median and we\'ll add this to your priority queue for Q4.',
    ],
  }
}

function genericNegotiationTemplate(
  ticket: TicketLike,
  building: string | null,
): VendorNegotiationBrief {
  const location = formatLocation(building, ticket.unit)
  const category = formatCategoryLabel(ticket.issueCategory)
  const vendorName = 'Assigned Vendor'
  const quoteAmount = 1850
  const marketMedian = 1520
  const targetPrice = 1650
  const walkAwayPrice = 1780

  return {
    ticketId: ticket.id,
    vendorName,
    vendorInitials: initialsFromName(vendorName),
    contextLine: `Negotiating · ${category} · ${location}`,
    quoteAmount,
    marketMedian,
    targetPrice,
    walkAwayPrice,
    leverageSummary:
      'Leverage: repeat vendor relationship · prior on-time completion · faster payment terms available.',
    messages: [
      {
        id: 'vendor-1',
        sender: 'vendor',
        body: `Hi — quoting ${formatEmergencyCurrency(quoteAmount)} for this ${category.toLowerCase()} job. Can start today pending approval.`,
        timeLabel: '2:14 PM',
      },
      {
        id: 'ai-1',
        sender: 'ai',
        aiLabel: 'AI suggestion · Private',
        body: `Market benchmark for this scope is ${formatEmergencyCurrency(marketMedian - 120)}–${formatEmergencyCurrency(marketMedian + 80)}. Counter at ${formatEmergencyCurrency(targetPrice)} aligns with your historical approvals.`,
        timeLabel: '2:14 PM',
      },
    ],
    suggestedReplies: [
      `Can you do ${formatEmergencyCurrency(targetPrice)} if we approve in the next hour?`,
      'Remove non-essential line items and resend the quote.',
      `Match ${formatEmergencyCurrency(marketMedian)} and we'll prioritize you on the next job.`,
    ],
  }
}

export function buildVendorNegotiationBrief(
  ticket: TicketLike,
  building: string | null,
): VendorNegotiationBrief {
  const category = ticket.issueCategory?.toLowerCase() ?? ''
  if (category === 'plumbing') {
    return plumbingNegotiationTemplate(ticket, building)
  }
  return genericNegotiationTemplate(ticket, building)
}

export function formatQuoteBadge(amount: number): string {
  return formatEmergencyCurrency(amount)
}
