import {
  formatVendorTradeLabel,
  normIssueCategory,
  vendorMatchesTicketIssueCategory,
} from '@/lib/vendorTrades'
import { formatTicketRequestNumber } from '@/lib/vendorCallFlow'
import { isVisibleLandlordTimelineDescription } from '@/lib/landlordFacingTimeline'
import type { PropertyHealthVendorMetrics } from '@/lib/propertyHealth'

export type SlaOverdueTimelineEntry = {
  timeLabel: string
  description: string
  actor: string
}

/** Engine plumbing stays off the landlord Timeline. */
export function isVisibleSlaTimelineEntry(entry: SlaOverdueTimelineEntry): boolean {
  return isVisibleLandlordTimelineDescription(entry.description)
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
  issueCategory: string | null
  currentVendorName: string | null
  currentVendorStatus: string
  timeline: SlaOverdueTimelineEntry[]
  suggestion: SlaOverdueSuggestedVendor | null
  suggestionLine: string
  noVendorOnRoster: boolean
  takeActionMode: 'reassign' | 'workflows' | 'assign_vendor' | 'external_vendor'
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
  return formatTicketRequestNumber(id)
}

/** e.g. "1 hour 20 minutes past response time" */
export function formatPastSlaLabel(minutes: number): string {
  if (minutes < 60) {
    return `${minutes} minute${minutes === 1 ? '' : 's'} past response time`
  }
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60
  const hourPart = `${hours} hour${hours === 1 ? '' : 's'}`
  if (mins === 0) return `${hourPart} past response time`
  return `${hourPart} ${mins} minute${mins === 1 ? '' : 's'} past response time`
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
  if (minutes < 60) return `${minutes} min response time`
  const hours = Math.round(minutes / 60)
  return `${hours} hr response time`
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
  if (!u) return b
  const unitLabel = /^unit\s+/i.test(u) ? u.replace(/^unit\s+/i, 'Unit ') : `Unit ${u}`
  return `${b} · ${unitLabel}`
}

function formatCategoryLabel(slug: string | null): string {
  return formatVendorTradeLabel(slug, { emptyLabel: 'Maintenance' })
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
        description: 'Response delayed',
        actor: 'System',
      })
    } else if (!Number.isNaN(dueTs) && dueTs < now) {
      entries.push({
        timeLabel: timeOnly(ticket.dueAt),
        description: 'Response delayed',
        actor: 'System',
      })
    }
  }

  return entries.filter((e) => e.timeLabel && isVisibleSlaTimelineEntry(e))
}

function timelineBeatKey(description: string): string {
  return description.trim().toLowerCase()
}

/**
 * Keep the operational story as the Timeline spine. Plumbing leftovers from
 * workflow_events must not collapse a 3-beat story into a single row.
 */
export function mergeLandlordRailTimeline(
  operational: SlaOverdueTimelineEntry[],
  fromWorkflow: SlaOverdueTimelineEntry[],
): SlaOverdueTimelineEntry[] {
  if (operational.length === 0) return fromWorkflow
  const seen = new Set(operational.map((entry) => timelineBeatKey(entry.description)))
  const extras = fromWorkflow.filter((entry) => {
    const key = timelineBeatKey(entry.description)
    if (!key || seen.has(key)) return false
    if (key === 'escalated' || key.startsWith('escalated ')) return false
    return true
  })
  return extras.length ? [...operational, ...extras] : operational
}

