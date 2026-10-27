/**
 * Unified Property Health (Ulo Vitals) — per-building scores; Overview is a
 * unit-weighted average of scored buildings.
 *
 * Score (0–100) comes from calculatePropertyHealth(), four dimensions × 25 pts:
 *   Open action items · Occupancy · Vendor coverage · Documentation
 * Bands: Healthy 80+ · Fair 65–79 · At Risk 50–64 · Critical < 50.
 *
 * Property activation (Active vs Pending setup) is separate from health scoring.
 */
import { getActiveLandlordId } from '@/lib/activeLandlord'
import { isSingleFamilyPropertyType } from '@shared/properties/propertyType'
import {
  CORE_VENDOR_TRADES,
  PROPERTY_HEALTH_CATEGORY_LABELS,
  PROPERTY_HEALTH_CATEGORY_WEIGHTS,
  VITALS_DIMENSION_POINTS,
  calculatePropertyHealth,
  clampHealthScore,
  coreTradesForVendorCategory,
  formatPropertyHealthGap,
  propertyHealthRatingFromScore,
  type CoreVendorTrade,
  type PropertyHealthGap,
  type PropertyHealthRating,
} from '@/lib/propertyHealth/calculatePropertyHealth'

export {
  calculatePropertyHealth,
  formatPropertyHealthGap,
  propertyHealthRatingFromScore,
}
export type { PropertyHealthGap, PropertyHealthRating }

/** Days of ops history used by older insights gates (not a score penalty). */
export const PROPERTY_HEALTH_OPS_MATURITY_DAYS = 30

export const PROPERTY_HEALTH_INSIGHTS_CAPTION =
  'More activity needed for full insights'

export const PROPERTY_HEALTH_UNKNOWN_CONDITION_CAPTION =
  'Add units to calculate property health'

export const PROPERTY_HEALTH_WEIGHTS = PROPERTY_HEALTH_CATEGORY_WEIGHTS

export const PROPERTY_HEALTH_KPI_CAPTION = 'Operational health score.'

/** Property Health ⓘ popover intro — weights + missing-data rule. */
export const PROPERTY_HEALTH_SCORE_INFO_DESCRIPTION =
  'Your score adds four parts worth 25 points each: open action items, occupancy, vendor coverage across 8 core trades, and documentation (lease, Home Check equipment, photo on the last job). Healthy is 80+, Fair 65–79, At Risk 50–64, Critical below 50.'

export type PropertyHealthPendingReason = 'inactive_units' | 'collecting_history' | 'unknown_condition'

/** KPI helper copy for property health — activation vs insights are separate. */
export function resolvePropertyHealthKpiCaption(
  portfolio: PropertyHealthScopeScore | null,
): string {
  if (!portfolio || portfolio.status === 'pending_setup') {
    return 'Activate units to start measuring property health.'
  }
  if (portfolio.status === 'unknown') {
    return PROPERTY_HEALTH_KPI_CAPTION
  }
  if (!shouldShowPropertyHealthScore(portfolio.status)) {
    return PROPERTY_HEALTH_INSIGHTS_CAPTION
  }
  const rating = portfolio.rating ?? PROPERTY_HEALTH_KPI_CAPTION
  const scored = portfolio.scoredPropertyCount
  const total = portfolio.propertyCount
  if (
    scored != null &&
    total != null &&
    total > 1 &&
    scored < total
  ) {
    return `${rating} · ${scored} of ${total} properties scored`
  }
  return rating
}

/** Building-card copy when the numeric health score is not shown yet. */
export function resolvePropertyHealthPendingMessage(
  pendingReason: PropertyHealthPendingReason | null | undefined,
): string {
  if (pendingReason === 'collecting_history') {
    return PROPERTY_HEALTH_INSIGHTS_CAPTION
  }
  if (pendingReason === 'unknown_condition') {
    return PROPERTY_HEALTH_UNKNOWN_CONDITION_CAPTION
  }
  return 'Pending setup — activate units to operate this property'
}

/** Numeric health / AI insights — not the same as property Active. */
export function shouldShowPropertyHealthScore(
  status: PropertyHealthStatus | null | undefined,
): boolean {
  return (
    status === 'excellent' ||
    status === 'good' ||
    status === 'fair' ||
    status === 'needs_attention' ||
    status === 'high_risk' ||
    status === 'healthy' ||
    status === 'monitor' ||
    status === 'at_risk' ||
    status === 'critical'
  )
}

/** Main KPI value — omit "%" when the score is exactly 0. */
export function formatPropertyHealthKpiValue(score: number): string {
  return score === 0 ? '0' : `${score}%`
}

/**
 * Health KPI card value. This is a score, not property activation.
 * Active properties without enough history show "—" plus the insights caption.
 */
export function resolvePropertyHealthKpiValue(
  status: PropertyHealthStatus | null | undefined,
  score: number | null | undefined,
  format: 'percent' | 'over100' = 'percent',
): string {
  if (!status || status === 'pending_setup') return 'Pending'
  if (status === 'unknown' || !shouldShowPropertyHealthScore(status) || score == null) {
    return format === 'over100' ? '— / 100' : '—'
  }
  return format === 'over100' ? `${score} / 100` : formatPropertyHealthKpiValue(score)
}

/** Trend pill — hide when there is no change (0%). */
export function propertyHealthKpiDelta(delta: number | null | undefined): number | null {
  if (delta == null || delta === 0) return null
  return delta
}

export type PropertyHealthStatus =
  | 'excellent'
  | 'good'
  | 'fair'
  | 'needs_attention'
  | 'high_risk'
  | 'healthy'
  | 'monitor'
  | 'at_risk'
  | 'critical'
  | 'active'
  | 'pending_setup'
  | 'unknown'

export type PropertyHealthComponentKey = keyof typeof PROPERTY_HEALTH_CATEGORY_WEIGHTS

export type PropertyHealthComponent = {
  key: PropertyHealthComponentKey
  label: string
  /** Points earned in this dimension (0–25). */
  score: number
  /** Points available in this dimension. */
  maxPoints: number
  weight: number
  /** True when this category had no known factors. */
  isFallback: boolean
  detail: string
}

export type PropertyHealthScopeScore = {
  /** Overall 0–100 when Condition is known; otherwise withheld. */
  score: number | null
  status: PropertyHealthStatus
  rating: PropertyHealthRating | null
  components: PropertyHealthComponent[]
  /** Tracked units (status !== inactive) in this scope. */
  trackedUnitCount: number
  pendingReason?: PropertyHealthPendingReason | null
  dataCompleteness?: number
  topIssues?: string[]
  /** Point-gain CTAs, largest first (e.g. "Add HVAC vendor → +7 pts"). */
  gaps?: PropertyHealthGap[]
  /** Buildings included in the Overview rollup (have a score). */
  scoredPropertyCount?: number
  /** Buildings on the Properties grid. */
  propertyCount?: number
}

export type PropertyHealthBuildingRow = PropertyHealthScopeScore & {
  building: string
  unitCount: number
  /** Saved `properties.property_type`, when the row is a canonical property. */
  propertyType?: string | null
  /** Open (not completed/cancelled) maintenance tickets for this building. */
  openTickets: number
  /** All non-voided work orders (open + completed) — Properties table “Work orders” column. */
  workOrderCount: number
  occupancyPct: number
  /** Real avg resident rating (1–5) when feedback exists; null otherwise. */
  residentRating: number | null
  feedbackCount: number
}

export type PropertyHealthReport = {
  portfolio: PropertyHealthScopeScore | null
  /** Approximate 4-week change in portfolio score (percentage points). */
  portfolioDelta: number | null
  buildings: PropertyHealthBuildingRow[]
}

export type PropertyHealthUnit = {
  id: string
  unitLabel: string
  building: string | null
  status: string
  propertyId?: string | null
  /** Best-effort start of tracked ops (typically units.updated_at when active/vacant). */
  trackedSinceMs?: number | null
}

/** Saved property row from `properties` — always shown on the Properties grid. */
export type PropertyHealthCanonicalProperty = {
  id: string
  name: string
  propertyType?: string | null
}

/** Units column on the properties table. Single-family homes have no unit count. */
export function propertyTableUnitsLabel(
  row: Pick<PropertyHealthBuildingRow, 'unitCount' | 'propertyType'>,
): string {
  return isSingleFamilyPropertyType(row.propertyType) ? 'n/a' : String(row.unitCount)
}

export type PropertyHealthResident = {
  id: string
  fullName: string
  unit: string
  building: string | null
  status: string
  email?: string | null
}

const NON_OCCUPYING_RESIDENT_STATUSES = new Set(['past_resident', 'inactive', 'vacant'])

/** True when a roster row counts as currently occupying a unit. */
export function isOccupyingResidentStatus(status: string): boolean {
  return !NON_OCCUPYING_RESIDENT_STATUSES.has(status.trim().toLowerCase())
}

/** Units tab Occupied chip — persisted `units.status = active`. */
export function isOccupiedUnitStatus(status: string | null | undefined): boolean {
  return (status ?? '').trim().toLowerCase() === 'active'
}

function uniqueUnitsForOccupancy(units: PropertyHealthUnit[]): PropertyHealthUnit[] {
  const byKey = new Map<string, PropertyHealthUnit>()
  for (const unit of units) {
    const label = normalizeUnitLabel(unit.unitLabel)
    if (!label) continue
    const key = `${normalizeBuildingKey(unit.building)}::${label}`
    const existing = byKey.get(key)
    if (!existing) {
      byKey.set(key, unit)
      continue
    }
    if (isOccupiedUnitStatus(unit.status) && !isOccupiedUnitStatus(existing.status)) {
      byKey.set(key, unit)
    }
  }
  return Array.from(byKey.values())
}

