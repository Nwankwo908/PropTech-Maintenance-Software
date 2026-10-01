import {
  buildUnitBuildingMap,
  formatCategoryName,
  isPatternInsightEligibleTicket,
  normalizeUnitLabel,
  resolveTicketBuilding,
  resolveTicketPropertyId,
  resolveTicketUnitGroupKey,
} from './helpers.ts'
import {
  PORTFOLIO_INSIGHT_WINDOW_MS,
  type PortfolioInsightFinding,
  type PortfolioInsightTicketSummary,
  type PortfolioIntelligenceInput,
  type PortfolioTicketRow,
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

function displayBuildingForTickets(
  tickets: PortfolioTicketRow[],
  buildingByUnit: Map<string, string>,
): string | null {
  for (const ticket of tickets) {
    const building = resolveTicketBuilding(ticket, buildingByUnit)
    if (building) return building
  }
  return null
}

function displayUnitLabel(tickets: PortfolioTicketRow[]): string | null {
  for (const ticket of tickets) {
    const unitId = typeof ticket.unitId === 'string' ? ticket.unitId.trim() : ''
    const label = normalizeUnitLabel(ticket.unit)
    if (label) return `Unit ${label.toUpperCase()}`
    if (unitId) return 'Unit'
  }
  return null
}

function resolveUnitIdFromGroup(tickets: PortfolioTicketRow[]): string | null {
  for (const ticket of tickets) {
    const id = typeof ticket.unitId === 'string' ? ticket.unitId.trim() : ''
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

  // Pattern cards only — exclude inspection_report_id batches (HQS letter, etc.).
  const eligibleTickets = input.tickets.filter(isPatternInsightEligibleTicket)
  const recentTickets = eligibleTickets.filter((t) => {
    const ts = Date.parse(t.createdAt)
    return !Number.isNaN(ts) && ts >= sinceMs
  })

  const insights: PortfolioInsightFinding[] = []

  // Recurring Issues: property_id + category — never building name / bare unit label.
  const byPropertyCategory = new Map<string, PortfolioTicketRow[]>()
  for (const t of recentTickets) {
    const propertyId = resolveTicketPropertyId(t)
    const category =
      typeof t.issueCategory === 'string' && t.issueCategory.trim()
        ? t.issueCategory.trim()
        : null
    if (!propertyId || !category) continue
    const key = `${propertyId}|${category}`
    const list = byPropertyCategory.get(key) ?? []
    list.push(t)
    byPropertyCategory.set(key, list)
  }

  const topPattern = [...byPropertyCategory.entries()].sort(
    (a, b) => b[1].length - a[1].length,
  )[0]
  let recurringPropertyId: string | null = null
  let recurringCategory: string | null = null
  // Recurring requires ≥2 separate jobs at the same property + category.
  if (topPattern && topPattern[1].length >= 2) {
    const [key, tickets] = topPattern
    const [propertyId, category] = key.split('|')
    recurringPropertyId = propertyId
    recurringCategory = category
    const building =
      displayBuildingForTickets(tickets, buildingByUnit) ?? 'this property'
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

  // Needs Attention (RISK): unit_id or property-scoped unit label — never bare label.
  const byUnit = new Map<string, PortfolioTicketRow[]>()
  for (const t of recentTickets) {
    const key = resolveTicketUnitGroupKey(t)
    if (!key) continue
    const list = byUnit.get(key) ?? []
    list.push(t)
    byUnit.set(key, list)
  }
  const topUnit = [...byUnit.entries()].sort((a, b) => b[1].length - a[1].length)[0]
  if (topUnit && topUnit[1].length >= 2) {
    const [, tickets] = topUnit
    const meta = collectTicketMeta(tickets)
    const unitLabel = displayUnitLabel(tickets) ?? 'Unit'
    insights.push({
      tag: 'RISK',
      text: `${unitLabel} has generated the most maintenance requests.`,
      score: Math.min(90, 60 + tickets.length * 6),
      unitLabel,
      unitId: resolveUnitIdFromGroup(tickets),
      requestCount: tickets.length,
      ...meta,
    })
  }

  // Prevent Future Repairs: same scoped unit key + category.
  const byUnitCategory = new Map<string, PortfolioTicketRow[]>()
  for (const t of recentTickets) {
    const unitKey = resolveTicketUnitGroupKey(t)
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
    unitCategoryCandidates.find(([, tickets]) => {
      const category =
        typeof tickets[0]?.issueCategory === 'string'
          ? tickets[0].issueCategory.trim()
          : ''
      if (recurringCategory && category === recurringCategory) {
        const propertyId = resolveTicketPropertyId(tickets[0]!)
        if (propertyId && propertyId === recurringPropertyId) return false
      }
      return true
    }) ?? unitCategoryCandidates[0]
  if (preventPick) {
    const [, tickets] = preventPick
    const category =
      typeof tickets[0]?.issueCategory === 'string'
        ? tickets[0].issueCategory.trim()
        : 'maintenance'
    const meta = collectTicketMeta(tickets)
    const unitLabel = displayUnitLabel(tickets) ?? 'Unit'
    insights.push({
      tag: 'PREVENT FUTURE REPAIRS',
      text: `A preventive ${formatCategoryName(category).toLowerCase()} inspection is recommended for ${unitLabel}.`,
      score: Math.min(95, 65 + tickets.length * 4),
      categoryLabel: formatCategoryName(category),
      requestCount: tickets.length,
      unitLabel,
      unitId: resolveUnitIdFromGroup(tickets),
      ...meta,
    })
  }

  // Vendor Response: portfolio-wide rate — no unit/building/property grouping.
  // (Not emitted here historically when rate is healthy; no label-match hazard.)

  return insights.slice(0, MAX_INSIGHTS)
}
