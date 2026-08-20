import type { AdminWorkflowRow, AdminWorkflowTimelineEvent } from '@/lib/adminWorkflows'
import {
  isHiddenPipelineTimelineEventType,
  isVisibleLandlordTimelineDescription,
} from '@/lib/landlordFacingTimeline'
import {
  buildSlaOverdueActionReview,
  buildSuggestionLineForReview,
  formatPastSlaLabel,
  isUrgencyCritical,
  isVisibleSlaTimelineEntry,
  pickAlternativeVendors,
  mergeLandlordRailTimeline,
  buildSlaRailTimeline,
  type SlaOverdueActionReview,
  type SlaOverdueTicketInput,
  type SlaOverdueTimelineEntry,
  type SlaOverdueVendorInput,
} from '@/lib/slaOverdueActionReview'
import { formatVendorTradeLabel } from '@/lib/vendorTrades'
import { formatTicketRequestNumber } from '@/lib/vendorCallFlow'
import type { PropertyHealthVendorMetrics } from '@/lib/propertyHealth'

function formatCategoryLabel(slug: string | null): string {
  return formatVendorTradeLabel(slug, { emptyLabel: 'Maintenance' })
}

function formatLocation(propertyLabel: string | null, unitLabel: string | null): string {
  const b = propertyLabel?.trim() || 'Property'
  const u = (unitLabel ?? '').trim()
  if (!u) return b
  const unit = /^unit\s+/i.test(u) ? u.replace(/^unit\s+/i, 'Unit ') : `Unit ${u}`
  return `${b} · ${unit}`
}

function formatTicketRef(id: string): string {
  return formatTicketRequestNumber(id)
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
  if (minutes < 60) return `${minutes} min response time`
  const hours = Math.round(minutes / 60)
  return `${hours} hr response time`
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

function isPipelineLogEvent(event: AdminWorkflowTimelineEvent): boolean {
  if (isHiddenPipelineTimelineEventType(event.eventType)) return true
  const step = (event.step ?? '').trim().toLowerCase()
  if (step === 'log' || step === 'logged') return true
  const label = event.label?.trim() ?? ''
  const message = event.message?.trim() ?? ''
  if (!isVisibleLandlordTimelineDescription(label) && (!message || !isVisibleLandlordTimelineDescription(message))) {
    return true
  }
  return false
}

function timelineFromWorkflowEvents(
  events: AdminWorkflowTimelineEvent[],
): SlaOverdueTimelineEntry[] {
  return [...events]
    .filter((event) => !isPipelineLogEvent(event))
    .sort(
      (a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    )
    .map((event) => ({
      timeLabel: timeOnly(event.createdAt),
      description: event.message?.trim() || event.label,
      actor: timelineActor(event),
    }))
    .filter(
      (entry) =>
        entry.timeLabel &&
        entry.description &&
        isVisibleSlaTimelineEntry(entry),
    )
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

export function buildEscalatedWorkflowReview(
  run: AdminWorkflowRow,
  ticket: SlaOverdueTicketInput | null,
  vendors: SlaOverdueVendorInput[],
  vendorMetrics: PropertyHealthVendorMetrics[],
  suggested?: { id: string; name: string } | null,
  now = Date.now(),
): SlaOverdueActionReview | null {
  if (ticket) {
    const slaReview = buildSlaOverdueActionReview(
      ticket,
      vendors,
      vendorMetrics,
      suggested,
      now,
    )
    if (slaReview) {
      const timeline = mergeLandlordRailTimeline(
        slaReview.timeline,
        run.timeline?.length ? timelineFromWorkflowEvents(run.timeline) : [],
      )
      return {
        ...slaReview,
        workflowRunId: run.id,
        headerTitle: `Escalated Maintenance · ${formatCategoryLabel(ticket.issueCategory)}`,
        locationLabel: formatLocation(
          run.propertyLabel ?? ticket.building,
          run.unitLabel ?? ticket.unit,
        ),
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
  const operational = ticket ? buildSlaRailTimeline(ticket, now) : []
  const fromWorkflow = run.timeline?.length ? timelineFromWorkflowEvents(run.timeline) : []
  const timeline = mergeLandlordRailTimeline(
    operational.length
      ? operational
      : [
          {
            timeLabel: run.lastEventAt ? timeOnly(run.lastEventAt) : '',
            description: run.lastEventMessage?.trim() || `${run.templateName} escalated`,
            actor: 'System',
          },
        ].filter((e) => e.timeLabel && isVisibleSlaTimelineEntry(e)),
    fromWorkflow,
  )

  const urgency = ticket?.urgency ?? 'high'
  const ticketId = ticket?.id ?? run.entityId ?? run.id

  return {
    ticketId,
    workflowRunId: run.id,
    badgeLabel:
      minutesPastSla != null ? 'RESPONSE TIME EXCEEDED' : 'ESCALATED · MAINTENANCE',
    headerTitle: `Escalated Maintenance · ${categoryLabel}`,
    locationLabel: formatLocation(
      run.propertyLabel ?? ticket?.building ?? null,
      run.unitLabel ?? ticket?.unit ?? null,
    ),
    ticketRef: ticket ? formatTicketRef(ticket.id) : formatTicketRef(run.id),
    urgencyLabel: formatUrgencyLabel(urgency),
    urgencyIsCritical: isUrgencyCritical(urgency),
    reportedAtLabel: ticket
      ? formatTicketTime(ticket.createdAt, now)
      : formatTicketTime(run.startedAt, now),
    slaDueLabel:
      dueAt && ticket
        ? `${formatTicketTime(dueAt, now)}${
            formatSlaDuration(ticket.createdAt, dueAt)
              ? ` (${formatSlaDuration(ticket.createdAt, dueAt)})`
              : ''
          }`
        : '—',
    slaDurationLabel: ticket && dueAt ? formatSlaDuration(ticket.createdAt, dueAt) : null,
    minutesPastSla,
    pastSlaLabel:
      minutesPastSla != null ? formatPastSlaLabel(minutesPastSla) : run.lastEventMessage,
    issueSummary:
      ticket?.description?.trim() ||
      run.lastEventMessage?.trim() ||
      `${categoryLabel} escalation requires your review.`,
    issueCategory,
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
