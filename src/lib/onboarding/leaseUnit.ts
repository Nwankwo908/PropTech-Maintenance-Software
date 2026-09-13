import { normalizeBuildingKey, normalizeUnitLabel } from '@/lib/propertyHealth'

/** When a lease has no readable unit number, assign unit 1. */
export const DEFAULT_LEASE_UNIT = '1'

const ILLEGIBLE_UNIT_RE =
  /^(n ?a|na|none|null|nil|unknown|unk|tbd|tba|illegible|unreadable|undecipherable|not (visible|legible|readable|listed|provided|specified|available)|see (lease|doc|document|above|below)|unable to (read|determine|tell)|cannot (read|determine)|blank|missing|ocr fail(ure)?|unintelligible)$/i

export function isIllegibleLeaseUnit(unit: string | null | undefined): boolean {
  const raw = (unit ?? '').trim()
  if (!raw) return true
  if (/^[?\-–—._/*#]+$/.test(raw)) return true
  const compact = raw.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  if (!compact) return true
  if (ILLEGIBLE_UNIT_RE.test(compact)) return true
  if (/^(unit|apt|apartment|suite|ste|number|no)$/.test(compact)) return true
  return false
}

export function usableLeaseUnit(unit: string | null | undefined): string {
  const trimmed = (unit ?? '').trim()
  return isIllegibleLeaseUnit(trimmed) ? '' : trimmed
}

export function leaseUnitOrDefault(unit: string | null | undefined): string {
  return usableLeaseUnit(unit) || DEFAULT_LEASE_UNIT
}

/** One shared unit for people on the same lease/property, or unit 1 when none are readable. */
export function sharedUnitForCoTenants(units: Array<string | null | undefined>): string | null {
  const labels = units.map((unit) => (unit ?? '').trim())
  const unique = new Map<string, string>()
  for (const unit of labels) {
    if (isIllegibleLeaseUnit(unit)) continue
    const key = normalizeUnitLabel(unit)
    if (!key || unique.has(key)) continue
    unique.set(key, unit)
  }
  if (unique.size === 1) return [...unique.values()][0] ?? null
  if (unique.size === 0 && labels.length >= 2) return DEFAULT_LEASE_UNIT
  return null
}

function leaseSourceKey(sourceDocumentName: string): string {
  const parts = sourceDocumentName
    .split(' · ')
    .map((part) => part.trim())
    .filter(Boolean)
  const file = parts.find((part) => /\.(pdf|docx?|png|jpe?g|heic|webp|tif{1,2})$/i.test(part))
  return (file ?? parts[0] ?? '').toLowerCase()
}

export function assignSharedUnitToLeaseCoTenants<
  T extends {
    unit: string
    building: string
    sourceDocumentName: string
    needsReview?: boolean
    confidence?: number
  },
>(rows: T[]): T[] {
  const groups = new Map<string, number[]>()
  rows.forEach((row, index) => {
    const source = leaseSourceKey(row.sourceDocumentName)
    if (!source) return
    const building = normalizeBuildingKey(row.building).toLowerCase()
    const key = `${source}::${building}`
    const list = groups.get(key) ?? []
    list.push(index)
    groups.set(key, list)
  })

  const next = [...rows]
  for (const indexes of groups.values()) {
    if (indexes.length < 2) continue
    const shared = sharedUnitForCoTenants(indexes.map((index) => next[index]?.unit))
    if (!shared) continue
    for (const index of indexes) {
      const row = next[index]
      if (!row || !isIllegibleLeaseUnit(row.unit)) continue
      next[index] = {
        ...row,
        unit: shared,
        needsReview: Boolean(row.needsReview && (row.confidence ?? 100) < 75),
      }
    }
  }
  return next
}
