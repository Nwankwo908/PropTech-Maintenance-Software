import { workflowOperationsPath } from '@/lib/adminWorkflowKanban'
import { calendarDaysUntil, scoreInsight } from '@/lib/smartIntelligence/helpers'
import type { SmartInsight, SmartIntelligenceContext } from '@/lib/smartIntelligence/types'

export function evaluatePropertyIntelligence(ctx: SmartIntelligenceContext): SmartInsight[] {
  const now = ctx.now ?? new Date()
  const insights: SmartInsight[] = []
  const inspections = ctx.workflowData?.lifecycle.inspections ?? []
  for (const row of inspections) {
    if (row.status === 'completed' || row.status === 'cancelled') continue
    const scheduled = row.scheduledAt
    const days = scheduled ? calendarDaysUntil(scheduled, now) : null
    if (days == null || days < 0 || days > 7) continue
    insights.push({
      id: `inspect-upcoming-${row.id}`,
      type: 'property',
      priority: days <= 1 ? 'upcoming' : 'info',
      title: days === 0 ? 'Inspection today' : days === 1 ? 'Inspection tomorrow' : `Inspection in ${days} days`,
      description: 'An inspection is coming up for this unit.',
      action: { label: 'Review Job', route: workflowOperationsPath(row.id) },
      dueAt: scheduled ?? undefined,
      entityId: row.id,
      score: scoreInsight(days <= 1 ? 'upcoming' : 'info', { daysUntil: days }),
    })
  }
  return insights
}
