import { isDemoAccountActive } from '@/lib/activeLandlord'
import {
  normIssueCategory,
  vendorMatchesTicketIssueCategory,
} from '@/lib/vendorIssueCategory'
import type { PropertyHealthVendorMetrics } from '@/lib/propertyHealth'

export type SlaOverdueTimelineEntry = {
  timeLabel: string
  description: string
  actor: string
}

export type SlaOverdueSuggestedVendor = {
  vendorId: string
  vendorName: string
  rating: number | null
  etaMinutes: number | null
}

export type SlaOverdueActionReview = {
  ticketId: string
  workflowRunId?: string
  badgeLabel: string
  headerTitle: string
  locationLabel: string
  ticketRef: string
  urgencyLabel: string
  urgencyIsCritical: boolean
  reportedAtLabel: string
  slaDueLabel: string
  slaDurationLabel: string | null
  minutesPastSla: number | null
  pastSlaLabel: string | null
  issueSummary: string
  currentVendorName: string | null
  currentVendorStatus: string
  timeline: SlaOverdueTimelineEntry[]
  suggestion: SlaOverdueSuggestedVendor | null
  suggestionLine: string
  noVendorOnRoster: boolean
  takeActionMode: 'reassign' | 'workflows' | 'assign_vendor'
}

export type SlaOverdueTicketInput = {
  id: string
  createdAt: string
  dueAt: string | null
  urgency: string
  unit: string
  building: string | null
  description: string | null
  issueCategory: string | null
  assignedVendorId: string | null
  assignedVendorName: string | null
  vendorWorkStatus: string
  residentName: string | null
  assignedAt: string | null
}

export type SlaOverdueVendorInput = {
  id: string
  name: string
  category: string | null
  active: boolean
}

function formatTicketRef(id: string): string {
  const compact = id.replace(/-/g, '').toUpperCase()
  return `REQ-${compact.slice(-4)}`
}

/** e.g. "1 hour 20 minutes past SLA" */
export function formatPastSlaLabel(minutes: number): string {
  if (minutes < 60) {
    return `${minutes} minute${minutes === 1 ? '' : 's'} past SLA`
  }
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60
  const hourPart = `${hours} hour${hours === 1 ? '' : 's'}`
  if (mins === 0) return `${hourPart} past SLA`
  return `${hourPart} ${mins} minute${mins === 1 ? '' : 's'} past SLA`
}

export function isUrgencyCritical(urgency: string): boolean {
  const u = urgency.trim().toLowerCase()
  return u === 'urgent' || u === 'emergency' || u === 'critical' || u === 'high'
}

function formatTicketTime(iso: string, now = Date.now()): string {
  const d = new Date(iso)
  const ts = d.getTime()
  if (Number.isNaN(ts)) return 'Unknown'
  const startOfToday = new Date(now)
  startOfToday.setHours(0, 0, 0, 0)
  const startOfYesterday = new Date(startOfToday)
  startOfYesterday.setDate(startOfYesterday.getDate() - 1)
  const dayStart = new Date(d)
  dayStart.setHours(0, 0, 0, 0)
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  if (dayStart.getTime() === startOfToday.getTime()) return `Today · ${time}`
  if (dayStart.getTime() === startOfYesterday.getTime()) return `Yesterday · ${time}`
  return `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} · ${time}`
}

function formatSlaDuration(createdAt: string, dueAt: string): string | null {
  const start = new Date(createdAt).getTime()
  const end = new Date(dueAt).getTime()
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return null
  const minutes = Math.round((end - start) / 60_000)
  if (minutes < 60) return `${minutes} Min SLA`
  const hours = Math.round(minutes / 60)
  return `${hours} Hr SLA`
}

function formatUrgencyLabel(urgency: string): string {
  const u = urgency.trim().toLowerCase()
  if (u === 'urgent' || u === 'emergency' || u === 'critical') return 'Emergency'
  if (u === 'high') return 'High'
  if (u === 'low') return 'Low'
  return 'Normal'
}

