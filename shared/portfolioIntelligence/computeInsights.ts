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
  type PortfolioIntelligenceInput,
} from './types.ts'

const MAX_INSIGHTS = 4

/**
 * Pattern cards for Overview Property Insights.
 * Same algorithm used by Ask Ulo Tier-1 property insights.
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

  const byBuildingCategory = new Map<string, number>()
  for (const t of recentTickets) {
    const building = resolveTicketBuilding(t, buildingByUnit)
    const category =
      typeof t.issueCategory === 'string' && t.issueCategory.trim()
        ? t.issueCategory.trim()
        : null
    if (!building || !category) continue
    const key = `${building}|${category}`
    byBuildingCategory.set(key, (byBuildingCategory.get(key) ?? 0) + 1)
  }

  const topPattern = [...byBuildingCategory.entries()].sort((a, b) => b[1] - a[1])[0]
  let recurringBuilding: string | null = null
  let recurringCategory: string | null = null
  if (topPattern && topPattern[1] >= 2) {
    const [key, count] = topPattern
    const [building, category] = key.split('|')
    recurringBuilding = building
    recurringCategory = category
    insights.push({
      tag: 'RECURRING ISSUES',
      text: `${formatCategoryName(category)} issues keep occurring in ${building}.`,
      score: Math.min(95, 70 + count * 5),
      building,
      categoryLabel: formatCategoryName(category),
      requestCount: count,
    })
  }

  const byUnit = new Map<string, number>()
  for (const t of recentTickets) {
    const key = normalizeUnitLabel(t.unit)
    if (!key) continue
    byUnit.set(key, (byUnit.get(key) ?? 0) + 1)
  }
  const topUnit = [...byUnit.entries()].sort((a, b) => b[1] - a[1])[0]
  if (topUnit && topUnit[1] >= 2) {
    insights.push({
      tag: 'RISK',
      text: `Unit ${topUnit[0].toUpperCase()} has generated the most maintenance requests.`,
      score: Math.min(90, 60 + topUnit[1] * 6),
      unitLabel: `Unit ${topUnit[0].toUpperCase()}`,
      requestCount: topUnit[1],
    })
  }

  const assignedForInsights = eligibleTickets.filter((t) => t.assignedVendorId)
  const assignedCount = assignedForInsights.length
  if (assignedCount > 0) {
    const respondedCount = assignedForInsights.filter((t) => {
      const status = (t.vendorWorkStatus ?? '').trim().toLowerCase()
      return status && status !== 'pending_accept'
    }).length
    const vendorResponse = Math.round((respondedCount / assignedCount) * 100)
    insights.push({
      tag: 'VENDOR RESPONSE',
      text: `Vendors have responded to ${vendorResponse}% of assigned work orders.`,
      score: vendorResponse,
      responseRate: vendorResponse,
      assignedCount,
    })
  }

  const byUnitCategory = new Map<string, number>()
  for (const t of recentTickets) {
    const unitKey = normalizeUnitLabel(t.unit)
    const category =
      typeof t.issueCategory === 'string' && t.issueCategory.trim()
        ? t.issueCategory.trim()
        : null
    if (!unitKey || !category) continue
    byUnitCategory.set(`${unitKey}|${category}`, (byUnitCategory.get(`${unitKey}|${category}`) ?? 0) + 1)
  }
  const unitCategoryCandidates = [...byUnitCategory.entries()]
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
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
    const [key, count] = preventPick
    const [unitKey, category] = key.split('|')
    insights.push({
      tag: 'PREVENT FUTURE REPAIRS',
      text: `A preventive ${formatCategoryName(category).toLowerCase()} inspection is recommended for Unit ${unitKey.toUpperCase()}.`,
      score: Math.min(95, 65 + count * 4),
      categoryLabel: formatCategoryName(category),
      requestCount: count,
      unitLabel: `Unit ${unitKey.toUpperCase()}`,
    })
  }

  return insights.slice(0, MAX_INSIGHTS)
}
