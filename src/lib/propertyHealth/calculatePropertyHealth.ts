/**
 * Ulo Vitals — Property Score Rubric v1 (0–100).
 * Four dimensions × 25 points each:
 *   Open action items · Occupancy · Vendor coverage · Property documentation.
 * Documentation counts four equal documents: lease, Home Check equipment,
 * a photo on the last job, and the property's insurance policy.
 * Bands: Healthy 80+ · Fair 65–79 · At Risk 50–64 · Critical < 50.
 * Gaps surface as CTAs with the real points they would add (e.g. "Add HVAC vendor → +7 pts").
 */
import { normalizeVendorTrade, type VendorTradeSlug } from '@shared/maintenance/vendorTrades'

export const VITALS_DIMENSION_POINTS = 25

export const PROPERTY_HEALTH_CATEGORY_WEIGHTS = {
  open_items: 0.25,
  occupancy: 0.25,
  vendor_coverage: 0.25,
  documentation: 0.25,
} as const

export type PropertyHealthCategoryId = keyof typeof PROPERTY_HEALTH_CATEGORY_WEIGHTS

export const PROPERTY_HEALTH_CATEGORY_LABELS: Record<PropertyHealthCategoryId, string> = {
  open_items: 'Open action items',
  occupancy: 'Occupancy',
  vendor_coverage: 'Vendor coverage',
  documentation: 'Documentation',
}

export type PropertyHealthRating = 'Healthy' | 'Fair' | 'At Risk' | 'Critical'

/** The 8 core trades a property must be covered for. */
export const CORE_VENDOR_TRADES = [
  'plumbing',
  'hvac',
  'electrical',
  'appliance_repair',
  'locksmith',
  'pest_control',
  'roofing',
  'general',
] as const satisfies readonly VendorTradeSlug[]

export type CoreVendorTrade = (typeof CORE_VENDOR_TRADES)[number]

export const CORE_VENDOR_TRADE_LABELS: Record<CoreVendorTrade, string> = {
  plumbing: 'Plumbing',
  hvac: 'HVAC',
  electrical: 'Electrical',
  appliance_repair: 'Appliance',
  locksmith: 'Locksmith',
  pest_control: 'Pest Control',
  roofing: 'Roofing',
  general: 'General',
}

export type PropertyHealthDocumentation = {
  /** A lease is on file for every current resident at the property. */
  leaseOnFile: boolean
  /** Home Check equipment recorded: water heater and heating system. */
  assetListComplete: boolean
  /** The most recent completed job has a completion photo. */
  lastJobPhotoReceipt: boolean
  /** The landlord's own insurance policy for this property is on file (not a vendor COI). */
  insuranceOnFile: boolean
}

const DOCUMENT_KEYS = [
  'leaseOnFile',
  'assetListComplete',
  'lastJobPhotoReceipt',
  'insuranceOnFile',
] as const satisfies readonly (keyof PropertyHealthDocumentation)[]

/** Documents counted in the Documentation dimension, each weighted equally. */
export const DOCUMENTATION_ITEM_COUNT = DOCUMENT_KEYS.length

function completedDocumentCount(doc: PropertyHealthDocumentation): number {
  return DOCUMENT_KEYS.filter((key) => doc[key]).length
}

export type CalculatePropertyHealthInput = {
  /** Open action items (proactive + reactive), status open. */
  openItemCount: number
  /** Units onboarded in Ulo for this property. */
  totalUnits: number
  /** Units with an active lease / current resident. */
  occupiedUnits: number
  /** Core trades with at least one active vendor. */
  coveredTrades: readonly CoreVendorTrade[]
  documentation: PropertyHealthDocumentation
}

export type PropertyHealthDimension = {
  id: PropertyHealthCategoryId
  label: string
  points: number
  maxPoints: number
  /** Plain-language status, e.g. "6 of 8 trades covered". */
  detail: string
}

export type PropertyHealthGap = {
  dimension: PropertyHealthCategoryId
  /** CTA copy, e.g. "Add HVAC vendor". */
  action: string
  /** Points the action would add to the total score. */
  pointsGain: number
}

export type PropertyHealthResult = {
  score: number
  rating: PropertyHealthRating
  dimensions: Record<PropertyHealthCategoryId, PropertyHealthDimension>
  /** Largest point gains first. */
  gaps: PropertyHealthGap[]
}

