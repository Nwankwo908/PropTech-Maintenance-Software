export type EmergencyApprovalQuoteLine = {
  label: string
  amount: number
}

export type EmergencyApprovalReview = {
  ticketId: string
  title: string
  summary: string
  urgentReasons: string[]
  vendorName: string
  quoteLines: EmergencyApprovalQuoteLine[]
  totalAmount: number
  autoApprovalCap: number
  vendorRating: number | null
  vendorEtaMinutes: number | null
  footerNote: string
}

type TicketLike = {
  id: string
  createdAt: string
  unit: string
  building: string | null
  issueCategory: string | null
  estimatedMinutes: number | null
}

function formatMinutesAgo(iso: string): string {
  const ts = new Date(iso).getTime()
  if (Number.isNaN(ts)) return 'recently'
  const minutes = Math.max(1, Math.round((Date.now() - ts) / 60_000))
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  return `${hours} hr${hours === 1 ? '' : 's'} ago`
}

function formatLocation(building: string | null, unit: string): string {
  const shortBuilding = building?.replace(/\s+Apartments$/i, '').trim() || 'Property'
  return `${shortBuilding} · ${unit}`
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(amount)
}

/** Showcase review content for urgent plumbing emergencies (Figma property detail rail). */
function plumbingBurstTemplate(
  ticket: TicketLike,
  building: string | null,
  autoApprovalCap: number,
): EmergencyApprovalReview {
  const location = formatLocation(building, ticket.unit)
  const reported = formatMinutesAgo(ticket.createdAt)
  const quoteLines: EmergencyApprovalQuoteLine[] = [
    { label: 'Emergency dispatch', amount: 350 },
    { label: 'Water extraction (2 rooms)', amount: 720 },
    { label: 'Drying equipment · 3 days', amount: 540 },
    { label: 'Cabinet & drywall removal', amount: 640 },
  ]
  const totalAmount = quoteLines.reduce((sum, line) => sum + line.amount, 0)

  return {
    ticketId: ticket.id,
    title: `Pipe burst — water damage in ${location}`,
    summary: `Reported ${reported}. Ulo dispatched mitigation but the vendor quote exceeds the auto-approval threshold and requires landlord sign-off.`,
    urgentReasons: [
      'Active water intrusion under kitchen sink — risk to unit below',
      'Water shut off at riser; resident displaced from kitchen',
      'Drywall & cabinet damage will worsen past 4 hours without dry-out',
      'Insurance deductible clock starts at first report',
    ],
    vendorName: 'RAPIDDRY RESTORATION',
    quoteLines,
    totalAmount,
    autoApprovalCap,
    vendorRating: 4.8,
    vendorEtaMinutes: 25,
    footerNote:
      "Ulo couldn't resolve this automatically because it's a financial decision over the cap and requires landlord verification on the vendor's emergency rate.",
  }
}

function genericEmergencyTemplate(
  ticket: TicketLike,
  building: string | null,
  autoApprovalCap: number,
): EmergencyApprovalReview {
  const category = ticket.issueCategory?.replace(/_/g, ' ') ?? 'Maintenance'
  const titleCase =
    category.charAt(0).toUpperCase() + category.slice(1).toLowerCase()
  const location = formatLocation(building, ticket.unit)
  const reported = formatMinutesAgo(ticket.createdAt)
  const laborEstimate = Math.round((ticket.estimatedMinutes ?? 240) * 1.25)
  const dispatch = Math.max(150, Math.round(laborEstimate * 0.25))
  const labor = Math.max(300, laborEstimate - dispatch)
  const quoteLines: EmergencyApprovalQuoteLine[] = [
    { label: 'Emergency dispatch', amount: dispatch },
    { label: `${titleCase} labor & materials`, amount: labor },
  ]
  const totalAmount = quoteLines.reduce((sum, line) => sum + line.amount, 0)

  return {
    ticketId: ticket.id,
    title: `${titleCase} — ${location}`,
    summary: `Reported ${reported}. Ulo triaged the request but the vendor quote exceeds your auto-approval threshold and needs landlord sign-off.`,
    urgentReasons: [
      'Resident reported an urgent issue requiring same-day response',
      'Vendor is on standby pending your approval',
      'Delay may increase damage scope and resident disruption',
      'Insurance and habitability timelines may apply',
    ],
    vendorName: 'ASSIGNED VENDOR',
    quoteLines,
    totalAmount,
    autoApprovalCap,
    vendorRating: null,
    vendorEtaMinutes: 45,
    footerNote:
      "Ulo couldn't resolve this automatically because the quote exceeds your approval cap and requires landlord verification.",
  }
}

export function buildEmergencyApprovalReview(
  ticket: TicketLike,
  building: string | null,
  autoApprovalCap: number,
): EmergencyApprovalReview {
  const cap = autoApprovalCap > 0 ? autoApprovalCap : 1000
  const category = ticket.issueCategory?.toLowerCase() ?? ''
  if (category === 'plumbing') {
    return plumbingBurstTemplate(ticket, building, cap)
  }
  return genericEmergencyTemplate(ticket, building, cap)
}

export function formatEmergencyCurrency(amount: number): string {
  return formatCurrency(amount)
}
