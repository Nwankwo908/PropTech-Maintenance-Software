import { collectAdminWorkflowRuns, workflowOperationsPath } from '@/lib/adminWorkflowKanban'
import { emptyAdminWorkflowDashboardData } from '@/lib/adminWorkflows'
import { calendarDaysUntil, formatLongDate, possessive, scoreInsight } from '@/lib/smartIntelligence/helpers'
import type { SmartInsight, SmartIntelligenceContext } from '@/lib/smartIntelligence/types'

const RENEWAL_WINDOW_DAYS = 60
const EXPIRE_SOON_DAYS = 45
const WINDOW_APPROACHING_FROM = 67

export function evaluateLeaseIntelligence(ctx: SmartIntelligenceContext): SmartInsight[] {
  const now = ctx.now ?? new Date()
  const end = ctx.resident.leaseEndDate
  const days = end ? calendarDaysUntil(end, now) : null
  const whose = possessive(ctx.resident.name)
  const unit = ctx.resident.unitDisplay.trim()
  const endLabel = formatLongDate(end)
  const renewalRun = collectAdminWorkflowRuns(ctx.workflowData ?? emptyAdminWorkflowDashboardData())
    .filter((row) => row.templateId === 'lease_renewal' && row.status !== 'completed' && row.status !== 'cancelled')
    .sort((a, b) => (a.status === 'escalated' ? -1 : 0) - (b.status === 'escalated' ? -1 : 0))[0]

  const insights: SmartInsight[] = []
  const leaseRoute = '#resident-lease'
  const renewalRoute = workflowOperationsPath(renewalRun?.id)

  if (renewalRun?.status === 'escalated') {
    insights.push({
      id: `lease-renewal-decision-${ctx.resident.id}`,
      type: 'lease',
      priority: 'urgent',
      title: 'Lease renewal needs a decision',
      description: days != null && days >= 0
        ? `${whose} lease ends in ${days} days and still needs a renewal decision.`
        : `${whose} lease renewal is waiting on a decision from the property team.`,
      action: { label: 'Review Lease', route: renewalRoute },
      dueAt: end ?? undefined,
      entityId: renewalRun.id,
      score: scoreInsight('urgent', { waitingOnLandlord: true, daysUntil: days ?? undefined }),
    })
    return insights
  }

  if (days == null) return insights

  if (days < 0) {
    insights.push({
      id: `lease-expired-${ctx.resident.id}`,
      type: 'lease',
      priority: 'urgent',
      title: 'Lease has ended',
      description: endLabel
        ? `${whose} lease at ${unit || 'this unit'} ended ${endLabel}.`
        : `${whose} lease has ended.`,
      action: { label: 'Review Lease', route: leaseRoute },
      dueAt: end ?? undefined,
      entityId: ctx.resident.id,
      score: scoreInsight('urgent', { overdueDays: Math.abs(days), waitingOnLandlord: true }),
    })
    return insights
  }

  if (days <= EXPIRE_SOON_DAYS) {
    insights.push({
      id: `lease-expires-soon-${ctx.resident.id}`,
      type: 'lease',
      priority: 'attention',
      title: `Lease expires in ${days} days`,
      description: endLabel
        ? `${whose} lease${unit ? ` at ${unit}` : ''} expires ${endLabel}. Consider starting the renewal conversation.`
        : `${whose} lease expires in ${days} days. Consider starting the renewal conversation.`,
      action: { label: renewalRun ? 'Start Renewal' : 'Review Lease', route: renewalRun ? renewalRoute : leaseRoute },
      dueAt: end,
      entityId: renewalRun?.id ?? ctx.resident.id,
      score: scoreInsight('attention', { daysUntil: days, waitingOnLandlord: true }),
    })
    return insights
  }

  if (days <= WINDOW_APPROACHING_FROM && days > RENEWAL_WINDOW_DAYS) {
    const untilWindow = days - RENEWAL_WINDOW_DAYS
    insights.push({
      id: `lease-renewal-window-${ctx.resident.id}`,
      type: 'lease',
      priority: 'upcoming',
      title: 'Lease renewal approaching',
      description:
        untilWindow <= 7
          ? 'The lease enters the recommended renewal window next week.'
          : `The recommended renewal window opens in ${untilWindow} days.`,
      action: { label: 'Start Renewal', route: renewalRun ? renewalRoute : leaseRoute },
      dueAt: end,
      entityId: ctx.resident.id,
      score: scoreInsight('upcoming', { daysUntil: untilWindow }),
    })
  }

  return insights
}
