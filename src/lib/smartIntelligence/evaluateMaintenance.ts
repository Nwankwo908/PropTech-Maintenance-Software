import { collectAdminWorkflowRuns, workflowOperationsPath } from '@/lib/adminWorkflowKanban'
import { maintenanceTicketIdFromWorkflowRun } from '@/lib/adminWorkflows'
import {
  calendarDaysUntil,
  formatClock,
  isClosedWorkStatus,
  isSafetyTicket,
  looksLikeStatusInquiry,
  repairLabel,
  scoreInsight,
} from '@/lib/smartIntelligence/helpers'
import type { SmartInsight, SmartIntelligenceContext } from '@/lib/smartIntelligence/types'

function runIdForTicket(ctx: SmartIntelligenceContext, ticketId: string): string | undefined {
  if (!ctx.workflowData) return undefined
  const match = collectAdminWorkflowRuns(ctx.workflowData).find(
    (row) => maintenanceTicketIdFromWorkflowRun(row) === ticketId,
  )
  return match?.id
}

function jobRoute(ctx: SmartIntelligenceContext, ticketId: string): string {
  return workflowOperationsPath(runIdForTicket(ctx, ticketId))
}

export function evaluateMaintenanceIntelligence(ctx: SmartIntelligenceContext): SmartInsight[] {
  const now = ctx.now ?? new Date()
  const tickets = (ctx.tickets ?? []).filter((ticket) => !isClosedWorkStatus(ticket.vendorWorkStatus))
  const insights: SmartInsight[] = []

  for (const ticket of tickets) {
    const description = (ticket.description ?? '').trim()
    if (looksLikeStatusInquiry(description)) continue
    const label = repairLabel(ticket.description, ticket.issueCategory)
    const status = ticket.vendorWorkStatus.trim().toLowerCase()
    const safety = isSafetyTicket(ticket)
    const route = jobRoute(ctx, ticket.id)
    const dueDays = ticket.dueAt ? calendarDaysUntil(ticket.dueAt, now) : null
    const scheduledDays = ticket.scheduledAt ? calendarDaysUntil(ticket.scheduledAt, now) : null
    const createdDays = ticket.createdAt ? Math.abs(Math.min(0, calendarDaysUntil(ticket.createdAt, now) ?? 0)) : 0

    if (safety) {
      insights.push({
        id: `maint-safety-${ticket.id}`,
        type: 'maintenance',
        priority: 'urgent',
        title: 'Safety issue needs attention',
        description: `The ${label} is marked as an emergency and still open.`,
        action: { label: 'Review Maintenance', route },
        entityId: ticket.id,
        score: scoreInsight('urgent', { safety: true, waitingOnLandlord: !ticket.assignedVendorId }),
      })
    }

    if (!ticket.assignedVendorId && (status === 'unassigned' || status === '' || status === 'new')) {
      insights.push({
        id: `maint-unassigned-${ticket.id}`,
        type: 'maintenance',
        priority: safety ? 'urgent' : 'attention',
        title: 'Maintenance request awaiting vendor',
        description: `The ${label} has not been assigned to a vendor.`,
        action: { label: 'Find Vendor', route },
        entityId: ticket.id,
        score: scoreInsight(safety ? 'urgent' : 'attention', {
          safety,
          waitingOnLandlord: true,
          overdueDays: createdDays > 1 ? createdDays : 0,
        }),
      })
      continue
    }

    if (dueDays != null && dueDays < 0 && status !== 'completed') {
      insights.push({
        id: `maint-overdue-${ticket.id}`,
        type: 'maintenance',
        priority: 'urgent',
        title: 'Repair overdue',
        description: `The ${label} is past its expected completion window.`,
        action: { label: 'Review Maintenance', route },
        dueAt: ticket.dueAt ?? undefined,
        entityId: ticket.id,
        score: scoreInsight('urgent', { overdueDays: Math.abs(dueDays), safety }),
      })
      continue
    }

    if (scheduledDays === 1 || scheduledDays === 0) {
      const when = scheduledDays === 0 ? 'today' : 'tomorrow'
      const clock = formatClock(ticket.scheduledAt)
      insights.push({
        id: `maint-scheduled-${ticket.id}`,
        type: 'maintenance',
        priority: 'upcoming',
        title: scheduledDays === 0 ? 'Repair scheduled today' : 'Repair scheduled tomorrow',
        description: clock
          ? `The ${label} is scheduled for ${when} at ${clock}.`
          : `The ${label} is scheduled for ${when}.`,
        dueAt: ticket.scheduledAt ?? undefined,
        entityId: ticket.id,
        score: scoreInsight('upcoming', { daysUntil: scheduledDays }),
      })
      continue
    }

    if (
      (status === 'in_progress' || status === 'accepted') &&
      createdDays >= 2 &&
      scheduledDays == null
    ) {
      insights.push({
        id: `maint-waiting-update-${ticket.id}`,
        type: 'maintenance',
        priority: 'attention',
        title: 'Resident waiting for update',
        description: `The resident has not received an update on their open repair.`,
        action: ctx.communicationThreadId
          ? { label: 'Send Update', route: `/admin/communication?thread=${encodeURIComponent(ctx.communicationThreadId)}` }
          : { label: 'Review Job', route },
        entityId: ticket.id,
        score: scoreInsight('attention', { overdueDays: createdDays }),
      })
    }
  }

  return insights
}