export function openItemsPoints(openItems: number): number {
  if (openItems <= 0) return 25
  if (openItems === 1) return 18
  if (openItems <= 3) return 10
  return 0
}

export function occupancyPoints(occupied: number, total: number): number {
  if (total <= 0) return 0
  const ratio = Math.min(1, Math.max(0, occupied) / total)
  if (ratio >= 1) return 25
  if (ratio >= 0.9) return 18
  if (ratio >= 0.75) return 10
  return 0
}

export function vendorCoveragePoints(coveredTrades: number): number {
  if (coveredTrades >= 8) return 25
  if (coveredTrades >= 6) return 18
  if (coveredTrades >= 4) return 10
  return 0
}

/** Equal weight per document: 0 / 6 / 13 / 19 / 25 for 0–4 documents. */
export function documentationPoints(completeCount: number): number {
  const done = Math.max(0, Math.min(DOCUMENTATION_ITEM_COUNT, Math.floor(completeCount)))
  return Math.round((VITALS_DIMENSION_POINTS * done) / DOCUMENTATION_ITEM_COUNT)
}

export function propertyHealthRatingFromScore(score: number): PropertyHealthRating {
  if (score >= 80) return 'Healthy'
  if (score >= 65) return 'Fair'
  if (score >= 50) return 'At Risk'
  return 'Critical'
}

export function clampHealthScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)))
}

/** Map a vendor's free-text category (may list several trades) onto core trades. */
export function coreTradesForVendorCategory(category: string | null | undefined): CoreVendorTrade[] {
  const raw = (category ?? '').trim()
  if (!raw) return []
  const parts = raw.split(/\s*(?:,|\/|;|\||&|\band\b)\s*/i).filter(Boolean)
  const found = new Set<CoreVendorTrade>()
  for (const part of [raw, ...parts]) {
    const slug = normalizeVendorTrade(part, { fallbackOther: false })
    if (slug && (CORE_VENDOR_TRADES as readonly string[]).includes(slug)) {
      found.add(slug as CoreVendorTrade)
    }
  }
  return CORE_VENDOR_TRADES.filter((trade) => found.has(trade))
}

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`
}

function listLabels(trades: readonly CoreVendorTrade[]): string {
  const labels = trades.map((trade) => CORE_VENDOR_TRADE_LABELS[trade])
  if (labels.length <= 1) return labels.join('')
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`
}

function openItemsGap(openItems: number): PropertyHealthGap | null {
  if (openItems <= 0) return null
  const current = openItemsPoints(openItems)
  // Smallest number of closures that reaches the next band.
  for (let close = 1; close <= openItems; close += 1) {
    const gain = openItemsPoints(openItems - close) - current
    if (gain > 0) {
      return {
        dimension: 'open_items',
        action: close === 1 ? 'Close 1 open action item' : `Close ${close} open action items`,
        pointsGain: gain,
      }
    }
  }
  return null
}

function occupancyGap(occupied: number, total: number): PropertyHealthGap | null {
  const vacant = Math.max(0, total - occupied)
  if (total <= 0 || vacant === 0) return null
  const current = occupancyPoints(occupied, total)
  for (let fill = 1; fill <= vacant; fill += 1) {
    const gain = occupancyPoints(occupied + fill, total) - current
    if (gain > 0) {
      return {
        dimension: 'occupancy',
        action: fill === 1 ? 'Lease 1 vacant unit' : `Lease ${fill} vacant units`,
        pointsGain: gain,
      }
    }
  }
  return null
}

function vendorGap(covered: readonly CoreVendorTrade[]): PropertyHealthGap | null {
  const missing = CORE_VENDOR_TRADES.filter((trade) => !covered.includes(trade))
  if (missing.length === 0) return null
  const current = vendorCoveragePoints(covered.length)
  for (let add = 1; add <= missing.length; add += 1) {
    const gain = vendorCoveragePoints(covered.length + add) - current
    if (gain > 0) {
      const trades = missing.slice(0, add)
      return {
        dimension: 'vendor_coverage',
        action:
          add === 1
            ? `Add ${listLabels(trades)} vendor`
            : `Add vendors for ${listLabels(trades)}`,
        pointsGain: gain,
      }
    }
  }
  return null
}