function occupancyFromInventory(
  units: PropertyHealthUnit[],
): { occupied: number; tracked: number; occupancyPct: number } {
  const occupied = units.filter((unit) => isOccupiedUnitStatus(unit.status)).length
  const tracked = units.length
  const occupancyPct = tracked ? Math.round((occupied / tracked) * 100) : 0
  return { occupied, tracked, occupancyPct }
}

export function findResidentForUnitLabel(
  unitLabel: string,
  building: string,
  residents: PropertyHealthResident[],
): PropertyHealthResident | null {
  const unitKey = normalizeUnitLabel(unitLabel)
  return (
    residents.find((resident) => {
      if (normalizeBuildingKey(resident.building) !== normalizeBuildingKey(building)) return false
      return normalizeUnitLabel(resident.unit) === unitKey
    }) ?? null
  )
}

/** Occupied = tracked unit with a roster resident (same rule as the Units tab). */
export function isUnitOccupiedByResident(
  unit: PropertyHealthUnit,
  building: string,
  residents: PropertyHealthResident[],
): boolean {
  if (unit.status === 'inactive') return false
  const resident = findResidentForUnitLabel(unit.unitLabel, building, residents)
  return resident != null && isOccupyingResidentStatus(resident.status)
}

export function countOccupiedUnits(
  units: PropertyHealthUnit[],
  residents: PropertyHealthResident[],
  building?: string,
): number {
  let count = 0
  for (const unit of units) {
    if (unit.status === 'inactive') continue
    const scopeBuilding = building ?? unit.building
    if (!scopeBuilding) continue
    if (isUnitOccupiedByResident(unit, scopeBuilding, residents)) count += 1
  }
  return count
}

/**
 * Occupancy % = occupied units / full unit inventory.
 * Occupied follows the Units tab (`status = active`). Vacant, under-maintenance,
 * and pending-setup (`inactive`) units stay in the denominator so empty
 * properties pull the average down instead of disappearing.
 */
export function computeOccupancyStats(
  units: PropertyHealthUnit[],
  _residents?: PropertyHealthResident[],
  building?: string,
): { occupied: number; tracked: number; occupancyPct: number } {
  const scoped = building ? filterUnitsForBuilding(units, building) : units
  const inventory = building
    ? dedupePropertyUnitsByLabel(scoped, building)
    : uniqueUnitsForOccupancy(scoped)
  return occupancyFromInventory(inventory)
}

export type PropertyHealthTicket = {
  id: string
  createdAt: string
  unit: string
  unitId: string | null
  building: string | null
  /** Canonical `properties.id` when enriched join resolved it. */
  propertyId?: string | null
  /** Set when the repair is finished (even if vendor_work_status lags). */
  completedAt?: string | null
  issueCategory?: string | null
  vendorWorkStatus: string
  assignedVendorId?: string | null
  email?: string | null
  description?: string | null
  urgency?: string | null
  severity?: string | null
  priority?: string | null
  dueAt?: string | null
  /** Landlord-initiated inspection batch — excluded from Repeat issues scoring. */
  inspectionReportId?: string | null
}

export type PropertyHealthPmTask = {
  building: string | null
  unitLabel: string | null
  taskStatus: string
  dueAt?: string | null
}

export type PropertyHealthAsset = {
  building: string | null
  propertyId: string | null
  applianceType: string
  estimatedAgeYears: number | null
  usefulLifeYears: number | null
  replacementUrgency: string | null
  condition: string | null
  deficiencies: Array<{ severity?: string | null; description?: string | null }>
}

export type PropertyHealthInspection = {
  building: string | null
  propertyId: string | null
  category: string | null
  conditionRating: string | null
  deficiencies: Array<{ severity?: string | null; description?: string | null }>
}

export type PropertyHealthDamageReport = {
  createdAt: string
  maintenanceRequestId: string | null
}

export type PropertyHealthFeedback = {
  rating: number
  maintenanceRequestId: string
  unit: string | null
  building: string | null
}

export type PropertyHealthVendorMetrics = {
  vendorId: string
  acceptedJobs: number
  completedJobs: number
  completionRate: number | null
  avgResponseTime: number | null
}

export type PropertyHealthInputs = {
  units: PropertyHealthUnit[]
  tickets: PropertyHealthTicket[]
  pmTasks: PropertyHealthPmTask[]
  feedback: PropertyHealthFeedback[]
  vendorMetrics: PropertyHealthVendorMetrics[]
  assets?: PropertyHealthAsset[]
  inspections?: PropertyHealthInspection[]
  damageReports?: PropertyHealthDamageReport[]
  /** Saved properties — merged into the grid even without units or active residents. */
  canonicalProperties?: PropertyHealthCanonicalProperty[]
  /** Roster rows used for occupancy (units with an assigned active resident). */
  residents?: PropertyHealthResident[]
  now?: number
  /** Landlord vendors — used for core-trade coverage. */
  vendors?: PropertyHealthVendor[]
  /** Per-ticket extras keyed by ticket id (Home Check observation flag, completion photos). */
  ticketExtras?: Record<string, PropertyHealthTicketExtras>
  /** Lease uploads, matched to current residents for the Documentation dimension. */
  leaseDocuments?: PropertyHealthLeaseLookup | null
  /**
   * When set, open action items are counted as of this timestamp (used for the
   * month-over-month trend).
   */
  openIssuesCreatedBeforeMs?: number
}

export type PropertyHealthVendor = {
  id: string
  category: string | null
  active: boolean
  rosterStatus: string | null
}

/** Answers whether a resident has a lease upload matched to them. */
export type PropertyHealthLeaseLookup = {
  hasLeaseFor(resident: {
    fullName: string
    unit: string
    building: string
    email?: string | null
  }): boolean
}

export type PropertyHealthTicketExtras = {
  /** Home Check observation tickets are not action items. */
  observationOnly: boolean
  completionPhotoCount: number
}

const CLOSED_WORK_STATUSES = new Set(['completed', 'cancelled', 'archived'])
/** Removed / resident-stopped work orders are not real repair history. */
const VOIDED_WORK_STATUSES = new Set(['cancelled', 'deleted', 'archived'])

function isVoidedWorkOrder(ticket: Pick<PropertyHealthTicket, 'vendorWorkStatus'>): boolean {
  return VOIDED_WORK_STATUSES.has(ticket.vendorWorkStatus.toLowerCase())
}

const FOUR_WEEKS_MS = 28 * 24 * 60 * 60 * 1000

const COMPONENT_LABELS: Record<PropertyHealthComponentKey, string> = PROPERTY_HEALTH_CATEGORY_LABELS

function buildNeutralComponents(): PropertyHealthComponent[] {
  return (Object.keys(PROPERTY_HEALTH_WEIGHTS) as PropertyHealthComponentKey[]).map((key) => ({
    key,
    label: COMPONENT_LABELS[key],
    score: 0,
    maxPoints: VITALS_DIMENSION_POINTS,
    weight: PROPERTY_HEALTH_WEIGHTS[key],
    isFallback: true,
    detail: 'No active units to measure',
  }))
}

function buildNeutralScopeScore(): PropertyHealthScopeScore {
  const components = buildNeutralComponents()
  return {
    score: 0,
    status: 'pending_setup',
    rating: null,
    components,
    trackedUnitCount: 0,
    pendingReason: 'inactive_units',
    dataCompleteness: 0,
    topIssues: [],
    gaps: [],
  }
}

function hasCompletedPmCycle(tasks: PropertyHealthPmTask[]): boolean {
  return tasks.some((task) => task.taskStatus === 'completed')
}

function resolveTrackedUnitOpsStartMs(units: PropertyHealthUnit[]): number | null {
  const times = units
    .map((unit) => unit.trackedSinceMs)
    .filter((value): value is number => value != null && Number.isFinite(value))
  return times.length ? Math.min(...times) : null
}

function resolveScopeOpsStartMs(
  trackedUnits: PropertyHealthUnit[],
  tickets: PropertyHealthTicket[],
): number | null {
  const candidates: number[] = []
  const unitStart = resolveTrackedUnitOpsStartMs(trackedUnits)
  if (unitStart != null) candidates.push(unitStart)
  for (const ticket of tickets) {
    if (isVoidedWorkOrder(ticket)) continue
    const ts = new Date(ticket.createdAt).getTime()
    if (!Number.isNaN(ts)) candidates.push(ts)
  }
  return candidates.length ? Math.min(...candidates) : null
}

/** True when a scope has enough real ops history to show a health score. */
export function hasPropertyHealthOperationalSignal(
  trackedUnits: PropertyHealthUnit[],
  pmTasks: PropertyHealthPmTask[],
  tickets: PropertyHealthTicket[],
  now: number,
  maturityDays: number = PROPERTY_HEALTH_OPS_MATURITY_DAYS,
): boolean {
  if (trackedUnits.length === 0) return false
  if (hasCompletedPmCycle(pmTasks)) return true
  const opsStart = resolveScopeOpsStartMs(trackedUnits, tickets)
  if (opsStart == null) return false
  return now - opsStart >= maturityDays * 24 * 60 * 60 * 1000
}

