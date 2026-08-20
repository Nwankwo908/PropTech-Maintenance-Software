import {
  daysSince,
  isCriticalTicket,
  isOpenTicket,
  resolveTicketBuilding,
  buildUnitBuildingMap,
} from './helpers.ts'
import type {
  PortfolioIntelligenceInput,
  PortfolioRecommendation,
} from './types.ts'

const STALLED_DAYS = 10
const STALLED_MIN_OPEN = 2
const ESCALATION_STACK_MIN = 3

type BuildingAgg = {
  building: string
  open: PortfolioIntelligenceInput['tickets']
  critical: number
  oldestDays: number
}

function scoreBuilding(agg: BuildingAgg): number {
  return agg.critical * 100 + agg.open.length * 12 + agg.oldestDays * 3
}

function recommendedActionForBuilding(agg: BuildingAgg): string {
  if (agg.critical > 0) {
    return 'Review critical requests first and confirm resident safety or habitability.'
  }
  if (agg.oldestDays >= STALLED_DAYS) {
    return 'Prioritize repair requests that have been waiting longer than expected and confirm vendors are responding on time.'
  }
  return 'Work the open maintenance backlog starting with the oldest tickets.'
}

/**
 * Action-oriented proactive signals — distinct from Property Insights pattern cards.
 * Only high-confidence recommendations are surfaced to notifications.
 */
export function computePortfolioRecommendations(
  input: PortfolioIntelligenceInput,
): PortfolioRecommendation[] {
  const now = input.now ?? Date.now()
  const buildingByUnit = buildUnitBuildingMap(input.units)
  const openTickets = input.tickets.filter(isOpenTicket)
  const recommendations: PortfolioRecommendation[] = []

  const byBuilding = new Map<string, BuildingAgg>()
  for (const ticket of openTickets) {
    const building = resolveTicketBuilding(ticket, buildingByUnit)
    if (!building) continue
    let agg = byBuilding.get(building)
    if (!agg) {
      agg = { building, open: [], critical: 0, oldestDays: 0 }
      byBuilding.set(building, agg)
    }
    agg.open.push(ticket)
    if (isCriticalTicket(ticket)) agg.critical += 1
    agg.oldestDays = Math.max(agg.oldestDays, daysSince(ticket.createdAt, now))
  }

  const rankedBuildings = [...byBuilding.values()]
    .filter((agg) => agg.open.length > 0 && (agg.critical > 0 || agg.oldestDays >= STALLED_DAYS))
    .sort((a, b) => scoreBuilding(b) - scoreBuilding(a))

  const top = rankedBuildings[0]
  if (top && (top.critical > 0 || top.open.length >= STALLED_MIN_OPEN)) {
    const action = recommendedActionForBuilding(top)
    const signature = `critical:${top.critical}|open:${top.open.length}|oldest:${top.oldestDays}`
    recommendations.push({
      kind: 'priority_property',
      deduplicationKey: `priority_property:${top.building.toLowerCase()}`,
      confidence: top.critical > 0 ? 'high' : 'high',
      severity: top.critical > 0 ? 'critical' : 'warning',
      title: `Start at ${top.building}`,
      message:
        top.critical > 0
          ? `${top.building} has ${top.critical} critical open request${top.critical === 1 ? '' : 's'} and ${top.open.length} open work order${top.open.length === 1 ? '' : 's'}. ${action}`
          : `${top.building} has ${top.open.length} open work orders, including items open ${top.oldestDays}+ days. ${action}`,
      actionLabel: top.critical > 0 ? 'Review critical items' : 'Review open work',
      building: top.building,
      signature,
      metadata: {
        recommendation_kind: 'priority_property',
        building: top.building,
        critical_count: top.critical,
        open_count: top.open.length,
        oldest_days: top.oldestDays,
        recommended_action: action,
      },
    })
  }

  for (const agg of rankedBuildings) {
    if (agg === top) continue
    if (agg.open.length < STALLED_MIN_OPEN || agg.oldestDays < STALLED_DAYS) continue
    const signature = `open:${agg.open.length}|oldest:${agg.oldestDays}`
    recommendations.push({
      kind: 'stalled_maintenance',
      deduplicationKey: `stalled_maintenance:${agg.building.toLowerCase()}`,
      confidence: agg.oldestDays >= 14 ? 'high' : 'medium',
      severity: agg.oldestDays >= 14 ? 'warning' : 'warning',
      title: `Maintenance stalling at ${agg.building}`,
      message: `${agg.open.length} open work orders at ${agg.building} include items that have been open ${agg.oldestDays}+ days. Follow up with assigned vendors or reassign before these become emergencies.`,
      actionLabel: 'Review stalled work',
      building: agg.building,
      signature,
      metadata: {
        recommendation_kind: 'stalled_maintenance',
        building: agg.building,
        open_count: agg.open.length,
        oldest_days: agg.oldestDays,
      },
    })
  }

  const escalated = (input.escalatedWorkflows ?? []).filter(
    (w) => w.status.toLowerCase() === 'escalated',
  )
  if (escalated.length >= ESCALATION_STACK_MIN) {
    const signature = `count:${escalated.length}`
    recommendations.push({
      kind: 'escalation_stack',
      deduplicationKey: 'escalation_stack:portfolio',
      confidence: 'high',
      severity: escalated.length >= 5 ? 'critical' : 'warning',
      title: `${escalated.length} escalated workflows need review`,
      message: `Ulo has ${escalated.length} escalated workflows waiting for your decision. Review the highest-risk items first so nothing slips past response time.`,
      actionLabel: 'Review escalations',
      signature,
      metadata: {
        recommendation_kind: 'escalation_stack',
        escalated_count: escalated.length,
        template_names: [...new Set(escalated.map((w) => w.templateName).filter(Boolean))].slice(0, 5),
      },
    })
  }

  return recommendations.filter((r) => r.confidence === 'high')
}
