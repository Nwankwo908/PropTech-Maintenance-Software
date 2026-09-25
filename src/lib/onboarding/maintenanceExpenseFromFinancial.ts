/**
 * Classify onboarding financial lines that should become Property History spend.
 */
import { normalizeBuildingKey } from '@/lib/propertyHealth'

export type FinancialExpenseLike = {
  recordType: string
  description: string
  amount?: string
  period?: string
  building?: string
  unit?: string
}

const NON_MAINTENANCE =
  /\b(rent(?:al)?\s+income|rental\s+revenue|gross\s+income|mortgage|property\s+tax|tax\s+bill|insurance\s+premium|management\s+fee|hoa(?:\s+fee)?|utility|utilities|water\s+bill|electric(?:ity)?\s+bill|gas\s+bill|late\s+fee|security\s+deposit)\b/i

const MAINTENANCE_TYPE =
  /\b(maintenance|repair|capex|capital\s+improvement|vendor\s+invoice|work\s+order|contractor|service\s+invoice)\b/i

const MAINTENANCE_DESC =
  /\b(repair|plumb(?:ing)?|hvac|electr(?:ical|ician)?|roof|paint(?:ing)?|appliance|handyman|maintenance|leak|furnace|boiler|water\s+heater|flooring|carpentry|locksmith|pest|drywall|gutter|siding|window|door|contractor|work\s+order|vendor\s+invoice)\b/i

/** Expense / invoice line that represents maintenance spend (not rent/tax/income). */
export function isMaintenanceExpenseFinancialRecord(record: FinancialExpenseLike): boolean {
  const recordType = (record.recordType ?? '').trim()
  const description = (record.description ?? '').trim()
  const blob = `${recordType} ${description}`.trim()
  if (!blob) return false

  if (NON_MAINTENANCE.test(blob) && !MAINTENANCE_DESC.test(blob)) {
    return false
  }
  if (MAINTENANCE_TYPE.test(recordType) || MAINTENANCE_DESC.test(blob)) {
    return true
  }
  // Vendor invoice / expense report lines often use a generic "Expense" type with a repair description.
  if (/^(expense|invoice|bill|line\s*item)$/i.test(recordType) && MAINTENANCE_DESC.test(description)) {
    return true
  }
  return false
}

/** Parse "$4,200.00" / "4200" → number; 0 when unparseable. */
export function parseFinancialAmount(amount: string | null | undefined): number {
  const raw = (amount ?? '').trim()
  if (!raw) return 0
  const negative = /^\(.*\)$/.test(raw) || raw.startsWith('-')
  const cleaned = raw.replace(/[^0-9.]/g, '')
  if (!cleaned) return 0
  const value = Number.parseFloat(cleaned)
  if (!Number.isFinite(value)) return 0
  return negative ? -Math.abs(value) : value
}

/** Best-effort period → ISO timestamp for completed_at / approved_at. */
export function parseFinancialPeriodToIso(period: string | null | undefined): string | null {
  const raw = (period ?? '').trim()
  if (!raw) return null
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
    const ms = Date.parse(raw.slice(0, 10))
    return Number.isFinite(ms) ? new Date(ms).toISOString() : null
  }
  const yearMonth = raw.match(/^(\d{4})-(\d{2})$/)
  if (yearMonth) {
    const ms = Date.parse(`${yearMonth[1]}-${yearMonth[2]}-15T12:00:00.000Z`)
    return Number.isFinite(ms) ? new Date(ms).toISOString() : null
  }
  const ms = Date.parse(raw)
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null
}

/**
 * Resolve which listed property an expense belongs to.
 * Returns the canonical property name, or null when it cannot be tied.
 */
export function resolveListedPropertyForExpense(
  recordBuilding: string | null | undefined,
  properties: { name: string }[],
): string | null {
  if (properties.length === 0) return null
  const trimmed = (recordBuilding ?? '').trim()
  if (trimmed) {
    const key = normalizeBuildingKey(trimmed)
    const match = properties.find(
      (property) => normalizeBuildingKey(property.name) === key,
    )
    if (match) return match.name.trim()
    const loose = properties.find((property) => {
      const nameKey = normalizeBuildingKey(property.name)
      return Boolean(key) && Boolean(nameKey) && (nameKey.includes(key) || key.includes(nameKey))
    })
    if (loose) return loose.name.trim()
  }
  // Single listed property: expense reports without a building column still apply there.
  if (properties.length === 1) {
    const only = properties[0]!.name.trim()
    return only || null
  }
  return null
}
