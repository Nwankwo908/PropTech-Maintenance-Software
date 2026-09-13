import { scoreInsight } from '@/lib/smartIntelligence/helpers'
import type { SmartInsight, SmartIntelligenceContext } from '@/lib/smartIntelligence/types'

export function evaluateResidentIntelligence(ctx: SmartIntelligenceContext): SmartInsight[] {
  const status = (ctx.resident.activationStatus ?? '').trim().toLowerCase()
  if (status !== 'action_required') return []

  return [
    {
      id: `resident-onboarding-${ctx.resident.id}`,
      type: 'resident',
      priority: 'attention',
      title: 'Resident onboarding needs a follow-up',
      description: `${ctx.resident.name.split(/\s+/)[0] || 'This resident'} has not finished text onboarding.`,
      action: undefined,
      entityId: ctx.resident.id,
      score: scoreInsight('attention', { waitingOnLandlord: true }),
    },
  ]
}