function formatLocation(building: string | null, unit: string): string {
  const b = building?.trim() || 'Property'
  const u = unit.trim()
  const unitLabel = /^\d/.test(u) ? `Unit ${u}` : u
  return `${b} · ${unitLabel}`
}

function formatCategoryLabel(slug: string | null): string {
  const n = normIssueCategory(slug)
  if (!n) return 'Maintenance'
  return n.charAt(0).toUpperCase() + n.slice(1)
}

function vendorStatusLabel(vendorWorkStatus: string, assignedVendorName: string | null): string {
  const vws = vendorWorkStatus.trim().toLowerCase()
  if (!assignedVendorName) return 'Unassigned'
  if (vws === 'pending_accept') return 'Assigned · awaiting acceptance'
  if (vws === 'accepted') return 'Accepted · technician en route, delayed by parts pickup'
  if (vws === 'in_progress') return 'In progress · on site'
  if (vws === 'declined') return 'Declined · needs reassignment'
  return 'Assigned · no ETA confirmed'
}

function addMinutes(iso: string, minutes: number): string {
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return iso
  return new Date(t + minutes * 60_000).toISOString()
}

function timeOnly(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

function etaFromMetrics(metrics: PropertyHealthVendorMetrics | undefined): number | null {
  if (metrics?.avgResponseTime != null && Number.isFinite(metrics.avgResponseTime)) {
    return Math.max(5, Math.round(metrics.avgResponseTime))
  }
  return null
}

function ratingFromMetrics(metrics: PropertyHealthVendorMetrics | undefined): number | null {
  if (metrics?.completionRate != null && Number.isFinite(metrics.completionRate)) {
    return Math.min(5, Math.max(3.5, 3.2 + metrics.completionRate * 1.8))
  }
  return null
}

export function pickAlternativeVendors(
  ticket: SlaOverdueTicketInput,
  vendors: SlaOverdueVendorInput[],
): SlaOverdueVendorInput[] {
  const slug = ticket.issueCategory?.trim().toLowerCase() ?? null
  const assignedId = ticket.assignedVendorId?.trim() ?? ''
  return vendors
    .filter((v) => v.active && v.id && v.name.trim())
    .filter((v) => !assignedId || v.id !== assignedId)
    .filter((v) => vendorMatchesTicketIssueCategory(v.category, slug))
    .sort((a, b) => a.name.localeCompare(b.name))
}

function buildTimeline(
  ticket: SlaOverdueTicketInput,
  now = Date.now(),
): SlaOverdueTimelineEntry[] {
  const resident = ticket.residentName?.trim() || 'Resident'
  const category = formatCategoryLabel(ticket.issueCategory)
  const urgency = formatUrgencyLabel(ticket.urgency)
  const entries: SlaOverdueTimelineEntry[] = [
    {
      timeLabel: timeOnly(ticket.createdAt),
      description: 'Tenant reported via SMS',
      actor: resident,
    },
    {
      timeLabel: timeOnly(addMinutes(ticket.createdAt, 1)),
      description: `Classified as ${urgency} · ${category}`,
      actor: 'Ulo AI',
    },
  ]

  if (ticket.assignedVendorName) {
    const dispatchAt = ticket.assignedAt ?? addMinutes(ticket.createdAt, 2)
    entries.push({
      timeLabel: timeOnly(dispatchAt),
      description: `Dispatched to ${ticket.assignedVendorName}`,
      actor: 'Ulo AI',
    })
  }

  if (ticket.dueAt) {
    const dueTs = new Date(ticket.dueAt).getTime()
    const followUpAt = addMinutes(ticket.dueAt, -30)
    if (!Number.isNaN(dueTs) && dueTs < now && ticket.assignedVendorName) {
      entries.push({
        timeLabel: timeOnly(followUpAt),
        description: 'Auto-followed up — no response',
        actor: 'Ulo AI',
      })
      entries.push({
        timeLabel: timeOnly(ticket.dueAt),
        description: 'SLA breached',
        actor: 'System',
      })
    } else if (!Number.isNaN(dueTs) && dueTs < now) {
      entries.push({
        timeLabel: timeOnly(ticket.dueAt),
        description: 'SLA breached',
        actor: 'System',
      })
    }
  }

  return entries.filter((e) => e.timeLabel)
}

/** Rich demo copy for Oakwood 304 emergency plumbing (Figma SLA rail). */
function demoShowcaseReview(
  ticket: SlaOverdueTicketInput,
  suggestion: SlaOverdueSuggestedVendor | null,
): Partial<SlaOverdueActionReview> | null {
  if (!isDemoAccountActive()) return null
  const unit = ticket.unit.trim()
  const building = (ticket.building ?? '').toLowerCase()
  const isOak304 =
    unit === '304' &&
    building.includes('oakwood') &&
    normIssueCategory(ticket.issueCategory) === 'plumbing'

  if (!isOak304 && !suggestion) return null

  const created = ticket.createdAt
  const due = ticket.dueAt ?? addMinutes(created, 60)
  const rapidAlt =
    suggestion ??
    ({
      vendorId: '',
      vendorName: 'Rapid Plumb Co.',
      rating: 4.9,
      etaMinutes: 18,
    } satisfies SlaOverdueSuggestedVendor)

  return {
    locationLabel: 'Oakwood Apartments · Unit 304',
    issueSummary:
      ticket.description?.trim() ||
      'Active leak from ceiling in master bathroom, water pooling on floor.',
    currentVendorName: ticket.assignedVendorName ?? 'Metro Plumbing',
    currentVendorStatus: 'Assigned · no ETA confirmed',
    timeline: [
      { timeLabel: '9:12 AM', description: 'Tenant reported via SMS', actor: 'Daniel Rivera' },
      { timeLabel: '9:13 AM', description: 'Classified as Emergency · Plumbing', actor: 'Ulo AI' },
      { timeLabel: '9:14 AM', description: 'Dispatched to Metro Plumbing', actor: 'Ulo AI' },
      { timeLabel: '9:42 AM', description: 'Auto-followed up — no response', actor: 'Ulo AI' },
      { timeLabel: '10:12 AM', description: 'SLA breached', actor: 'System' },
    ],
    suggestion: isOak304
      ? {
          ...rapidAlt,
          vendorName: rapidAlt.vendorName || 'Rapid Plumb Co.',
          rating: rapidAlt.rating ?? 4.9,
          etaMinutes: rapidAlt.etaMinutes ?? 18,
        }
      : suggestion,
    reportedAtLabel: formatTicketTime(created),
    slaDueLabel: `${formatTicketTime(due).replace(/^Today · /, 'Today · ')} (${formatSlaDuration(created, due) ?? '1 Hr SLA'})`,
    slaDurationLabel: formatSlaDuration(created, due) ?? '1 Hr SLA',
    urgencyLabel: 'Emergency',
  }
}

export function buildSlaOverdueActionReview(
  ticket: SlaOverdueTicketInput,
  vendors: SlaOverdueVendorInput[],
  vendorMetrics: PropertyHealthVendorMetrics[],
  suggested?: { id: string; name: string } | null,
  now = Date.now(),
): SlaOverdueActionReview | null {
  if (!ticket.dueAt) return null
  const dueTs = new Date(ticket.dueAt).getTime()
  if (Number.isNaN(dueTs) || dueTs >= now) return null

  const minutesPastSla = Math.max(1, Math.round((now - dueTs) / 60_000))
  const alternatives = pickAlternativeVendors(ticket, vendors)
  const metricsById = new Map(vendorMetrics.map((m) => [m.vendorId, m]))

  let suggestion: SlaOverdueSuggestedVendor | null = null
  if (suggested?.id && suggested.name) {
    const metrics = metricsById.get(suggested.id)
    suggestion = {
      vendorId: suggested.id,
      vendorName: suggested.name,
      rating: ratingFromMetrics(metrics) ?? 4.7,
      etaMinutes: etaFromMetrics(metrics) ?? 20,
    }
  } else if (alternatives[0]) {
    const alt = alternatives[0]
    const metrics = metricsById.get(alt.id)
    suggestion = {
      vendorId: alt.id,
      vendorName: alt.name,
      rating: ratingFromMetrics(metrics),
      etaMinutes: etaFromMetrics(metrics),
    }
  }

  const noVendorOnRoster = alternatives.length === 0 && !suggestion?.vendorId
  const showcase = demoShowcaseReview(ticket, suggestion)

  return {
    ticketId: ticket.id,
    badgeLabel: 'SLA OVERDUE · MAINTENANCE',
    headerTitle: `Escalated Maintenance · ${formatCategoryLabel(ticket.issueCategory)}`,
    locationLabel: showcase?.locationLabel ?? formatLocation(ticket.building, ticket.unit),
    ticketRef: formatTicketRef(ticket.id),
    urgencyLabel: showcase?.urgencyLabel ?? formatUrgencyLabel(ticket.urgency),
    urgencyIsCritical: isUrgencyCritical(ticket.urgency),
    reportedAtLabel: showcase?.reportedAtLabel ?? formatTicketTime(ticket.createdAt, now),
    slaDueLabel:
      showcase?.slaDueLabel ??
      `${formatTicketTime(ticket.dueAt, now)}${
        formatSlaDuration(ticket.createdAt, ticket.dueAt)
          ? ` (${formatSlaDuration(ticket.createdAt, ticket.dueAt)})`
          : ''
      }`,
    slaDurationLabel:
      showcase?.slaDurationLabel ??
      formatSlaDuration(ticket.createdAt, ticket.dueAt),
    minutesPastSla,
    pastSlaLabel: formatPastSlaLabel(minutesPastSla),
    issueSummary:
      showcase?.issueSummary ??
      (ticket.description?.trim() ||
        `${formatCategoryLabel(ticket.issueCategory)} maintenance request`),
    currentVendorName: showcase?.currentVendorName ?? ticket.assignedVendorName,
    currentVendorStatus:
      showcase?.currentVendorStatus ??
      vendorStatusLabel(ticket.vendorWorkStatus, ticket.assignedVendorName),
    timeline: showcase?.timeline ?? buildTimeline(ticket, now),
    suggestion: showcase?.suggestion ?? suggestion,
    suggestionLine: buildSuggestionLine(
      showcase?.suggestion ?? suggestion,
      noVendorOnRoster,
      normIssueCategory(ticket.issueCategory) === 'hvac',
    ),
    noVendorOnRoster,
    takeActionMode: noVendorOnRoster ? 'assign_vendor' : 'reassign',
  }
}

function buildSuggestionLine(
  suggestion: SlaOverdueSuggestedVendor | null,
  noVendorOnRoster: boolean,
  offerSlaCredit = false,
): string {
  if (noVendorOnRoster) {
    return 'Add a vendor to your roster to auto-reassign on SLA breach'
  }
  if (!suggestion?.vendorName) {
    return 'Review escalation details in maintenance requests'
  }
  const meta = [
    suggestion.rating != null ? `${suggestion.rating.toFixed(1)}★` : null,
    suggestion.etaMinutes != null ? `${suggestion.etaMinutes} min ETA` : null,
  ]
    .filter(Boolean)
    .join(' · ')
  if (offerSlaCredit) {
    return `Escalate to backup vendor (${suggestion.vendorName}${meta ? ` · ${meta}` : ''}) or extend SLA with tenant credit`
  }
  return `Reassign to ${suggestion.vendorName}${meta ? ` (${meta})` : ''}`
}

export function buildSuggestionLineForReview(
  suggestion: SlaOverdueSuggestedVendor | null,
  noVendorOnRoster: boolean,
  issueCategory: string | null,
): string {
  return buildSuggestionLine(
    suggestion,
    noVendorOnRoster,
    normIssueCategory(issueCategory) === 'hvac',
  )
}

export function isSlaOverdueOpenTicket(ticket: {
  dueAt: string | null
  vendorWorkStatus: string
}): boolean {
  const closed = new Set(['completed', 'cancelled'])
  if (closed.has(ticket.vendorWorkStatus.trim().toLowerCase())) return false
  if (!ticket.dueAt) return false
  const dueTs = new Date(ticket.dueAt).getTime()
  return !Number.isNaN(dueTs) && dueTs < Date.now()
}