export function buildSlaRailTimeline(
  ticket: SlaOverdueTicketInput,
  now = Date.now(),
): SlaOverdueTimelineEntry[] {
  return buildTimeline(ticket, now)
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
  if (suggested?.name) {
    const metrics = suggested.id ? metricsById.get(suggested.id) : undefined
    suggestion = {
      vendorId: suggested.id?.trim() ?? '',
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

  const noVendorOnRoster =
    alternatives.length === 0 && !suggestion?.vendorId && !suggestion?.vendorName
  return {
    ticketId: ticket.id,
    badgeLabel: 'RESPONSE TIME EXCEEDED',
    headerTitle: `Escalated Maintenance · ${formatCategoryLabel(ticket.issueCategory)}`,
    locationLabel: formatLocation(ticket.building, ticket.unit),
    ticketRef: formatTicketRef(ticket.id),
    urgencyLabel: formatUrgencyLabel(ticket.urgency),
    urgencyIsCritical: isUrgencyCritical(ticket.urgency),
    reportedAtLabel: formatTicketTime(ticket.createdAt, now),
    slaDueLabel: `${formatTicketTime(ticket.dueAt, now)}${
      formatSlaDuration(ticket.createdAt, ticket.dueAt)
        ? ` (${formatSlaDuration(ticket.createdAt, ticket.dueAt)})`
        : ''
    }`,
    slaDurationLabel: formatSlaDuration(ticket.createdAt, ticket.dueAt),
    minutesPastSla,
    pastSlaLabel: formatPastSlaLabel(minutesPastSla),
    issueSummary:
      ticket.description?.trim() ||
      `${formatCategoryLabel(ticket.issueCategory)} maintenance request`,
    issueCategory: ticket.issueCategory,
    currentVendorName: ticket.assignedVendorName,
    currentVendorStatus: vendorStatusLabel(ticket.vendorWorkStatus, ticket.assignedVendorName),
    timeline: buildTimeline(ticket, now),
    suggestion,
    suggestionLine: buildSuggestionLine(
      suggestion,
      noVendorOnRoster,
      normIssueCategory(ticket.issueCategory) === 'hvac',
    ),
    noVendorOnRoster,
    takeActionMode: noVendorOnRoster ? 'external_vendor' : 'reassign',
  }
}

/** Minimal review when SLA rail data is unavailable but external vendor assign is required. */
export function buildExternalVendorFallbackReview(
  ticket: SlaOverdueTicketInput,
  options: { workflowRunId?: string } = {},
): SlaOverdueActionReview {
  const dueAt = ticket.dueAt
  const dueTs = dueAt ? new Date(dueAt).getTime() : NaN
  const minutesPastSla =
    dueAt && !Number.isNaN(dueTs) && dueTs < Date.now()
      ? Math.max(1, Math.round((Date.now() - dueTs) / 60_000))
      : null

  return {
    ticketId: ticket.id,
    workflowRunId: options.workflowRunId,
    badgeLabel: 'ASSIGN VENDOR · MAINTENANCE',
    headerTitle: `Assign Vendor · ${formatCategoryLabel(ticket.issueCategory)}`,
    locationLabel: formatLocation(ticket.building, ticket.unit),
    ticketRef: formatTicketRef(ticket.id),
    urgencyLabel: formatUrgencyLabel(ticket.urgency),
    urgencyIsCritical: isUrgencyCritical(ticket.urgency),
    reportedAtLabel: formatTicketTime(ticket.createdAt),
    slaDueLabel: dueAt ? formatTicketTime(dueAt) : '—',
    slaDurationLabel:
      dueAt && ticket.createdAt ? formatSlaDuration(ticket.createdAt, dueAt) : null,
    minutesPastSla,
    pastSlaLabel: minutesPastSla != null ? formatPastSlaLabel(minutesPastSla) : null,
    issueSummary:
      ticket.description?.trim() ||
      `${formatCategoryLabel(ticket.issueCategory)} maintenance request`,
    issueCategory: ticket.issueCategory,
    currentVendorName: ticket.assignedVendorName,
    currentVendorStatus: vendorStatusLabel(ticket.vendorWorkStatus, ticket.assignedVendorName),
    timeline: buildTimeline(ticket),
    suggestion: null,
    suggestionLine: 'Find an external vendor for this job',
    noVendorOnRoster: true,
    takeActionMode: 'external_vendor',
  }
}

function buildSuggestionLine(
  suggestion: SlaOverdueSuggestedVendor | null,
  noVendorOnRoster: boolean,
  offerSlaCredit = false,
): string {
  if (noVendorOnRoster) {
    return 'No vendor on roster — review external vendor match below'
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
    return `Escalate to backup vendor (${suggestion.vendorName}${meta ? ` · ${meta}` : ''}) or extend response time with tenant credit`
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
