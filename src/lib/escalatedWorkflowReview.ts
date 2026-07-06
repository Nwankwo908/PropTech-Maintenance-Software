import { isDemoAccountActive } from '@/lib/activeLandlord'
import type { AdminWorkflowRow, AdminWorkflowTimelineEvent } from '@/lib/adminWorkflows'
import {
  buildSlaOverdueActionReview,
  buildSuggestionLineForReview,
  formatPastSlaLabel,
  isUrgencyCritical,
  pickAlternativeVendors,
  type SlaOverdueActionReview,
  type SlaOverdueTicketInput,
  type SlaOverdueTimelineEntry,
  type SlaOverdueVendorInput,
} from '@/lib/slaOverdueActionReview'
import { normIssueCategory } from '@/lib/vendorIssueCategory'
import type { PropertyHealthVendorMetrics } from '@/lib/propertyHealth'

function formatCategoryLabel(slug: string | null): string {
  const n = normIssueCategory(slug)
  if (!n) return 'Maintenance'
  if (n === 'hvac') return 'HVAC'
  return n.charAt(0).toUpperCase() + n.slice(1)
}

function formatLocation(propertyLabel: string | null, unitLabel: string | null): string {
  const b = propertyLabel?.trim() || 'Property'
  const u = (unitLabel ?? '').trim()
  if (!u) return b
  const unit = /^\d/.test(u) ? `Unit ${u}` : u
  return `${b} · ${unit}`
}

function formatTicketRef(id: string): string {
  return `REQ-${id.replace(/-/g, '').toUpperCase().slice(-4)}`
}

function formatTicketTime(iso: string, now = Date.now()): string {
  const d = new Date(iso)
  const ts = d.getTime()
  if (Number.isNaN(ts)) return 'Unknown'
  const startOfToday = new Date(now)
  startOfToday.setHours(0, 0, 0, 0)
  const dayStart = new Date(d)
  dayStart.setHours(0, 0, 0, 0)
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  if (dayStart.getTime() === startOfToday.getTime()) return `Today · ${time}`
  return `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} · ${time}`
}

