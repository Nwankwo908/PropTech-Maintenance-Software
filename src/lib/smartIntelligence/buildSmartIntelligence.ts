import { evaluateLeaseIntelligence } from '@/lib/smartIntelligence/evaluateLease'
import { evaluateMaintenanceIntelligence } from '@/lib/smartIntelligence/evaluateMaintenance'
import { evaluatePropertyIntelligence } from '@/lib/smartIntelligence/evaluateProperty'
import { evaluateRentIntelligence } from '@/lib/smartIntelligence/evaluateRent'
import { evaluateResidentIntelligence } from '@/lib/smartIntelligence/evaluateResident'
import { evaluateVendorIntelligence } from '@/lib/smartIntelligence/evaluateVendor'
import type { SmartInsight, SmartIntelligenceContext } from '@/lib/smartIntelligence/types'
import { SMART_INTELLIGENCE_MAX } from '@/lib/smartIntelligence/types'

const PRIORITY_RANK: Record<SmartInsight['priority'], number> = {
  urgent: 0,
  attention: 1,
  upcoming: 2,
  info: 3,
}

function workOrderKey(insight: SmartInsight): string | null {
  if (!insight.entityId) return null
  if (insight.type === 'maintenance' || insight.type === 'vendor') {
    return `wo:${insight.entityId}`
  }
  return null
}

/** Keep the stronger signal when rent/lease/job insights overlap. */
export function mergeRelatedInsights(insights: SmartInsight[]): SmartInsight[] {
  const rent = insights.filter((item) => item.type === 'rent')
  const combined = rent.find((item) => item.id.startsWith('rent-combined-'))
  const rentKept = combined
    ? [combined]
    : rent.filter((item) => {
        if (combined) return false
        const hasOverdueOrToday = rent.some((row) =>
          row.id.includes('overdue') || row.id.includes('due-today'),
        )
        if (hasOverdueOrToday && item.id.includes('balance')) return false
        if (hasOverdueOrToday && item.id.includes('due-soon')) return false
        return true
      })

  const byWorkOrder = new Map<string, SmartInsight>()
  const rest: SmartInsight[] = []
  for (const insight of insights) {
    if (insight.type === 'rent') continue
    const key = workOrderKey(insight)
    if (!key) {
      rest.push(insight)
      continue
    }
    const existing = byWorkOrder.get(key)
    if (!existing || insight.score > existing.score) {
      byWorkOrder.set(key, insight)
    }
  }

  const lease = rest.filter((item) => item.type === 'lease')
  const topLease = lease.sort((a, b) => b.score - a.score)[0]
  const withoutLeaseDupes = rest.filter((item) => item.type !== 'lease')
  if (topLease) withoutLeaseDupes.push(topLease)

  return [...rentKept, ...byWorkOrder.values(), ...withoutLeaseDupes]
}

export function rankSmartInsights(
  insights: SmartInsight[],
  max = SMART_INTELLIGENCE_MAX,
): SmartInsight[] {
  return [...insights]
    .sort((a, b) => {
      const byPriority = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]
      if (byPriority !== 0) return byPriority
      return b.score - a.score
    })
    .slice(0, Math.max(1, max))
}

export function buildSmartIntelligence(ctx: SmartIntelligenceContext): SmartInsight[] {
  const candidates = [
    ...evaluateRentIntelligence(ctx),
    ...evaluateLeaseIntelligence(ctx),
    ...evaluateMaintenanceIntelligence(ctx),
    ...evaluateVendorIntelligence(ctx),
    ...evaluateResidentIntelligence(ctx),
    ...evaluatePropertyIntelligence(ctx),
  ]
  const unique = new Map<string, SmartInsight>()
  for (const insight of candidates) {
    const existing = unique.get(insight.id)
    if (!existing || insight.score > existing.score) unique.set(insight.id, insight)
  }
  const merged = mergeRelatedInsights([...unique.values()])
  return rankSmartInsights(merged, ctx.maxInsights ?? SMART_INTELLIGENCE_MAX)
}

export function attentionCount(insights: SmartInsight[]): number {
  return insights.filter((item) => item.priority === 'urgent' || item.priority === 'attention').length
}
