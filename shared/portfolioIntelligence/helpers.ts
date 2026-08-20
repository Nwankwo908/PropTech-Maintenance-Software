import type { PortfolioTicketRow, PortfolioUnitRow } from './types.ts'

export function normalizeUnitLabel(raw: unknown): string {
  const s = String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/^unit\s+/, '')
  if (s.includes('·')) {
    const right = s.split('·').pop()?.trim() ?? ''
    return right.replace(/^unit\s+/, '')
  }
  return s
}

export function formatCategoryName(category: string): string {
  const c = category.replace(/[_-]/g, ' ').trim()
  if (!c) return 'Maintenance'
  return c.replace(/\b\w/g, (ch) => ch.toUpperCase())
}

const CLOSED_STATUSES = new Set([
  'completed',
  'cancelled',
  'closed',
  'resolved',
])

/** Stopped / removed work orders — not real repair history for Property Insights. */
const VOIDED_WORK_STATUSES = new Set(['cancelled', 'deleted'])

export function isInsightEligibleTicket(ticket: PortfolioTicketRow): boolean {
  const status = (ticket.vendorWorkStatus ?? '').trim().toLowerCase()
  return !VOIDED_WORK_STATUSES.has(status)
}

const CRITICAL_URGENCIES = new Set(['urgent', 'high', 'critical', 'emergency'])

export function isOpenTicket(ticket: PortfolioTicketRow): boolean {
  const status = (ticket.vendorWorkStatus ?? '').trim().toLowerCase()
  if (!status) return true
  return !CLOSED_STATUSES.has(status)
}

export function isCriticalTicket(ticket: PortfolioTicketRow): boolean {
  return CRITICAL_URGENCIES.has((ticket.urgency ?? '').trim().toLowerCase())
}

export function buildUnitBuildingMap(units: PortfolioUnitRow[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const u of units) {
    const label = normalizeUnitLabel(u.unitLabel)
    const building = typeof u.building === 'string' ? u.building.trim() : ''
    if (label && building) map.set(label, building)
  }
  return map
}

export function resolveTicketBuilding(
  ticket: PortfolioTicketRow,
  buildingByUnit: Map<string, string>,
): string | null {
  const direct = typeof ticket.building === 'string' ? ticket.building.trim() : ''
  if (direct) return direct
  const unitKey = normalizeUnitLabel(ticket.unit)
  return unitKey ? buildingByUnit.get(unitKey) ?? null : null
}

export function daysSince(iso: string, nowMs: number): number {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return 0
  return Math.max(0, Math.floor((nowMs - t) / (24 * 60 * 60 * 1000)))
}
