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

/** Landlord-initiated inspection batch (HQS letter) — not an independent tenant report. */
export function isInspectionSourcedTicket(ticket: PortfolioTicketRow): boolean {
  const id =
    typeof ticket.inspectionReportId === 'string'
      ? ticket.inspectionReportId.trim()
      : ''
  return Boolean(id)
}

/**
 * Tickets that may contribute to Recurring Issues / Needs Attention /
 * Prevent Future Repairs. Inspection-sourced batches are excluded — they are
 * one proactive sweep, not independent recurring reports over time.
 */
export function isPatternInsightEligibleTicket(
  ticket: PortfolioTicketRow,
): boolean {
  return isInsightEligibleTicket(ticket) && !isInspectionSourcedTicket(ticket)
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

function unitIdKey(unitId: string): string {
  return `id:${unitId}`
}

function propertyLabelKey(propertyId: string, unitKey: string): string {
  return `prop:${propertyId}|${unitKey}`
}

function landlordLabelKey(landlordId: string, unitKey: string): string {
  return `ll:${landlordId}|${unitKey}`
}

/**
 * Unit → building lookup scoped like maintenance_unit_label_match:
 * unit_id, then property_id+label, then landlord_id+label only when unique.
 * Never key by bare unit label — ambiguous/unscoped → no entry.
 */
export function buildUnitBuildingMap(units: PortfolioUnitRow[]): Map<string, string> {
  const map = new Map<string, string>()
  const landlordLabelHits = new Map<string, { building: string; count: number }>()

  for (const u of units) {
    const label = normalizeUnitLabel(u.unitLabel)
    const building = typeof u.building === 'string' ? u.building.trim() : ''
    const unitId = typeof u.id === 'string' ? u.id.trim() : ''
    const propertyId = typeof u.propertyId === 'string' ? u.propertyId.trim() : ''
    const landlordId = typeof u.landlordId === 'string' ? u.landlordId.trim() : ''

    if (unitId && building) map.set(unitIdKey(unitId), building)
    if (propertyId && label && building) {
      map.set(propertyLabelKey(propertyId, label), building)
    }
    if (landlordId && label && building) {
      const k = landlordLabelKey(landlordId, label)
      const prior = landlordLabelHits.get(k)
      if (!prior) {
        landlordLabelHits.set(k, { building, count: 1 })
      } else {
        prior.count += 1
        // Ambiguous landlord+label — drop later.
        if (prior.building !== building) prior.building = ''
      }
    }
  }

  for (const [k, hit] of landlordLabelHits) {
    if (hit.count === 1 && hit.building) map.set(k, hit.building)
  }

  return map
}

/**
 * Resolve a ticket's building for display only.
 * Never uses an unscoped unit-label match (same root bug as enriched unit join).
 */
export function resolveTicketBuilding(
  ticket: PortfolioTicketRow,
  buildingByUnit: Map<string, string>,
): string | null {
  const direct = typeof ticket.building === 'string' ? ticket.building.trim() : ''
  if (direct) return direct

  const unitId = typeof ticket.unitId === 'string' ? ticket.unitId.trim() : ''
  if (unitId) {
    const byId = buildingByUnit.get(unitIdKey(unitId))
    if (byId) return byId
  }

  const unitKey = normalizeUnitLabel(ticket.unit)
  if (!unitKey) return null

  const propertyId =
    typeof ticket.propertyId === 'string' ? ticket.propertyId.trim() : ''
  if (propertyId) {
    return buildingByUnit.get(propertyLabelKey(propertyId, unitKey)) ?? null
  }

  const landlordId =
    typeof ticket.landlordId === 'string' ? ticket.landlordId.trim() : ''
  if (landlordId) {
    return buildingByUnit.get(landlordLabelKey(landlordId, unitKey)) ?? null
  }

  // No property/landlord scope → refuse to guess.
  return null
}

/** Canonical property id on the ticket — never inferred from building name. */
export function resolveTicketPropertyId(
  ticket: PortfolioTicketRow,
): string | null {
  const id = typeof ticket.propertyId === 'string' ? ticket.propertyId.trim() : ''
  return id || null
}

/**
 * Stable unit grouping key: prefer unit_id, else property-scoped label.
 * Bare unit labels (no property) are not used.
 */
export function resolveTicketUnitGroupKey(
  ticket: PortfolioTicketRow,
): string | null {
  const unitId = typeof ticket.unitId === 'string' ? ticket.unitId.trim() : ''
  if (unitId) return `uid:${unitId}`

  const propertyId = resolveTicketPropertyId(ticket)
  const unitKey = normalizeUnitLabel(ticket.unit)
  if (propertyId && unitKey) return `prop:${propertyId}|${unitKey}`
  return null
}

export function daysSince(iso: string, nowMs: number): number {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return 0
  return Math.max(0, Math.floor((nowMs - t) / (24 * 60 * 60 * 1000)))
}