/** All distinct portfolio buildings for a landlord (units + PM + tickets + registry). */
export function collectPortfolioBuildingKeys(
  units: PropertyHealthUnit[],
  pmTasks: PropertyHealthPmTask[],
  tickets: PropertyHealthTicket[],
  _landlordId: string = getActiveLandlordId(),
  residents: PropertyHealthResident[] = [],
): string[] {
  const ticketBuildingCtx = buildTicketBuildingContext(units)
  const emailBuildingMap = buildResidentEmailBuildingMap(residents)
  const keys = new Set<string>()

  for (const unit of units) {
    keys.add(normalizeBuildingKey(unit.building))
  }
  for (const resident of residents) {
    if (resident.building?.trim()) keys.add(normalizeBuildingKey(resident.building))
  }
  for (const task of pmTasks) {
    if (task.building?.trim()) keys.add(normalizeBuildingKey(task.building))
  }
  for (const ticket of tickets) {
    keys.add(ticketBuilding(ticket, ticketBuildingCtx, emailBuildingMap))
  }

  if (keys.size > 1) keys.delete('Portfolio')
  return [...keys].sort((a, b) => a.localeCompare(b))
}

/**
 * Building keys for the Properties grid: every saved property plus operational
 * buildings that are not already mapped to a canonical property row.
 */
export function collectPropertyGridBuildingKeys(
  units: PropertyHealthUnit[],
  pmTasks: PropertyHealthPmTask[],
  tickets: PropertyHealthTicket[],
  landlordId: string = getActiveLandlordId(),
  residents: PropertyHealthResident[] = [],
  canonicalProperties: PropertyHealthCanonicalProperty[] = [],
): string[] {
  const operational = collectPortfolioBuildingKeys(
    units,
    pmTasks,
    tickets,
    landlordId,
    residents,
  )
  const keys = new Set<string>()

  for (const property of canonicalProperties) {
    keys.add(normalizeBuildingKey(property.name))
  }

  for (const opKey of operational) {
    const canonical = findCanonicalPropertyByGridKey(opKey, canonicalProperties, units)
    keys.add(canonical ? normalizeBuildingKey(canonical.name) : opKey)
  }

  if (keys.size > 1) keys.delete('Portfolio')
  return [...keys].sort((a, b) => a.localeCompare(b))
}

/** Building count shared by the Buildings KPI and Property Health section header. */
export function countPortfolioBuildings(
  units: PropertyHealthUnit[],
  pmTasks: PropertyHealthPmTask[] = [],
  tickets: PropertyHealthTicket[] = [],
  landlordId: string = getActiveLandlordId(),
  residents: PropertyHealthResident[] = [],
  canonicalProperties: PropertyHealthCanonicalProperty[] = [],
): number {
  return collectPropertyGridBuildingKeys(
    units,
    pmTasks,
    tickets,
    landlordId,
    residents,
    canonicalProperties,
  ).length
}

export function isPendingSetupHealth(components: PropertyHealthComponent[]): boolean {
  return components.length > 0 && components.every((component) => component.isFallback)
}

export function propertyHealthStatus(score: number): PropertyHealthStatus {
  const rating = propertyHealthRatingFromScore(score)
  if (rating === 'Healthy') return 'healthy'
  if (rating === 'Fair') return 'fair'
  if (rating === 'At Risk') return 'at_risk'
  return 'critical'
}

export function resolvePropertyHealthStatus(
  score: number,
  components: PropertyHealthComponent[],
  options?: { insufficientOperationalSignal?: boolean },
): PropertyHealthStatus {
  void options
  if (isPendingSetupHealth(components)) return 'pending_setup'
  return propertyHealthStatus(score)
}