const DOCUMENT_ACTIONS: Record<keyof PropertyHealthDocumentation, string> = {
  leaseOnFile: 'Upload the lease',
  assetListComplete: 'Run a Home Check for the water heater and heating system',
  lastJobPhotoReceipt: 'Add a completion photo to the last job',
  insuranceOnFile: 'Upload the property insurance policy',
}

function documentationGaps(doc: PropertyHealthDocumentation): PropertyHealthGap[] {
  const complete = completedDocumentCount(doc)
  const gain = documentationPoints(complete + 1) - documentationPoints(complete)
  return DOCUMENT_KEYS.filter((key) => !doc[key]).map((key) => ({
    dimension: 'documentation' as const,
    action: DOCUMENT_ACTIONS[key],
    pointsGain: gain,
  }))
}

function documentationDetail(doc: PropertyHealthDocumentation): string {
  const parts = [
    doc.leaseOnFile ? 'Lease on file' : 'Lease missing',
    doc.assetListComplete ? 'Home Check equipment recorded' : 'Home Check equipment missing',
    doc.lastJobPhotoReceipt ? 'Last job has a photo' : 'No photo on last job',
    doc.insuranceOnFile ? 'Insurance on file' : 'Insurance missing',
  ]
  return parts.join(' · ')
}

export function calculatePropertyHealth(input: CalculatePropertyHealthInput): PropertyHealthResult {
  const openItems = Math.max(0, Math.floor(input.openItemCount))
  const total = Math.max(0, Math.floor(input.totalUnits))
  const occupied = Math.min(total, Math.max(0, Math.floor(input.occupiedUnits)))
  const covered = CORE_VENDOR_TRADES.filter((trade) => input.coveredTrades.includes(trade))
  const doc = input.documentation
  const docComplete = completedDocumentCount(doc)
  const missingTrades = CORE_VENDOR_TRADES.filter((trade) => !covered.includes(trade))
  const occupancyPct = total > 0 ? Math.round((occupied / total) * 100) : 0

  const dimensions: Record<PropertyHealthCategoryId, PropertyHealthDimension> = {
    open_items: {
      id: 'open_items',
      label: PROPERTY_HEALTH_CATEGORY_LABELS.open_items,
      points: openItemsPoints(openItems),
      maxPoints: VITALS_DIMENSION_POINTS,
      detail: openItems === 0 ? 'No open action items' : `${plural(openItems, 'open action item')}`,
    },
    occupancy: {
      id: 'occupancy',
      label: PROPERTY_HEALTH_CATEGORY_LABELS.occupancy,
      points: occupancyPoints(occupied, total),
      maxPoints: VITALS_DIMENSION_POINTS,
      detail: `${occupied} of ${plural(total, 'unit')} occupied (${occupancyPct}%)`,
    },
    vendor_coverage: {
      id: 'vendor_coverage',
      label: PROPERTY_HEALTH_CATEGORY_LABELS.vendor_coverage,
      points: vendorCoveragePoints(covered.length),
      maxPoints: VITALS_DIMENSION_POINTS,
      detail:
        missingTrades.length === 0
          ? 'All 8 core trades covered'
          : `${covered.length} of 8 trades covered · missing ${listLabels(missingTrades)}`,
    },
    documentation: {
      id: 'documentation',
      label: PROPERTY_HEALTH_CATEGORY_LABELS.documentation,
      points: documentationPoints(docComplete),
      maxPoints: VITALS_DIMENSION_POINTS,
      detail: documentationDetail(doc),
    },
  }

  const score = clampHealthScore(
    dimensions.open_items.points +
      dimensions.occupancy.points +
      dimensions.vendor_coverage.points +
      dimensions.documentation.points,
  )

  const gaps = [
    openItemsGap(openItems),
    occupancyGap(occupied, total),
    vendorGap(covered),
    ...documentationGaps(doc),
  ]
    .filter((gap): gap is PropertyHealthGap => gap != null && gap.pointsGain > 0)
    .sort((a, b) => b.pointsGain - a.pointsGain)

  return { score, rating: propertyHealthRatingFromScore(score), dimensions, gaps }
}

/** CTA copy for a gap, e.g. "Add HVAC vendor → +7 pts". */
export function formatPropertyHealthGap(gap: PropertyHealthGap): string {
  return `${gap.action} → +${gap.pointsGain} pts`
}