function formatUrgencyLabel(urgency: string): string {
  const u = urgency.trim().toLowerCase()
  if (u === 'urgent' || u === 'emergency' || u === 'critical') return 'Emergency'
  if (u === 'high') return 'High'
  if (u === 'low') return 'Low'
  return 'Normal'
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

function timeOnly(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

function timelineActor(event: AdminWorkflowTimelineEvent): string {
  const stage = (event.stage ?? '').trim().toLowerCase()
  if (stage === 'system') return 'System'
  if (stage === 'vendor' || event.eventType.includes('vendor')) return 'Vendor'
  return 'Ulo AI'
}

function timelineFromWorkflowEvents(
  events: AdminWorkflowTimelineEvent[],
): SlaOverdueTimelineEntry[] {
  return [...events]
    .sort(
      (a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    )
    .map((event) => ({
      timeLabel: timeOnly(event.createdAt),
      description: event.message?.trim() || event.label,
      actor: timelineActor(event),
    }))
    .filter((entry) => entry.timeLabel && entry.description)
}

function vendorStatusLabel(vendorWorkStatus: string, assignedVendorName: string | null): string {
  const vws = vendorWorkStatus.trim().toLowerCase()
  if (!assignedVendorName) return 'Unassigned'
  if (vws === 'pending_accept') return 'Assigned · awaiting acceptance'
  if (vws === 'accepted') return 'Accepted · technician en route, delayed by parts pickup'
  if (vws === 'in_progress') return 'In progress · on site'
  if (vws === 'declined') return 'Declined · needs reassignment'
  if (vws === 'escalated') return 'Escalated · vendor reassignment in progress'
  return 'Assigned · no ETA confirmed'
}

function ratingFromMetrics(
  metrics: PropertyHealthVendorMetrics | undefined,
): number | null {
  if (metrics?.completionRate != null && Number.isFinite(metrics.completionRate)) {
    return Math.min(5, Math.max(3.5, 3.2 + metrics.completionRate * 1.8))
  }
  return null
}

function etaFromMetrics(metrics: PropertyHealthVendorMetrics | undefined): number | null {
  if (metrics?.avgResponseTime != null && Number.isFinite(metrics.avgResponseTime)) {
    return Math.max(5, Math.round(metrics.avgResponseTime))
  }
  return null
}

/** Figma escalated HVAC SLA rail (demo). */
function demoHvacEscalatedShowcase(
  run: AdminWorkflowRow,
): Partial<SlaOverdueActionReview> | null {
  if (!isDemoAccountActive()) return null
  const unit = (run.unitLabel ?? '').trim()
  const building = (run.propertyLabel ?? '').toLowerCase()
  const isBirch902 =
    (unit === '902' || unit === 'Unit 902') && building.includes('birch')
  const isMaple207 = unit === '207' && building.includes('maple')

  if (!isBirch902 && !isMaple207) return null

  return {
    badgeLabel: 'SLA OVERDUE · MAINTENANCE',
    headerTitle: 'Escalated Maintenance · HVAC',
    locationLabel: isBirch902 ? 'Birch Tower · Unit 902' : 'Maple Heights · Unit 207',
    ticketRef: 'REQ-4902',
    urgencyLabel: 'High',
    urgencyIsCritical: true,
    reportedAtLabel: 'Today · 7:45 AM',
    slaDueLabel: 'Today · 11:45 AM (4 Hr SLA)',
    minutesPastSla: 80,
    pastSlaLabel: '1 hour 20 minutes past SLA',
    issueSummary:
      'No cooling in unit, indoor temp 84°F. Tenant has infant — heat advisory active.',
    timeline: [
      { timeLabel: '7:45 AM', description: 'Tenant reported via app', actor: 'M. Chen' },
      { timeLabel: '7:46 AM', description: 'Classified as High · HVAC', actor: 'Ulo AI' },
      { timeLabel: '7:48 AM', description: 'Dispatched to Cool Air HVAC', actor: 'Ulo AI' },
      {
        timeLabel: '9:30 AM',
        description: 'Vendor confirmed — ETA 11:00 AM',
        actor: 'Cool Air HVAC',
      },
      {
        timeLabel: '11:45 AM',
        description: 'SLA breached — vendor delayed by parts',
        actor: 'System',
      },
      {
        timeLabel: '12:05 PM',
        description: 'Auto-notified tenant of delay + offered portable AC',
        actor: 'Ulo AI',
      },
    ],
  }
}

export function buildEscalatedWorkflowReview(
  run: AdminWorkflowRow,
  ticket: SlaOverdueTicketInput | null,
  vendors: SlaOverdueVendorInput[],
  vendorMetrics: PropertyHealthVendorMetrics[],
  suggested?: { id: string; name: string } | null,
  now = Date.now(),
): SlaOverdueActionReview | null {
  const showcase = demoHvacEscalatedShowcase(run)

  if (ticket) {
    const slaReview = buildSlaOverdueActionReview(
      ticket,
      vendors,
      vendorMetrics,
      suggested,
      now,
    )
    if (slaReview) {
      const timeline =
        showcase?.timeline ??
        (run.timeline?.length
          ? timelineFromWorkflowEvents(run.timeline)
          : slaReview.timeline)
      return {
        ...slaReview,
        workflowRunId: run.id,
        badgeLabel: showcase?.badgeLabel ?? slaReview.badgeLabel,
        headerTitle:
          showcase?.headerTitle ??
          `Escalated Maintenance · ${formatCategoryLabel(ticket.issueCategory)}`,
        locationLabel:
          showcase?.locationLabel ??
          formatLocation(run.propertyLabel ?? ticket.building, run.unitLabel ?? ticket.unit),
        ticketRef: showcase?.ticketRef ?? slaReview.ticketRef,
        urgencyLabel: showcase?.urgencyLabel ?? slaReview.urgencyLabel,
        urgencyIsCritical: showcase?.urgencyIsCritical ?? slaReview.urgencyIsCritical,
        reportedAtLabel: showcase?.reportedAtLabel ?? slaReview.reportedAtLabel,
        slaDueLabel: showcase?.slaDueLabel ?? slaReview.slaDueLabel,
        minutesPastSla: showcase?.minutesPastSla ?? slaReview.minutesPastSla,
        pastSlaLabel: showcase?.pastSlaLabel ?? slaReview.pastSlaLabel,
        issueSummary: showcase?.issueSummary ?? slaReview.issueSummary,
        timeline,
      }
    }
  }

  const issueCategory = ticket?.issueCategory ?? null
  const categoryLabel = formatCategoryLabel(issueCategory)
  const dueAt = ticket?.dueAt ?? null
  const dueTs = dueAt ? new Date(dueAt).getTime() : NaN
  const minutesPastSla =
    dueAt && !Number.isNaN(dueTs) && dueTs < now
      ? Math.max(1, Math.round((now - dueTs) / 60_000))
      : null

  const alternatives = ticket ? pickAlternativeVendors(ticket, vendors) : []
  const metricsById = new Map(vendorMetrics.map((m) => [m.vendorId, m]))
  let suggestion: SlaOverdueActionReview['suggestion'] = null
  if (suggested?.name) {
    const metrics = suggested.id ? metricsById.get(suggested.id) : undefined
    suggestion = {
      vendorId: suggested.id,
      vendorName: suggested.name,
      rating: ratingFromMetrics(metrics),
      etaMinutes: etaFromMetrics(metrics),
    }
  } else if (!suggestion && alternatives[0]) {
    const metrics = metricsById.get(alternatives[0].id)
    suggestion = {
      vendorId: alternatives[0].id,
      vendorName: alternatives[0].name,
      rating: ratingFromMetrics(metrics),
      etaMinutes: etaFromMetrics(metrics),
    }
  }

  const noVendorOnRoster =
    alternatives.length === 0 && !suggestion?.vendorId && !suggestion?.vendorName
  const timeline =
    showcase?.timeline ??
    (run.timeline?.length
      ? timelineFromWorkflowEvents(run.timeline)
      : [
          {
            timeLabel: run.lastEventAt ? timeOnly(run.lastEventAt) : '',
            description: run.lastEventMessage?.trim() || `${run.templateName} escalated`,
            actor: 'System',
          },
        ].filter((e) => e.timeLabel))

  const urgency = ticket?.urgency ?? 'high'
  const ticketId = ticket?.id ?? run.entityId ?? run.id

  return {
    ticketId,
    workflowRunId: run.id,
    badgeLabel:
      showcase?.badgeLabel ??
      (minutesPastSla != null ? 'SLA OVERDUE · MAINTENANCE' : 'ESCALATED · MAINTENANCE'),
    headerTitle: showcase?.headerTitle ?? `Escalated Maintenance · ${categoryLabel}`,
    locationLabel:
      showcase?.locationLabel ??
      formatLocation(
        run.propertyLabel ?? ticket?.building ?? null,
        run.unitLabel ?? ticket?.unit ?? null,
      ),
    ticketRef: ticket ? formatTicketRef(ticket.id) : formatTicketRef(run.id),
    urgencyLabel: showcase?.urgencyLabel ?? formatUrgencyLabel(urgency),
    urgencyIsCritical: showcase?.urgencyIsCritical ?? isUrgencyCritical(urgency),
    reportedAtLabel:
      showcase?.reportedAtLabel ??
      (ticket ? formatTicketTime(ticket.createdAt, now) : formatTicketTime(run.startedAt, now)),
    slaDueLabel:
      showcase?.slaDueLabel ??
      (dueAt && ticket
        ? `${formatTicketTime(dueAt, now)}${
            formatSlaDuration(ticket.createdAt, dueAt)
              ? ` (${formatSlaDuration(ticket.createdAt, dueAt)})`
              : ''
          }`
        : '—'),
    slaDurationLabel:
      ticket && dueAt ? formatSlaDuration(ticket.createdAt, dueAt) : null,
    minutesPastSla: showcase?.minutesPastSla ?? minutesPastSla,
    pastSlaLabel:
      showcase?.pastSlaLabel ??
      (minutesPastSla != null ? formatPastSlaLabel(minutesPastSla) : run.lastEventMessage),
    issueSummary:
      showcase?.issueSummary ??
      (ticket?.description?.trim() ||
        run.lastEventMessage?.trim() ||
        `${categoryLabel} escalation requires your review.`),
    currentVendorName: ticket?.assignedVendorName ?? null,
    currentVendorStatus: vendorStatusLabel(
      ticket?.vendorWorkStatus ?? 'escalated',
      ticket?.assignedVendorName ?? null,
    ),
    timeline,
    suggestion,
    suggestionLine: buildSuggestionLineForReview(
      suggestion,
      noVendorOnRoster,
      issueCategory,
    ),
    noVendorOnRoster,
    takeActionMode: noVendorOnRoster ? 'external_vendor' : 'reassign',
  }
}