export function normalizeUnitLabel(label: string): string {
  return label
    .toLowerCase()
    .replace(/^(unit|apt|apartment|suite|ste|#)\s*/i, '')
    .replace(/[\s.#-]+/g, '')
    .trim()
}

export function normalizeBuildingKey(building: string | null | undefined): string {
  const trimmed = building?.trim()
  return trimmed || 'Portfolio'
}

const STREET_TYPE_ALIASES: Array<[RegExp, string]> = [
  [/\bstreets?\b/g, 'st'],
  [/\bavenues?\b/g, 'ave'],
  [/\broads?\b/g, 'rd'],
  [/\bdrives?\b/g, 'dr'],
  [/\blanes?\b/g, 'ln'],
  [/\bboulevards?\b/g, 'blvd'],
  [/\bcourts?\b/g, 'ct'],
  [/\bplaces?\b/g, 'pl'],
]

function normalizePlaceCompareKey(value: string): string {
  let normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  for (const [pattern, alias] of STREET_TYPE_ALIASES) {
    normalized = normalized.replace(pattern, alias)
  }
  return normalized.replace(/\s+/g, ' ').trim()
}

/** Leading house/building number when present ("35 maple st" → "35"). */
function extractLeadingStreetNumber(placeKey: string): string | null {
  const match = placeKey.trim().toLowerCase().match(/^(\d+[a-z]?)\b/)
  return match?.[1] ?? null
}

/** True when two building labels are the same place (81 Maple St vs 81 Maple Street). */
export function buildingsLikelySamePlace(
  left: string | null | undefined,
  right: string | null | undefined,
): boolean {
  const a = (left ?? '').trim()
  const b = (right ?? '').trim()
  if (!a || !b) return false
  if (normalizeBuildingKey(a) === normalizeBuildingKey(b)) return true
  const aKey = normalizePlaceCompareKey(a)
  const bKey = normalizePlaceCompareKey(b)
  if (!aKey || !bKey || aKey === 'portfolio' || bKey === 'portfolio') return false
  if (aKey === bKey) return true
  // Different street numbers are different properties (33 Maple ≠ 35 Maple).
  const aNum = extractLeadingStreetNumber(aKey)
  const bNum = extractLeadingStreetNumber(bKey)
  if (aNum && bNum && aNum !== bNum) return false
  const shorter = aKey.length <= bKey.length ? aKey : bKey
  const longer = aKey.length <= bKey.length ? bKey : aKey
  // "Sunset" ↔ "Sunset (Austin, TX)" and "81 Maple" ↔ "81 Maple Street".
  if (longer.startsWith(`${shorter} (`) || longer.startsWith(`${shorter} `)) return true
  return shorter.length >= 8 && longer.includes(` ${shorter} `)
}

/** True when a unit row belongs to a saved property (by id or building alias). */
export function unitBelongsToCanonicalProperty(
  unit: PropertyHealthUnit,
  property: PropertyHealthCanonicalProperty,
): boolean {
  if (unit.propertyId?.trim() && unit.propertyId === property.id) return true
  const unitBuilding = normalizeBuildingKey(unit.building)
  const canonical = normalizeBuildingKey(property.name)
  if (unitBuilding === canonical) return true
  // Legacy Add Property units used `"Name (City, State)"` as building.
  if (unitBuilding.startsWith(`${canonical} (`)) return true
  if (unit.building?.trim() && buildingsLikelySamePlace(unit.building, property.name)) return true
  return false
}

export function filterUnitsForCanonicalProperty(
  units: PropertyHealthUnit[],
  property: PropertyHealthCanonicalProperty,
): PropertyHealthUnit[] {
  return units.filter((unit) => unitBelongsToCanonicalProperty(unit, property))
}

/** Collapse duplicate inventory rows that share a unit label under one property scope. */
export function dedupePropertyUnitsByLabel<
  T extends { id: string; unitLabel: string; building: string | null },
>(units: T[], preferredBuilding?: string | null): T[] {
  const preferredKey = preferredBuilding ? normalizeBuildingKey(preferredBuilding) : null
  const byLabel = new Map<string, T>()

  for (const unit of units) {
    const labelKey = normalizeUnitLabel(unit.unitLabel)
    if (!labelKey) continue

    const existing = byLabel.get(labelKey)
    if (!existing) {
      byLabel.set(labelKey, unit)
      continue
    }

    const score = (row: T) => {
      if (!preferredKey) return 0
      return normalizeBuildingKey(row.building) === preferredKey ? 1 : 0
    }
    if (score(unit) > score(existing)) {
      byLabel.set(labelKey, unit)
    }
  }

  return Array.from(byLabel.values())
}

/** Distinct unit inventory for KPI cards (same unit spelled 4B / Unit 4B / 4-B counts once). */
export function countDistinctPortfolioUnits(
  units: Array<{ unitLabel: string; building?: string | null }>,
): number {
  const keys = new Set<string>()
  for (const unit of units) {
    const label = normalizeUnitLabel(unit.unitLabel)
    if (!label) continue
    keys.add(`${normalizeBuildingKey(unit.building)}::${label}`)
  }
  return keys.size
}

/** Property detail Units tab — canonical scope plus one row per unit label. */
export function filterUnitsForPropertyDetailScope(
  units: PropertyHealthUnit[],
  building: string,
  property: PropertyHealthCanonicalProperty | null,
): PropertyHealthUnit[] {
  const scoped = property
    ? filterUnitsForCanonicalProperty(units, property)
    : units.filter(
        (unit) => normalizeBuildingKey(unit.building) === normalizeBuildingKey(building),
      )
  return dedupePropertyUnitsByLabel(scoped, property?.name ?? building)
}

/** Match a property detail/overview row to the same building card as the Properties grid. */
export function resolveBuildingHealthRow(
  report: PropertyHealthReport,
  buildingName: string,
): PropertyHealthBuildingRow | null {
  const key = normalizeBuildingKey(buildingName)
  return report.buildings.find((row) => normalizeBuildingKey(row.building) === key) ?? null
}

export function buildingKeyMatchesCanonicalProperty(
  buildingKey: string,
  property: PropertyHealthCanonicalProperty,
  units: PropertyHealthUnit[] = [],
): boolean {
  const key = normalizeBuildingKey(buildingKey)
  const canonical = normalizeBuildingKey(property.name)
  if (key === canonical) return true
  if (key.startsWith(`${canonical} (`)) return true
  if (buildingsLikelySamePlace(buildingKey, property.name)) return true
  return units.some(
    (unit) =>
      unitBelongsToCanonicalProperty(unit, property) &&
      normalizeBuildingKey(unit.building) === key,
  )
}

function findCanonicalPropertyByGridKey(
  building: string,
  canonicalProperties: PropertyHealthCanonicalProperty[],
  units: PropertyHealthUnit[],
): PropertyHealthCanonicalProperty | null {
  const byName = canonicalProperties.find(
    (property) => normalizeBuildingKey(property.name) === normalizeBuildingKey(building),
  )
  if (byName) return byName
  for (const property of canonicalProperties) {
    if (buildingKeyMatchesCanonicalProperty(building, property, units)) return property
  }
  return null
}

function buildingScopeAliasKeys(
  building: string,
  property: PropertyHealthCanonicalProperty | null,
  units: PropertyHealthUnit[],
): Set<string> {
  const aliases = new Set<string>([normalizeBuildingKey(building)])
  if (!property) return aliases
  // Only alias the saved property name when it is this same street address.
  // Shared/wrong property_id must not pull "35 Maple" into the "33 Maple" scope.
  if (
    normalizeBuildingKey(property.name) === normalizeBuildingKey(building) ||
    buildingsLikelySamePlace(property.name, building)
  ) {
    aliases.add(normalizeBuildingKey(property.name))
  }
  for (const unit of units) {
    if (!unitBelongsToCanonicalProperty(unit, property) || !unit.building?.trim()) continue
    if (
      normalizeBuildingKey(unit.building) === normalizeBuildingKey(building) ||
      buildingsLikelySamePlace(unit.building, building)
    ) {
      aliases.add(normalizeBuildingKey(unit.building))
    }
  }
  return aliases
}

function buildingMatchesScopeAliases(building: string | null | undefined, aliases: Set<string>): boolean {
  const raw = building?.trim()
  if (!raw) return false
  const key = normalizeBuildingKey(raw)
  if (aliases.has(key)) return true
  for (const alias of aliases) {
    if (alias !== 'Portfolio' && buildingsLikelySamePlace(raw, alias)) return true
  }
  return false
}

function isTicketOpen(ticket: PropertyHealthTicket): boolean {
  if (ticket.completedAt?.trim()) return false
  return !CLOSED_WORK_STATUSES.has(ticket.vendorWorkStatus.toLowerCase())
}

type TicketBuildingContext = {
  unitIdBuildingMap: Map<string, string>
  unitIdPropertyMap: Map<string, string>
  propertyIdBuildingMap: Map<string, string>
  propertyIdUnitBuildings: Map<string, Set<string>>
  knownBuildingNames: string[]
}

function buildResidentEmailBuildingMap(
  residents: PropertyHealthResident[],
): Map<string, string> {
  const emailBuildingMap = new Map<string, string>()
  for (const resident of residents) {
    const email = resident.email?.trim().toLowerCase()
    if (email && resident.building?.trim()) {
      emailBuildingMap.set(email, normalizeBuildingKey(resident.building))
    }
  }
  return emailBuildingMap
}

/** Map short labels ("Oakwood") to roster building names ("Oakwood Apartments"). */
function resolveCanonicalBuildingLabel(
  label: string,
  knownBuildingNames: readonly string[],
): string {
  const normalized = normalizeBuildingKey(label)
  const normalizedLower = normalized.toLowerCase()
  for (const name of knownBuildingNames) {
    const canonical = normalizeBuildingKey(name)
    const canonicalLower = canonical.toLowerCase()
    if (canonicalLower === normalizedLower) return canonical
    if (buildingsLikelySamePlace(normalized, canonical)) return canonical
    const firstWord = canonicalLower.split(/\s+/)[0] ?? ''
    // Require a word boundary — "1" must not match "10 Main St".
    if (
      firstWord &&
      (firstWord === normalizedLower ||
        canonicalLower.startsWith(`${normalizedLower} `) ||
        normalizedLower.startsWith(`${firstWord} `))
    ) {
      return canonical
    }
  }
  return normalized
}

function parseBuildingPrefixFromUnit(
  unit: string,
  knownBuildingNames: readonly string[],
): string | null {
  const trimmed = unit.trim()
  if (!trimmed.includes('·')) return null
  const prefix = trimmed.split('·')[0]?.trim()
  if (!prefix) return null
  return resolveCanonicalBuildingLabel(prefix, knownBuildingNames)
}

function buildTicketBuildingContext(units: PropertyHealthUnit[]): TicketBuildingContext {
  const unitIdBuildingMap = new Map<string, string>()
  const unitIdPropertyMap = new Map<string, string>()
  const propertyIdBuildingMap = new Map<string, string>()
  const propertyIdUnitBuildings = new Map<string, Set<string>>()
  const knownBuildingNamesSet = new Set<string>()

  for (const unit of units) {
    const buildingKey = normalizeBuildingKey(unit.building)
    if (unit.building?.trim()) {
      knownBuildingNamesSet.add(buildingKey)
    }
    if (unit.id) {
      unitIdBuildingMap.set(unit.id, buildingKey)
      if (unit.propertyId?.trim()) {
        unitIdPropertyMap.set(unit.id, unit.propertyId.trim())
      }
    }
    if (unit.propertyId?.trim()) {
      const propertyId = unit.propertyId.trim()
      if (!propertyIdBuildingMap.has(propertyId)) {
        propertyIdBuildingMap.set(propertyId, buildingKey)
      }
      const buildings = propertyIdUnitBuildings.get(propertyId) ?? new Set<string>()
      buildings.add(buildingKey)
      propertyIdUnitBuildings.set(propertyId, buildings)
    }
  }

  return {
    unitIdBuildingMap,
    unitIdPropertyMap,
    propertyIdBuildingMap,
    propertyIdUnitBuildings,
    knownBuildingNames: [...knownBuildingNamesSet],
  }
}

function ticketBuilding(
  ticket: PropertyHealthTicket,
  ctx: TicketBuildingContext,
  emailBuildingMap?: Map<string, string>,
): string {
  if (ticket.propertyId?.trim()) {
    const fromProperty = ctx.propertyIdBuildingMap.get(ticket.propertyId.trim())
    if (fromProperty) return fromProperty
  }
  if (ticket.building?.trim()) {
    return resolveCanonicalBuildingLabel(ticket.building, ctx.knownBuildingNames)
  }
  const fromUnitPrefix = parseBuildingPrefixFromUnit(ticket.unit, ctx.knownBuildingNames)
  if (fromUnitPrefix) return fromUnitPrefix
  const ticketEmail = ticket.email?.trim().toLowerCase()
  if (ticketEmail && emailBuildingMap?.get(ticketEmail)) {
    return emailBuildingMap.get(ticketEmail)!
  }
  if (ticket.unitId?.trim()) {
    const fromUnitId = ctx.unitIdBuildingMap.get(ticket.unitId.trim())
    if (fromUnitId) return fromUnitId
  }
  // Never attribute by bare unit label ("1" repeats across the portfolio).
  // Single-property portfolios: SMS tickets often lack building/unit_id — still count them.
  if (ctx.knownBuildingNames.length === 1) {
    return ctx.knownBuildingNames[0]!
  }
  return 'Portfolio'
}

function propertyIdMatchesBuilding(
  propertyId: string,
  buildingKey: string,
  building: string,
  ctx: TicketBuildingContext,
): boolean {
  const buildings = ctx.propertyIdUnitBuildings.get(propertyId)
  if (buildings?.has(buildingKey)) return true
  const mapped = ctx.propertyIdBuildingMap.get(propertyId)
  if (!mapped) return false
  return mapped === buildingKey || buildingsLikelySamePlace(mapped, building)
}

/** Scope maintenance tickets to one building (property_id / unit_id first — never bare unit labels). */
export function filterTicketsForBuildingScope<T extends PropertyHealthTicket>(
  tickets: T[],
  building: string,
  units: PropertyHealthUnit[],
  residents: PropertyHealthResident[] = [],
): T[] {
  const ctx = buildTicketBuildingContext(units)
  const key = normalizeBuildingKey(building)
  const emailBuildingMap = buildResidentEmailBuildingMap(residents)

  return tickets.filter((ticket) => {
    if (ticket.propertyId?.trim()) {
      if (propertyIdMatchesBuilding(ticket.propertyId.trim(), key, building, ctx)) {
        // Explicit building on the ticket still wins when it names a different address.
        if (
          ticket.building?.trim() &&
          !buildingsLikelySamePlace(ticket.building, building) &&
          resolveCanonicalBuildingLabel(ticket.building, ctx.knownBuildingNames) !== key
        ) {
          return false
        }
        return true
      }
    }
    // Explicit building wins — never override with a resident email on another address.
    if (ticket.building?.trim()) {
      const resolved = resolveCanonicalBuildingLabel(ticket.building, ctx.knownBuildingNames)
      return resolved === key || buildingsLikelySamePlace(ticket.building, building)
    }
    if (ticket.unitId?.trim()) {
      const unitBuilding = ctx.unitIdBuildingMap.get(ticket.unitId.trim())
      if (unitBuilding) {
        return unitBuilding === key || buildingsLikelySamePlace(unitBuilding, building)
      }
    }
    const ticketEmail = ticket.email?.trim().toLowerCase()
    if (ticketEmail && emailBuildingMap.get(ticketEmail) === key) {
      return true
    }
    // Fail closed for multi-property portfolios — bare unit labels are not scope keys.
    if (ctx.knownBuildingNames.length === 1 && ctx.knownBuildingNames[0] === key) {
      return true
    }
    return false
  })
}

function filterUnitsForBuilding(
  units: PropertyHealthUnit[],
  building: string,
): PropertyHealthUnit[] {
  const key = normalizeBuildingKey(building)
  return units.filter((u) => normalizeBuildingKey(u.building) === key)
}

function filterUnitsForScope(
  units: PropertyHealthUnit[],
  building: string,
  property: PropertyHealthCanonicalProperty | null,
): PropertyHealthUnit[] {
  if (property) {
    return units.filter((unit) => unitBelongsToCanonicalProperty(unit, property))
  }
  return filterUnitsForBuilding(units, building)
}

/** Residents for a property detail scope — building aliases plus unit-inventory match. */
export function filterResidentsForPropertyScope(
  residents: PropertyHealthResident[],
  building: string,
  property: PropertyHealthCanonicalProperty | null,
  units: PropertyHealthUnit[],
): PropertyHealthResident[] {
  const aliases = buildingScopeAliasKeys(building, property, units)
  const scopedUnits = filterUnitsForScope(units, building, property)

  return residents.filter((resident) => {
    if (buildingMatchesScopeAliases(resident.building, aliases)) return true

    const unitKey = normalizeUnitLabel(resident.unit)
    if (!unitKey) return false

    const matchingUnits = scopedUnits.filter(
      (unit) => normalizeUnitLabel(unit.unitLabel) === unitKey,
    )
    if (matchingUnits.length === 0) return false

    const residentBuilding = resident.building?.trim()
    if (!residentBuilding) {
      // Empty building text: only attach when this unit label is unique across the
      // whole portfolio. Labels like "1" repeat and must not cross properties.
      const portfolioLabelCount = units.filter(
        (unit) => normalizeUnitLabel(unit.unitLabel) === unitKey,
      ).length
      return portfolioLabelCount === 1 && matchingUnits.length === 1
    }

    const residentBuildingKey = normalizeBuildingKey(residentBuilding)
    if (buildingMatchesScopeAliases(residentBuilding, aliases)) return true
    if (
      matchingUnits.some(
        (unit) => normalizeBuildingKey(unit.building) === residentBuildingKey,
      )
    ) {
      return true
    }

    // Onboarding / rent-roll labels may drift from the saved property name — trust
    // a unique unit match inside a canonical property inventory unless the building
    // text clearly belongs to another property in the portfolio.
    if (
      property &&
      matchingUnits.length === 1 &&
      unitBelongsToCanonicalProperty(matchingUnits[0]!, property) &&
      !residentBuildingNamesOtherProperty(residentBuildingKey, property, units)
    ) {
      return true
    }

    return false
  })
}

function residentBuildingNamesOtherProperty(
  residentBuildingKey: string,
  scopeProperty: PropertyHealthCanonicalProperty,
  allUnits: PropertyHealthUnit[],
): boolean {
  for (const unit of allUnits) {
    if (unit.propertyId && unit.propertyId !== scopeProperty.id) {
      if (normalizeBuildingKey(unit.building) === residentBuildingKey) return true
    }
  }
  return false
}

/** Best-effort property match for admin links when roster building text drifted or is empty. */
export function findCanonicalPropertyForResident(
  resident: Pick<PropertyHealthResident, 'unit' | 'building'>,
  properties: PropertyHealthCanonicalProperty[],
  units: PropertyHealthUnit[],
): PropertyHealthCanonicalProperty | null {
  for (const property of properties) {
    const scoped = filterResidentsForPropertyScope(
      [
        {
          id: '_',
          fullName: '',
          unit: resident.unit,
          building: resident.building,
          status: 'active',
        },
      ],
      property.name,
      property,
      units,
    )
    if (scoped.length > 0) return property
  }
  return null
}

function filterAssetsForScope(
  assets: PropertyHealthAsset[],
  building: string,
  property: PropertyHealthCanonicalProperty | null,
  units: PropertyHealthUnit[],
): PropertyHealthAsset[] {
  const aliases = buildingScopeAliasKeys(building, property, units)
  return assets.filter((asset) => {
    if (property?.id && asset.propertyId && asset.propertyId === property.id) return true
    return aliases.has(normalizeBuildingKey(asset.building))
  })
}

/** Scope tickets to one property/building (unit_id, building text, then property_id). */
export function filterTicketsForScope(
  tickets: PropertyHealthTicket[],
  building: string,
  units: PropertyHealthUnit[],
  residents: PropertyHealthResident[],
  property: PropertyHealthCanonicalProperty | null,
): PropertyHealthTicket[] {
  const aliases = buildingScopeAliasKeys(building, property, units)
  const seen = new Set<string>()
  const scoped: PropertyHealthTicket[] = []
  for (const alias of aliases) {
    for (const ticket of filterTicketsForBuildingScope(
      tickets,
      alias,
      units,
      residents,
    )) {
      if (seen.has(ticket.id)) continue
      seen.add(ticket.id)
      scoped.push(ticket)
    }
  }
  // property_id helps orphan SMS tickets, but never copy a ticket that already
  // names a different street address onto this building.
  if (property?.id) {
    const ctx = buildTicketBuildingContext(units)
    const emailBuildingMap = buildResidentEmailBuildingMap(residents)
    const buildingKey = normalizeBuildingKey(building)
    for (const ticket of tickets) {
      if (!ticket.propertyId || ticket.propertyId !== property.id) continue
      if (seen.has(ticket.id)) continue
      if (
        ticket.building?.trim() &&
        !buildingMatchesScopeAliases(ticket.building, aliases)
      ) {
        continue
      }
      const resolved = ticketBuilding(ticket, ctx, emailBuildingMap)
      if (
        resolved !== buildingKey &&
        !aliases.has(resolved) &&
        !buildingsLikelySamePlace(resolved, building) &&
        !buildingsLikelySamePlace(resolved, property.name)
      ) {
        continue
      }
      seen.add(ticket.id)
      scoped.push(ticket)
    }
  }
  return scoped
}

function filterFeedbackForScope(
  feedback: PropertyHealthFeedback[],
  building: string,
  ctx: TicketBuildingContext,
  property: PropertyHealthCanonicalProperty | null,
  units: PropertyHealthUnit[],
): PropertyHealthFeedback[] {
  const aliases = buildingScopeAliasKeys(building, property, units)
  return feedback.filter((f) => {
    if (f.building?.trim()) return aliases.has(normalizeBuildingKey(f.building))
    // Bare unit labels are not property keys — only attribute unlabeled feedback in
    // single-building portfolios.
    if (ctx.knownBuildingNames.length === 1) {
      return aliases.has(ctx.knownBuildingNames[0]!)
    }
    return false
  })
}

export function computeGridOccupancyForBuilding(
  units: PropertyHealthUnit[],
  _residents: PropertyHealthResident[],
  building: string,
  scopeProperty: PropertyHealthCanonicalProperty | null,
): { occupied: number; tracked: number; occupancyPct: number } {
  const buildingUnits = dedupePropertyUnitsByLabel(
    filterUnitsForScope(units, building, scopeProperty),
    scopeProperty?.name ?? building,
  )
  return occupancyFromInventory(buildingUnits)
}

function componentsFromHealthResult(
  result: ReturnType<typeof calculatePropertyHealth>,
): PropertyHealthComponent[] {
  return (Object.keys(PROPERTY_HEALTH_WEIGHTS) as PropertyHealthComponentKey[]).map((key) => {
    const dimension = result.dimensions[key]
    const gap = result.gaps.find((row) => row.dimension === key)
    return {
      key,
      label: COMPONENT_LABELS[key],
      score: dimension.points,
      maxPoints: dimension.maxPoints,
      weight: PROPERTY_HEALTH_WEIGHTS[key],
      isFallback: false,
      detail: gap ? `${dimension.detail}. ${formatPropertyHealthGap(gap)}` : dimension.detail,
    }
  })
}

const HEATING_SYSTEM_PATTERN = /\b(furnace|boiler|heat\s*pump|heating|hvac)\b/i
const WATER_HEATER_PATTERN = /water[\s_]*heater/i

/** Home Check equipment: a water heater and a heating system are both on record. */
function hasCompleteHomeCheckAssetList(assets: PropertyHealthAsset[]): boolean {
  const types = assets.map((asset) => asset.applianceType.replace(/_/g, ' '))
  return (
    types.some((type) => WATER_HEATER_PATTERN.test(type)) &&
    types.some((type) => HEATING_SYSTEM_PATTERN.test(type) && !WATER_HEATER_PATTERN.test(type))
  )
}

const INACTIVE_VENDOR_ROSTER_STATUSES = new Set(['inactive', 'suspended', 'banned', 'removed', 'archived'])

/** Core trades with at least one active vendor on the landlord's roster. */
export function coveredCoreTrades(vendors: PropertyHealthVendor[]): CoreVendorTrade[] {
  const covered = new Set<CoreVendorTrade>()
  for (const vendor of vendors) {
    if (!vendor.active) continue
    if (INACTIVE_VENDOR_ROSTER_STATUSES.has((vendor.rosterStatus ?? '').trim().toLowerCase())) continue
    for (const trade of coreTradesForVendorCategory(vendor.category)) covered.add(trade)
  }
  return CORE_VENDOR_TRADES.filter((trade) => covered.has(trade))
}

function isObservationOnlyTicket(
  ticket: PropertyHealthTicket,
  extras: Record<string, PropertyHealthTicketExtras> | undefined,
): boolean {
  return extras?.[ticket.id]?.observationOnly === true
}

/** Open action item as of `asOfMs` (defaults to now). */
function isOpenActionItem(
  ticket: PropertyHealthTicket,
  extras: Record<string, PropertyHealthTicketExtras> | undefined,
  asOfMs: number | undefined,
): boolean {
  if (isVoidedWorkOrder(ticket) || isObservationOnlyTicket(ticket, extras)) return false
  if (asOfMs == null) return isTicketOpen(ticket)
  const created = parseTimestampMs(ticket.createdAt)
  if (created == null || created >= asOfMs) return false
  const completed = parseTimestampMs(ticket.completedAt)
  if (completed != null) return completed >= asOfMs
  return isTicketOpen(ticket)
}

/** True when the most recent completed job has at least one completion photo. */
function lastCompletedJobHasPhoto(
  tickets: PropertyHealthTicket[],
  extras: Record<string, PropertyHealthTicketExtras> | undefined,
): boolean {
  let latest: { ticket: PropertyHealthTicket; at: number } | null = null
  for (const ticket of tickets) {
    if (isVoidedWorkOrder(ticket) || isObservationOnlyTicket(ticket, extras)) continue
    const done =
      Boolean(ticket.completedAt?.trim()) || ticket.vendorWorkStatus.toLowerCase() === 'completed'
    if (!done) continue
    const at = parseTimestampMs(ticket.completedAt) ?? parseTimestampMs(ticket.createdAt) ?? 0
    if (!latest || at > latest.at) latest = { ticket, at }
  }
  if (!latest) return false
  return (extras?.[latest.ticket.id]?.completionPhotoCount ?? 0) > 0
}

/** Every current resident in scope has a lease upload matched to them. */
function everyResidentHasLeaseOnFile(
  residents: PropertyHealthResident[],
  fallbackBuilding: string | null,
  leases: PropertyHealthLeaseLookup | null | undefined,
): boolean {
  if (!leases || residents.length === 0) return false
  return residents.every((resident) =>
    leases.hasLeaseFor({
      fullName: resident.fullName,
      unit: resident.unit,
      building: resident.building ?? fallbackBuilding ?? '',
      email: resident.email ?? null,
    }),
  )
}

function occupyingResidentsForHealthScope(
  residents: PropertyHealthResident[],
  _scopedUnits: PropertyHealthUnit[],
  scopeBuilding: string | null,
  scopeProperty: PropertyHealthCanonicalProperty | null,
  allUnits: PropertyHealthUnit[],
): PropertyHealthResident[] {
  const occupying = residents.filter((resident) => isOccupyingResidentStatus(resident.status))
  if (scopeBuilding == null) return occupying
  return filterResidentsForPropertyScope(occupying, scopeBuilding, scopeProperty, allUnits)
}

/**
 * Inactive inventory is still operational when residents are already assigned.
 * Do not leave those properties in Pending setup.
 */
function resolveTrackedHealthUnits(
  scopedUnits: PropertyHealthUnit[],
  occupyingResidents: PropertyHealthResident[],
): PropertyHealthUnit[] {
  const tracked = scopedUnits.filter((unit) => unit.status !== 'inactive')
  if (tracked.length > 0) return tracked
  if (occupyingResidents.length === 0) return []
  if (scopedUnits.length > 0) {
    return scopedUnits.map((unit) =>
      unit.status === 'inactive' ? { ...unit, status: 'active' } : unit,
    )
  }
  return occupyingResidents.map((resident, index) => ({
    id: `assigned:${resident.id}`,
    unitLabel: resident.unit.trim() || `assigned-${index + 1}`,
    building: resident.building,
    status: 'active',
  }))
}

export function computePropertyHealthScope(
  inputs: PropertyHealthInputs,
  scope: { building?: string; property?: PropertyHealthCanonicalProperty } = {},
): PropertyHealthScopeScore | null {
  const scopeBuilding = scope.building?.trim()
  const scopeProperty = scope.property ?? null

  const scopedUnits =
    scopeBuilding != null
      ? filterUnitsForScope(inputs.units, scopeBuilding, scopeProperty)
      : inputs.units
  const occupyingResidents = occupyingResidentsForHealthScope(
    inputs.residents ?? [],
    scopedUnits,
    scopeBuilding ?? null,
    scopeProperty,
    inputs.units,
  )
  const trackedUnits = resolveTrackedHealthUnits(scopedUnits, occupyingResidents)
  if (trackedUnits.length === 0) {
    if (scopeBuilding == null) return null
    return buildNeutralScopeScore()
  }

  const scopedTickets =
    scopeBuilding != null
      ? filterTicketsForScope(
          inputs.tickets,
          scopeBuilding,
          inputs.units,
          inputs.residents ?? [],
          scopeProperty,
        )
      : inputs.tickets
  const scopedAssets =
    scopeBuilding != null
      ? filterAssetsForScope(inputs.assets ?? [], scopeBuilding, scopeProperty, inputs.units)
      : (inputs.assets ?? [])

  // Occupancy: active leases vs. every unit onboarded for this property.
  const inventory =
    scopedUnits.length > 0
      ? scopeBuilding != null
        ? dedupePropertyUnitsByLabel(scopedUnits, scopeProperty?.name ?? scopeBuilding)
        : uniqueUnitsForOccupancy(scopedUnits)
      : trackedUnits
  const occupiedUnits = inventory.filter(
    (unit) =>
      isOccupiedUnitStatus(unit.status) ||
      isUnitOccupiedByResident(unit, unit.building ?? scopeBuilding ?? '', occupyingResidents),
  ).length

  const extras = inputs.ticketExtras
  const result = calculatePropertyHealth({
    openItemCount: scopedTickets.filter((ticket) =>
      isOpenActionItem(ticket, extras, inputs.openIssuesCreatedBeforeMs),
    ).length,
    totalUnits: inventory.length,
    occupiedUnits,
    coveredTrades: coveredCoreTrades(inputs.vendors ?? []),
    documentation: {
      leaseOnFile: everyResidentHasLeaseOnFile(
        occupyingResidents,
        scopeProperty?.name ?? scopeBuilding ?? null,
        inputs.leaseDocuments,
      ),
      assetListComplete: hasCompleteHomeCheckAssetList(scopedAssets),
      lastJobPhotoReceipt: lastCompletedJobHasPhoto(scopedTickets, extras),
    },
  })

  const components = componentsFromHealthResult(result)
  const score = result.score
  const status = resolvePropertyHealthStatus(score, components)
  const dimensionsFull = components.filter((component) => component.score >= component.maxPoints).length

  return {
    score,
    status,
    rating: result.rating,
    components,
    trackedUnitCount: trackedUnits.length,
    pendingReason: null,
    dataCompleteness: Math.round((dimensionsFull / components.length) * 100) / 100,
    topIssues: result.gaps.slice(0, 4).map(formatPropertyHealthGap),
    gaps: result.gaps,
  }
}

function buildingHealthRollupWeight(row: {
  unitCount: number
  trackedUnitCount: number
}): number {
  if (row.unitCount > 0) return row.unitCount
  return Math.max(row.trackedUnitCount, 0)
}

function rollupCategoryFromBuildings(
  buildings: PropertyHealthBuildingRow[],
  key: PropertyHealthComponentKey,
): PropertyHealthComponent {
  let weightSum = 0
  let scoreSum = 0
  let detail: string | null = null
  for (const building of buildings) {
    const component = building.components.find((row) => row.key === key)
    if (!component || component.isFallback) continue
    const weight = buildingHealthRollupWeight(building) || 1
    weightSum += weight
    scoreSum += component.score * weight
    if (!detail && component.detail && component.detail !== 'No deductions') {
      detail = component.detail
    }
  }
  if (weightSum === 0) {
    return {
      key,
      label: COMPONENT_LABELS[key],
      score: 0,
      maxPoints: VITALS_DIMENSION_POINTS,
      weight: PROPERTY_HEALTH_WEIGHTS[key],
      isFallback: true,
      detail: 'Not enough information yet',
    }
  }
  return {
    key,
    label: COMPONENT_LABELS[key],
    score: clampHealthScore(scoreSum / weightSum),
    maxPoints: VITALS_DIMENSION_POINTS,
    weight: PROPERTY_HEALTH_WEIGHTS[key],
    isFallback: false,
    detail: detail ?? 'Weighted by unit count across properties',
  }
}

/** Overview KPI: unit-weighted mean of buildings that have a Condition-backed score. */
export function rollupPortfolioHealthFromBuildings(
  buildings: PropertyHealthBuildingRow[],
): PropertyHealthScopeScore | null {
  if (buildings.length === 0) return null

  const trackedUnitCount = buildings.reduce((sum, row) => sum + row.trackedUnitCount, 0)
  const components = (Object.keys(PROPERTY_HEALTH_WEIGHTS) as PropertyHealthComponentKey[]).map(
    (key) => rollupCategoryFromBuildings(buildings, key),
  )
  const scored = buildings.filter(
    (row) => row.score != null && shouldShowPropertyHealthScore(row.status),
  )

  if (scored.length === 0) {
    const allPending = buildings.every((row) => row.status === 'pending_setup')
    return {
      score: null,
      status: allPending ? 'pending_setup' : 'unknown',
      rating: null,
      components,
      trackedUnitCount,
      pendingReason: allPending ? 'inactive_units' : 'unknown_condition',
      dataCompleteness: 0,
      topIssues: [],
      scoredPropertyCount: 0,
      propertyCount: buildings.length,
    }
  }

  let weightSum = 0
  let scoreSum = 0
  let completenessWeight = 0
  let completenessSum = 0
  for (const row of scored) {
    const weight = buildingHealthRollupWeight(row) || 1
    weightSum += weight
    scoreSum += row.score! * weight
    if (row.dataCompleteness != null) {
      completenessWeight += weight
      completenessSum += row.dataCompleteness * weight
    }
  }
  const score = clampHealthScore(scoreSum / weightSum)
  const status = resolvePropertyHealthStatus(score, components)
  const topIssues = [
    ...new Set(
      scored
        .slice()
        .sort((a, b) => (a.score ?? 101) - (b.score ?? 101))
        .flatMap((row) => row.topIssues ?? []),
    ),
  ].slice(0, 3)

  return {
    score,
    status,
    rating: propertyHealthRatingFromScore(score),
    components,
    trackedUnitCount,
    pendingReason: null,
    dataCompleteness: completenessWeight > 0 ? completenessSum / completenessWeight : undefined,
    topIssues,
    scoredPropertyCount: scored.length,
    propertyCount: buildings.length,
  }
}

function collectBuildingHealthRows(
  inputs: PropertyHealthInputs,
  landlordId: string,
): PropertyHealthBuildingRow[] {
  const ticketBuildingCtx = buildTicketBuildingContext(inputs.units)
  const buildingKeys = collectPropertyGridBuildingKeys(
    inputs.units,
    inputs.pmTasks,
    inputs.tickets,
    landlordId,
    inputs.residents ?? [],
    inputs.canonicalProperties ?? [],
  )
  const openTickets = inputs.tickets.filter(isTicketOpen)
  const buildings: PropertyHealthBuildingRow[] = []

  for (const building of buildingKeys) {
    const scopeProperty = findCanonicalPropertyByGridKey(
      building,
      inputs.canonicalProperties ?? [],
      inputs.units,
    )
    const buildingUnits = dedupePropertyUnitsByLabel(
      filterUnitsForScope(inputs.units, building, scopeProperty),
      scopeProperty?.name ?? building,
    )
    const scopeScore =
      buildingUnits.length > 0
        ? computePropertyHealthScope(inputs, {
            building,
            property: scopeProperty ?? undefined,
          })
        : buildNeutralScopeScore()

    if (!scopeScore) continue

    const occupancy = computeGridOccupancyForBuilding(
      inputs.units,
      inputs.residents ?? [],
      building,
      scopeProperty,
    )
    const scopedOpenTickets = filterTicketsForScope(
      openTickets,
      building,
      inputs.units,
      inputs.residents ?? [],
      scopeProperty,
    )
    const scopedWorkOrders = filterTicketsForScope(
      inputs.tickets.filter((ticket) => !isVoidedWorkOrder(ticket)),
      building,
      inputs.units,
      inputs.residents ?? [],
      scopeProperty,
    )
    const scopedFeedback = filterFeedbackForScope(
      inputs.feedback,
      building,
      ticketBuildingCtx,
      scopeProperty,
      inputs.units,
    )
    const ratings = scopedFeedback
      .map((f) => f.rating)
      .filter((r) => Number.isFinite(r) && r >= 1 && r <= 5)
    const residentRating =
      ratings.length > 0
        ? Math.round((ratings.reduce((s, r) => s + r, 0) / ratings.length) * 10) / 10
        : null

    buildings.push({
      ...scopeScore,
      building,
      unitCount: buildingUnits.length,
      propertyType: scopeProperty?.propertyType
        ?? (inputs.canonicalProperties ?? []).find((property) =>
          buildingUnits.some((unit) => unit.propertyId && unit.propertyId === property.id),
        )?.propertyType
        ?? null,
      openTickets: scopedOpenTickets.length,
      workOrderCount: scopedWorkOrders.length,
      occupancyPct: occupancy.occupancyPct,
      residentRating,
      feedbackCount: ratings.length,
    })
  }

  buildings.sort((a, b) => (a.score ?? 101) - (b.score ?? 101))
  return buildings
}

export function buildPropertyHealthReport(
  inputs: PropertyHealthInputs,
  landlordId: string = getActiveLandlordId(),
): PropertyHealthReport {
  const now = inputs.now ?? Date.now()
  const buildings = collectBuildingHealthRows(inputs, landlordId)
  const portfolio = rollupPortfolioHealthFromBuildings(buildings)
  const portfolioDelta = (() => {
    if (!portfolio || portfolio.score == null) return null
    const previousBuildings = collectBuildingHealthRows(
      {
        ...inputs,
        now: now - FOUR_WEEKS_MS,
        openIssuesCreatedBeforeMs: now - FOUR_WEEKS_MS,
      },
      landlordId,
    )
    const previous = rollupPortfolioHealthFromBuildings(previousBuildings)
    if (!previous || previous.score == null) return null
    return portfolio.score - previous.score
  })()

  return { portfolio, portfolioDelta, buildings }
}

export function formatPropertyHealthTooltip(components: PropertyHealthComponent[]): string {
  return components
    .map((c) => {
      const value = c.isFallback ? '—' : `${c.score}/${c.maxPoints}`
      return `${c.label}: ${value} — ${c.detail}`
    })
    .join('\n')
}

const CATEGORY_ORDER = Object.keys(PROPERTY_HEALTH_WEIGHTS) as PropertyHealthComponentKey[]

export type PropertyHealthFactorBreakdownLine = {
  label: string
  value: string
  detail: string
}

/** KPI popover rows for the four Vitals dimensions (Factor · Points · What it means). */
export function propertyHealthFactorBreakdownLines(
  components: PropertyHealthComponent[],
): PropertyHealthFactorBreakdownLine[] {
  const byKey = new Map(components.map((component) => [component.key, component]))
  return CATEGORY_ORDER.map((key) => {
    const component = byKey.get(key)
    if (!component || component.isFallback) {
      return {
        label: COMPONENT_LABELS[key],
        value: 'Unknown',
        detail: 'Add units to score this part.',
      }
    }
    return {
      label: COMPONENT_LABELS[key],
      value: `${component.score} / ${component.maxPoints}`,
      detail: component.detail,
    }
  })
}

function asString(value: unknown): string {
  if (value == null) return ''
  return String(value).trim()
}

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

function parseTimestampMs(value: unknown): number | null {
  const raw = asString(value)
  if (!raw) return null
  const ts = new Date(raw).getTime()
  return Number.isNaN(ts) ? null : ts
}

/** Map dashboard maintenance ticket rows into property-health inputs. */
export function mapTicketsForPropertyHealth(
  rows: Record<string, unknown>[],
): PropertyHealthTicket[] {
  return rows.map((raw) => ({
    id: asString(raw.id),
    createdAt: asString(raw.created_at ?? raw.createdAt),
    unit: asString(raw.unit),
    unitId: asString(raw.unit_id ?? raw.unitId) || null,
    building: asString(raw.building) || null,
    propertyId: asString(raw.property_id ?? raw.propertyId) || null,
    completedAt:
      asString(raw.completed_at ?? raw.completedAt) ||
      asString(raw.resolved_at ?? raw.resolvedAt) ||
      asString(raw.closed_at ?? raw.closedAt) ||
      null,
    email: asString(raw.email) || null,
    issueCategory: asString(raw.issue_category ?? raw.issueCategory) || null,
    vendorWorkStatus: asString(raw.vendor_work_status ?? raw.vendorWorkStatus).toLowerCase(),
    assignedVendorId: asString(raw.assigned_vendor_id ?? raw.assignedVendorId) || null,
    description: asString(raw.description) || null,
    urgency: asString(raw.urgency) || null,
    severity: asString(raw.severity) || null,
    priority: asString(raw.priority) || null,
    dueAt: asString(raw.due_at ?? raw.dueAt) || null,
    inspectionReportId:
      asString(raw.inspection_report_id ?? raw.inspectionReportId) || null,
  }))
}

export function mapUnitsForPropertyHealth(
  rows: Record<string, unknown>[],
): PropertyHealthUnit[] {
  return rows.map((raw) => ({
    id: asString(raw.id),
    unitLabel: asString(raw.unit_label) || asString(raw.unitLabel),
    building: asString(raw.building) || null,
    status: asString(raw.status).toLowerCase(),
    propertyId: asString(raw.property_id ?? raw.propertyId) || null,
    trackedSinceMs: parseTimestampMs(raw.updated_at ?? raw.updatedAt),
  }))
}

function parseDeficiencyList(value: unknown): Array<{ severity?: string | null; description?: string | null }> {
  if (!Array.isArray(value)) return []
  const list: Array<{ severity?: string | null; description?: string | null }> = []
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue
    const row = raw as { severity?: unknown; description?: unknown }
    list.push({
      severity: typeof row.severity === 'string' ? row.severity : null,
      description: typeof row.description === 'string' ? row.description : null,
    })
  }
  return list
}

function parseInspectionResult(value: unknown): {
  category: string | null
  conditionRating: string | null
  deficiencies: Array<{ severity?: string | null; description?: string | null }>
} | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  const identified = row.identifiedItem && typeof row.identifiedItem === 'object'
    ? (row.identifiedItem as Record<string, unknown>)
    : null
  const condition = row.condition && typeof row.condition === 'object'
    ? (row.condition as Record<string, unknown>)
    : null
  return {
    category: asString(row.category) || asString(identified?.type) || null,
    conditionRating: asString(condition?.rating) || null,
    deficiencies: parseDeficiencyList(row.deficiencies),
  }
}

/** Vitals inputs not carried on the pages' own ticket / unit rows. */
export type PropertyHealthVitalsSignals = {
  vendors: PropertyHealthVendor[]
  ticketExtras: Record<string, PropertyHealthTicketExtras>
  leaseDocuments: PropertyHealthLeaseLookup | null
}

export function emptyPropertyHealthVitalsSignals(): PropertyHealthVitalsSignals {
  return { vendors: [], ticketExtras: {}, leaseDocuments: null }
}

async function fetchPropertyHealthVitalsSignals(
  landlordId: string,
): Promise<PropertyHealthVitalsSignals> {
  const { supabase } = await import('@/lib/supabase')
  if (!supabase) return emptyPropertyHealthVitalsSignals()

  const [vendorResult, ticketResult, leaseResult] = await Promise.allSettled([
    supabase
      .from('vendors')
      .select('id, category, active, roster_status')
      .eq('landlord_id', landlordId)
      .limit(500),
    supabase
      .from('maintenance_requests')
      .select('id, observation_only, completion_photo_paths')
      .eq('landlord_id', landlordId)
      .order('created_at', { ascending: false })
      .limit(1000),
    (async () => {
      const { collectResidentLeaseDocuments, loadLeaseDocumentPool } = await import(
        '@/lib/residentLeaseDocuments'
      )
      const pool = await loadLeaseDocumentPool(landlordId)
      const lookup: PropertyHealthLeaseLookup = {
        hasLeaseFor: (resident) =>
          collectResidentLeaseDocuments(pool.documents, resident, pool.review).length > 0,
      }
      return lookup
    })(),
  ])

  const vendors: PropertyHealthVendor[] =
    vendorResult.status === 'fulfilled' && !vendorResult.value.error
      ? ((vendorResult.value.data ?? []) as Record<string, unknown>[]).map((row) => ({
          id: asString(row.id),
          category: asString(row.category) || null,
          active: row.active !== false,
          rosterStatus: asString(row.roster_status) || null,
        }))
      : []

  const ticketExtras: Record<string, PropertyHealthTicketExtras> = {}
  if (ticketResult.status === 'fulfilled' && !ticketResult.value.error) {
    for (const row of (ticketResult.value.data ?? []) as Record<string, unknown>[]) {
      const id = asString(row.id)
      if (!id) continue
      ticketExtras[id] = {
        observationOnly: row.observation_only === true,
        completionPhotoCount: Array.isArray(row.completion_photo_paths)
          ? row.completion_photo_paths.length
          : 0,
      }
    }
  }

  return {
    vendors,
    ticketExtras,
    leaseDocuments: leaseResult.status === 'fulfilled' ? leaseResult.value : null,
  }
}

/** Fetch PM, assets, inspections, damage reports and Vitals inputs for property health. */
export async function fetchPropertyHealthSignals(): Promise<{
  pmTasks: PropertyHealthPmTask[]
  feedback: PropertyHealthFeedback[]
  vendorMetrics: PropertyHealthVendorMetrics[]
  assets: PropertyHealthAsset[]
  inspections: PropertyHealthInspection[]
  damageReports: PropertyHealthDamageReport[]
  vitals: PropertyHealthVitalsSignals
}> {
  const empty = {
    pmTasks: [] as PropertyHealthPmTask[],
    feedback: [] as PropertyHealthFeedback[],
    vendorMetrics: [] as PropertyHealthVendorMetrics[],
    assets: [] as PropertyHealthAsset[],
    inspections: [] as PropertyHealthInspection[],
    damageReports: [] as PropertyHealthDamageReport[],
    vitals: emptyPropertyHealthVitalsSignals(),
  }
  const { supabase } = await import('@/lib/supabase')
  if (!supabase) return empty

  const landlordId = getActiveLandlordId()
  const vitalsPromise = fetchPropertyHealthVitalsSignals(landlordId).catch(() =>
    emptyPropertyHealthVitalsSignals(),
  )

  const [pmResult, feedbackResult, vendorResult, assetResult, assessmentResult, damageResult] =
    await Promise.allSettled([
      supabase
        .from('pm_compliance_dashboard_view')
        .select('building, unit_label, task_status, due_at')
        .eq('landlord_id', landlordId)
        .limit(500),
      supabase
        .from('vendor_feedback')
        .select('rating, maintenance_request_id')
        .eq('landlord_id', landlordId)
        .limit(500),
      supabase
        .from('vendor_operational_metrics')
        .select(
          'vendor_id, accepted_jobs, completed_jobs, completion_rate, avg_response_time',
        )
        .eq('landlord_id', landlordId)
        .limit(200),
      supabase
        .from('unit_assets')
        .select(
          'building, property_id, appliance_type, estimated_age_years, useful_life_years, replacement_urgency, metadata',
        )
        .eq('landlord_id', landlordId)
        .limit(1000),
      supabase
        .from('property_inspection_assessments')
        .select('id, building, property_id')
        .eq('landlord_id', landlordId)
        .limit(200),
      supabase
        .from('vendor_property_damage_reports')
        .select('created_at, maintenance_request_id')
        .eq('landlord_id', landlordId)
        .limit(200),
    ])

  const pmTasks: PropertyHealthPmTask[] =
    pmResult.status === 'fulfilled' && !pmResult.value.error
      ? ((pmResult.value.data ?? []) as Record<string, unknown>[]).map((row) => ({
          building: asString(row.building) || null,
          unitLabel: asString(row.unit_label) || null,
          taskStatus: asString(row.task_status).toLowerCase(),
          dueAt: asString(row.due_at) || null,
        }))
      : []

  const feedback: PropertyHealthFeedback[] = []
  if (feedbackResult.status === 'fulfilled' && !feedbackResult.value.error) {
    for (const row of (feedbackResult.value.data ?? []) as Record<string, unknown>[]) {
      const rating = asFiniteNumber(row.rating)
      if (rating == null) continue
      feedback.push({
        rating,
        maintenanceRequestId: asString(row.maintenance_request_id),
        unit: null,
        building: null,
      })
    }
  }

  const vendorMetrics: PropertyHealthVendorMetrics[] =
    vendorResult.status === 'fulfilled' && !vendorResult.value.error
      ? ((vendorResult.value.data ?? []) as Record<string, unknown>[]).map((row) => ({
          vendorId: asString(row.vendor_id),
          acceptedJobs: Number(row.accepted_jobs ?? 0),
          completedJobs: Number(row.completed_jobs ?? 0),
          completionRate: asFiniteNumber(row.completion_rate),
          avgResponseTime: asFiniteNumber(row.avg_response_time),
        }))
      : []

  const assets: PropertyHealthAsset[] = []
  if (assetResult.status === 'fulfilled' && !assetResult.value.error) {
    for (const row of (assetResult.value.data ?? []) as Record<string, unknown>[]) {
      const meta =
        row.metadata && typeof row.metadata === 'object'
          ? (row.metadata as Record<string, unknown>)
          : {}
      assets.push({
        building: asString(row.building) || null,
        propertyId: asString(row.property_id) || null,
        applianceType: asString(row.appliance_type),
        estimatedAgeYears: asFiniteNumber(row.estimated_age_years),
        usefulLifeYears: asFiniteNumber(row.useful_life_years),
        replacementUrgency: asString(row.replacement_urgency) || null,
        condition: asString(meta.condition) || asString(meta.conditionRating) || null,
        deficiencies: parseDeficiencyList(meta.deficiencies),
      })
    }
  }

  const assessments: Array<{ id: string; building: string | null; propertyId: string | null }> = []
  if (assessmentResult.status === 'fulfilled' && !assessmentResult.value.error) {
    for (const row of (assessmentResult.value.data ?? []) as Record<string, unknown>[]) {
      assessments.push({
        id: asString(row.id),
        building: asString(row.building) || null,
        propertyId: asString(row.property_id) || null,
      })
    }
  }

  const inspections: PropertyHealthInspection[] = []
  if (assessments.length > 0 && supabase) {
    const assessmentIds = assessments.map((row) => row.id)
    const { data: photos, error: photoError } = await supabase
      .from('property_inspection_photos')
      .select('assessment_id, status, confirmed_result, hint_category')
      .eq('landlord_id', landlordId)
      .eq('status', 'confirmed')
      .in('assessment_id', assessmentIds)
      .limit(1000)
    if (!photoError && photos) {
      const byId = new Map(assessments.map((row) => [row.id, row]))
      for (const photo of photos as Record<string, unknown>[]) {
        const parsed = parseInspectionResult(photo.confirmed_result)
        if (!parsed) continue
        const parent = byId.get(asString(photo.assessment_id))
        inspections.push({
          building: parent?.building ?? null,
          propertyId: parent?.propertyId ?? null,
          category: parsed.category || asString(photo.hint_category) || null,
          conditionRating: parsed.conditionRating,
          deficiencies: parsed.deficiencies,
        })
      }
    }
  }

  const damageReports: PropertyHealthDamageReport[] =
    damageResult.status === 'fulfilled' && !damageResult.value.error
      ? ((damageResult.value.data ?? []) as Record<string, unknown>[]).map((row) => ({
          createdAt: asString(row.created_at),
          maintenanceRequestId: asString(row.maintenance_request_id) || null,
        }))
      : []

  const vitals = await vitalsPromise
  return { pmTasks, feedback, vendorMetrics, assets, inspections, damageReports, vitals }
}

/** Attach unit/building from maintenance tickets to resident feedback rows. */
export function enrichFeedbackFromTickets(
  feedback: PropertyHealthFeedback[],
  tickets: PropertyHealthTicket[],
): PropertyHealthFeedback[] {
  const byId = new Map(tickets.map((t) => [t.id, t]))
  return feedback.map((f) => {
    const ticket = byId.get(f.maintenanceRequestId)
    return {
      ...f,
      unit: f.unit ?? ticket?.unit ?? null,
      building: f.building ?? ticket?.building ?? null,
    }
  })
}
