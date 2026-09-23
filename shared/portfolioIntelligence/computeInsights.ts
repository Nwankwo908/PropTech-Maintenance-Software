import {
  buildUnitBuildingMap,
  formatCategoryName,
  isInsightEligibleTicket,
  normalizeUnitLabel,
  resolveTicketBuilding,
} from './helpers.ts'
import {
  PORTFOLIO_INSIGHT_WINDOW_MS,
  type PortfolioInsightFinding,
  type PortfolioInsightTicketSummary,
  type PortfolioIntelligenceInput,
  type PortfolioTicketRow,
  type PortfolioUnitRow,
} from './types.ts'

const MAX_INSIGHTS = 4

function ticketSummary(ticket: PortfolioTicketRow): PortfolioInsightTicketSummary | null {
  const id = typeof ticket.id === 'string' ? ticket.id.trim() : ''
  if (!id) return null
  const description =
    typeof ticket.description === 'string' && ticket.description.trim()
      ? ticket.description.trim().slice(0, 200)
      : typeof ticket.issueCategory === 'string' && ticket.issueCategory.trim()
        ? formatCategoryName(ticket.issueCategory)
        : 'Maintenance request'
  return { id, description }
}

function collectTicketMeta(tickets: PortfolioTicketRow[]): {
  ticketIds: string[]
  ticketSummaries: PortfolioInsightTicketSummary[]
} {
  const ticketIds: string[] = []
  const ticketSummaries: PortfolioInsightTicketSummary[] = []
  const seen = new Set<string>()
  for (const ticket of tickets) {
    const summary = ticketSummary(ticket)
    if (!summary || seen.has(summary.id)) continue
    seen.add(summary.id)
    ticketIds.push(summary.id)
    ticketSummaries.push(summary)
  }
  return { ticketIds, ticketSummaries }
}

function resolveUnitId(
  unitKey: string,
  tickets: PortfolioTicketRow[],
  units: PortfolioUnitRow[],
): string | null {
  for (const ticket of tickets) {
    if (normalizeUnitLabel(ticket.unit) !== unitKey) continue
    const id = typeof ticket.unitId === 'string' ? ticket.unitId.trim() : ''
    if (id) return id
  }
  for (const unit of units) {
    if (normalizeUnitLabel(unit.unitLabel) !== unitKey) continue
    const id = typeof unit.id === 'string' ? unit.id.trim() : ''
    if (id) return id
  }
  return null
}

/**
 * Pattern cards for Overview Property Insights.
 * Same algorithm used by Ask Ulo Tier-1 property insights.
 * Aggregation queries stay deterministic — ticket IDs are attached for grounding.
 */
export function computePortfolioInsights(
  input: PortfolioIntelligenceInput,
): PortfolioInsightFinding[] {
  const now = input.now ?? Date.now()
  const sinceMs = now - PORTFOLIO_INSIGHT_WINDOW_MS
  const buildingByUnit = buildUnitBuildingMap(input.units)

  const eligibleTickets = input.tickets.filter(isInsightEligibleTicket)
  const recentTickets = eligibleTickets.filter((t) => {
    const ts = Date.parse(t.createdAt)
    return !Number.isNaN(ts) && ts >= sinceMs
  })

  const insights: PortfolioInsightFinding[] = []

  const byBuildingCategory = new Map<string, PortfolioTicketRow[]>()
  for (const t of recentTickets) {
    const building = resolveTicketBuilding(t, buildingByUnit)
    const category =
      typeof t.issueCategory === 'string' && t.issueCategory.trim()
        ? t.issueCategory.trim()
        : null
    if (!building || !category) continue
    const key = `${building}|${category}`
    const list = byBuildingCategory.get(key) ?? []
    list.push(t)
    byBuildingCategory.set(key, list)
  }

  const topPattern = [...byBuildingCategory.entries()].sort(
    (a, b) => b[1].length - a[1].length,
  )[0]
  let recurringBuilding: string | null = null
  let recurringCategory: string | null = null
  if (topPattern && topPattern[1].length >= 2) {
    const [key, tickets] = topPattern
    const [building, category] = key.split('|')
    recurringBuilding = building
    recurringCategory = category
    const meta = collectTicketMeta(tickets)
    insights.push({
      tag: 'RECURRING ISSUES',
      text: `${formatCategoryName(category)} issues keep occurring in ${building}.`,
      score: Math.min(95, 70 + tickets.length * 5),
      building,
      categoryLabel: formatCategoryName(category),
      requestCount: tickets.length,
      ...meta,
    })
  }

  const byUnit = new Map<string, PortfolioTicketRow[]>()
  for (const t of recentTickets) {
    const key = normalizeUnitLabel(t.unit)
    if (!key) continue
    const list = byUnit.get(key) ?? []
    list.push(t)
    byUnit.set(key, list)
  }
  const topUnit = [...byUnit.entries()].sort((a, b) => b[1].length - a[1].length)[0]
  if (topUnit && topUnit[1].length >= 2) {
    const [unitKey, tickets] = topUnit
    const meta = collectTicketMeta(tickets)
    insights.push({
      tag: 'RISK',
      text: `Unit ${unitKey.toUpperCase()} has generated the most maintenance requests.`,
      score: Math.min(90, 60 + tickets.length * 6),
      unitLabel: `Unit ${unitKey.toUpperCase()}`,
      unitId: resolveUnitId(unitKey, tickets, input.units),
      requestCount: tickets.length,
      ...meta,
    })
  }

  const byUnitCategory = new Map<string, PortfolioTicketRow[]>()
  for (const t of recentTickets) {
    const unitKey = normalizeUnitLabel(t.unit)
    const category =
      typeof t.issueCategory === 'string' && t.issueCategory.trim()
        ? t.issueCategory.trim()
        : null
    if (!unitKey || !category) continue
    const key = `${unitKey}|${category}`
    const list = byUnitCategory.get(key) ?? []
    list.push(t)
    byUnitCategory.set(key, list)
  }
  const unitCategoryCandidates = [...byUnitCategory.entries()]
    .filter(([, tickets]) => tickets.length >= 2)
    .sort((a, b) => b[1].length - a[1].length)
  const preventPick =
    unitCategoryCandidates.find(([key]) => {
      const [unitKey, category] = key.split('|')
      if (recurringCategory && category === recurringCategory) {
        const building = buildingByUnit.get(unitKey)
        if (building && building === recurringBuilding) return false
      }
      return true
    }) ?? unitCategoryCandidates[0]
  if (preventPick) {
    const [key, tickets] = preventPick
    const [unitKey, category] = key.split('|')
    const meta = collectTicketMeta(tickets)
    insights.push({
      tag: 'PREVENT FUTURE REPAIRS',
      text: `A preventive ${formatCategoryName(category).toLowerCase()} inspection is recommended for Unit ${unitKey.toUpperCase()}.`,
      score: Math.min(95, 65 + tickets.length * 4),
      categoryLabel: formatCategoryName(category),
      requestCount: tickets.length,
      unitLabel: `Unit ${unitKey.toUpperCase()}`,
      unitId: resolveUnitId(unitKey, tickets, input.units),
      ...meta,
    })
  }

  return insights.slice(0, MAX_INSIGHTS)
}
