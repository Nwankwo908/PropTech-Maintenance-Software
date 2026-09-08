/**
 * Unified Property Health — portfolio and per-building views.
 *
 * Score (0–100) comes from calculatePropertyHealth():
 *   40% Condition · 35% Maintenance · 25% Risk
 * Missing factors are unknown (not scored as 50).
 *
 * Property activation (Active vs Pending setup) is separate from health scoring.
 */
import { getActiveLandlordId } from '@/lib/activeLandlord'
import {
  REPEAT_ISSUE_WINDOW_DAYS,
  calculatePropertyHealth,
  propertyHealthRatingFromScore,
  type PropertyHealthRating,
} from '@/lib/propertyHealth/calculatePropertyHealth'

export {
  REPEAT_ISSUE_WINDOW_DAYS,
  calculatePropertyHealth,
  propertyHealthRatingFromScore,
}
export type { PropertyHealthRating }

/** Days of ops history used by older insights gates (not a score penalty). */
export const PROPERTY_HEALTH_OPS_MATURITY_DAYS = 30

export const PROPERTY_HEALTH_INSIGHTS_CAPTION =
  'More activity needed for full insights'

export const PROPERTY_HEALTH_WEIGHTS = {
  condition: 0.4,
  maintenance: 0.35,
  risk: 0.25,
} as const

export const PROPERTY_HEALTH_KPI_CAPTION = 'Operational health score.'

export type PropertyHealthPendingReason = 'inactive_units' | 'collecting_history'

/** KPI helper copy for property health — activation vs insights are separate. */
export function resolvePropertyHealthKpiCaption(
  portfolio: PropertyHealthScopeScore | null,
): string {
  if (!portfolio || portfolio.status === 'pending_setup') {
    return 'Activate units to start measuring property health.'
  }
  if (!shouldShowPropertyHealthScore(portfolio.status)) {
    return PROPERTY_HEALTH_INSIGHTS_CAPTION
  }
  return portfolio.rating ?? PROPERTY_HEALTH_KPI_CAPTION
}

/** Building-card copy when the numeric health score is not shown yet. */
export function resolvePropertyHealthPendingMessage(
  pendingReason: PropertyHealthPendingReason | null | undefined,
): string {
  if (pendingReason === 'collecting_history') {
    return PROPERTY_HEALTH_INSIGHTS_CAPTION
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
    status === 'at_risk'
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
  if (!shouldShowPropertyHealthScore(status) || score == null) return '—'
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
  | 'active'
  | 'pending_setup'

export type PropertyHealthComponentKey = 'condition' | 'maintenance' | 'risk'

export type PropertyHealthComponent = {
  key: PropertyHealthComponentKey
  label: string
  score: number
  weight: number
  /** True when this category had no known factors. */
  isFallback: boolean
  detail: string
}

export type PropertyHealthScopeScore = {
  score: number
  status: PropertyHealthStatus
  rating: PropertyHealthRating | null
  components: PropertyHealthComponent[]
  /** Tracked units (status !== inactive) in this scope. */
  trackedUnitCount: number
  pendingReason?: PropertyHealthPendingReason | null
  dataCompleteness?: number
  topIssues?: string[]
}

export type PropertyHealthBuildingRow = PropertyHealthScopeScore & {
  building: string
  unitCount: number
  /** Open maintenance tickets scoped to this building (work orders). */
  openTickets: number
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
  issueCategory?: string | null
  vendorWorkStatus: string
  assignedVendorId?: string | null
  email?: string | null
  description?: string | null
  urgency?: string | null
  severity?: string | null
  priority?: string | null
  dueAt?: string | null
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
  /** Override repeat-issue lookback window (ms). Defaults to REPEAT_ISSUE_WINDOW_DAYS. */
  repeatWindowMs?: number
  /**
   * When set, open-maintenance scoring only counts units with open tickets whose
   * created_at is before this timestamp (used for portfolio delta proxy).
   */
  openIssuesCreatedBeforeMs?: number
}

const CLOSED_WORK_STATUSES = new Set(['completed', 'cancelled'])
/** Removed / resident-stopped work orders are not real repair history. */
const VOIDED_WORK_STATUSES = new Set(['cancelled', 'deleted'])

function isVoidedWorkOrder(ticket: Pick<PropertyHealthTicket, 'vendorWorkStatus'>): boolean {
  return VOIDED_WORK_STATUSES.has(ticket.vendorWorkStatus.toLowerCase())
}

const FOUR_WEEKS_MS = 28 * 24 * 60 * 60 * 1000

const COMPONENT_LABELS: Record<PropertyHealthComponentKey, string> = {
  condition: 'Condition',
  maintenance: 'Maintenance',
  risk: 'Risk',
}

function buildNeutralComponents(): PropertyHealthComponent[] {
  return (Object.keys(PROPERTY_HEALTH_WEIGHTS) as PropertyHealthComponentKey[]).map((key) => ({
    key,
    label: COMPONENT_LABELS[key],
    score: 0,
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
  if (rating === 'Excellent') return 'excellent'
  if (rating === 'Good') return 'good'
  if (rating === 'Fair') return 'fair'
  if (rating === 'Needs Attention') return 'needs_attention'
  return 'high_risk'
}

export function resolvePropertyHealthStatus(
  score: number,
  components: PropertyHealthComponent[],
  options?: { insufficientOperationalSignal?: boolean },
): PropertyHealthStatus {
  if (isPendingSetupHealth(components)) return 'pending_setup'
  if (options?.insufficientOperationalSignal) return propertyHealthStatus(score)
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
  const shorter = aKey.length <= bKey.length ? aKey : bKey
  const longer = aKey.length <= bKey.length ? bKey : aKey
  return shorter.length >= 8 && (longer.startsWith(`${shorter} `) || longer.includes(` ${shorter} `))
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
  aliases.add(normalizeBuildingKey(property.name))
  for (const unit of units) {
    if (unitBelongsToCanonicalProperty(unit, property) && unit.building?.trim()) {
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
  return !CLOSED_WORK_STATUSES.has(ticket.vendorWorkStatus.toLowerCase())
}

type TicketBuildingContext = {
  unitIdBuildingMap: Map<string, string>
  uniqueUnitLabelBuildingMap: Map<string, string>
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
    const firstWord = canonicalLower.split(/\s+/)[0] ?? ''
    if (
      firstWord &&
      (firstWord === normalizedLower ||
        canonicalLower.startsWith(`${normalizedLower} `) ||
        normalizedLower.startsWith(firstWord))
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
  const labelToBuildings = new Map<string, Set<string>>()
  const knownBuildingNamesSet = new Set<string>()

  for (const unit of units) {
    if (unit.building?.trim()) {
      knownBuildingNamesSet.add(normalizeBuildingKey(unit.building))
    }
    if (unit.id) {
      unitIdBuildingMap.set(unit.id, normalizeBuildingKey(unit.building))
    }
    const label = normalizeUnitLabel(unit.unitLabel)
    if (!label) continue
    const buildings = labelToBuildings.get(label) ?? new Set<string>()
    buildings.add(normalizeBuildingKey(unit.building))
    labelToBuildings.set(label, buildings)
  }

  const uniqueUnitLabelBuildingMap = new Map<string, string>()
  for (const [label, buildings] of labelToBuildings) {
    if (buildings.size === 1) {
      uniqueUnitLabelBuildingMap.set(label, [...buildings][0]!)
    }
  }

  return {
    unitIdBuildingMap,
    uniqueUnitLabelBuildingMap,
    knownBuildingNames: [...knownBuildingNamesSet],
  }
}

function ticketBuilding(
  ticket: PropertyHealthTicket,
  ctx: TicketBuildingContext,
  emailBuildingMap?: Map<string, string>,
): string {
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
  const fromLabel = ctx.uniqueUnitLabelBuildingMap.get(normalizeUnitLabel(ticket.unit))
  return fromLabel ?? 'Portfolio'
}

/** Scope maintenance tickets to one building (uses unit_id when unit labels repeat across properties). */
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
    if (
      ticket.building?.trim() &&
      resolveCanonicalBuildingLabel(ticket.building, ctx.knownBuildingNames) === key
    ) {
      return true
    }
    const ticketEmail = ticket.email?.trim().toLowerCase()
    if (ticketEmail && emailBuildingMap.get(ticketEmail) === key) {
      return true
    }
    if (ticket.unitId?.trim()) {
      const unitBuilding = ctx.unitIdBuildingMap.get(ticket.unitId.trim())
      if (unitBuilding === key) return true
    }
    return ticketBuilding(ticket, ctx, emailBuildingMap) === key
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
    if (!residentBuilding) return true

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

function filterPmForScope(
  tasks: PropertyHealthPmTask[],
  building: string,
  property: PropertyHealthCanonicalProperty | null,
  units: PropertyHealthUnit[],
): PropertyHealthPmTask[] {
  const aliases = buildingScopeAliasKeys(building, property, units)
  return tasks.filter((task) => aliases.has(normalizeBuildingKey(task.building)))
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

function filterInspectionsForScope(
  inspections: PropertyHealthInspection[],
  building: string,
  property: PropertyHealthCanonicalProperty | null,
  units: PropertyHealthUnit[],
): PropertyHealthInspection[] {
  const aliases = buildingScopeAliasKeys(building, property, units)
  return inspections.filter((row) => {
    if (property?.id && row.propertyId && row.propertyId === property.id) return true
    return aliases.has(normalizeBuildingKey(row.building))
  })
}

function filterTicketsForScope(
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
    if (f.unit) {
      const mapped = ctx.uniqueUnitLabelBuildingMap.get(normalizeUnitLabel(f.unit))
      return mapped != null && aliases.has(mapped)
    }
    return aliases.has('Portfolio')
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

function categoryDetail(
  result: ReturnType<typeof calculatePropertyHealth>,
  key: PropertyHealthComponentKey,
): { score: number; isFallback: boolean; detail: string } {
  const category = result[key]
  const notes = category.factors
    .filter((factor) => factor.status === 'known' && factor.explanation)
    .map((factor) => factor.explanation!)
  if (category.score == null) {
    return { score: 0, isFallback: true, detail: 'Not enough information yet' }
  }
  return {
    score: category.score,
    isFallback: false,
    detail: notes.length ? notes.slice(0, 2).join(' · ') : 'No deductions',
  }
}

function componentsFromHealthResult(
  result: ReturnType<typeof calculatePropertyHealth>,
): PropertyHealthComponent[] {
  return (Object.keys(PROPERTY_HEALTH_WEIGHTS) as PropertyHealthComponentKey[]).map((key) => {
    const mapped = categoryDetail(result, key)
    return {
      key,
      label: COMPONENT_LABELS[key],
      score: mapped.score,
      weight: PROPERTY_HEALTH_WEIGHTS[key],
      isFallback: mapped.isFallback,
      detail: mapped.detail,
    }
  })
}

function occupyingResidentsForHealthScope(
  residents: PropertyHealthResident[],
  scopedUnits: PropertyHealthUnit[],
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
  const now = inputs.now ?? Date.now()
  const repeatWindowMs =
    inputs.repeatWindowMs ?? REPEAT_ISSUE_WINDOW_DAYS * 24 * 60 * 60 * 1000
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
  const scopedPm =
    scopeBuilding != null
      ? filterPmForScope(inputs.pmTasks, scopeBuilding, scopeProperty, inputs.units)
      : inputs.pmTasks
  const scopedAssets =
    scopeBuilding != null
      ? filterAssetsForScope(inputs.assets ?? [], scopeBuilding, scopeProperty, inputs.units)
      : (inputs.assets ?? [])
  const scopedInspections =
    scopeBuilding != null
      ? filterInspectionsForScope(
          inputs.inspections ?? [],
          scopeBuilding,
          scopeProperty,
          inputs.units,
        )
      : (inputs.inspections ?? [])

  const scopedTicketIds = new Set(scopedTickets.map((ticket) => ticket.id))
  const scopedDamage =
    scopeBuilding != null
      ? (inputs.damageReports ?? []).filter((row) => {
          const id = row.maintenanceRequestId?.trim()
          if (!id) return false
          return scopedTicketIds.has(id)
        })
      : (inputs.damageReports ?? [])

  const result = calculatePropertyHealth({
    trackedUnits: trackedUnits.map((unit) => ({
      unitLabel: unit.unitLabel,
      status: unit.status,
    })),
    tickets: scopedTickets,
    pmTasks: scopedPm,
    assets: scopedAssets,
    inspections: scopedInspections,
    damageReports: scopedDamage,
    now,
    repeatWindowMs,
    openIssuesCreatedBeforeMs: inputs.openIssuesCreatedBeforeMs,
  })

  const components = componentsFromHealthResult(result)
  const score = result.score ?? 0
  const pendingReason: PropertyHealthPendingReason | null = null

  return {
    score,
    status: propertyHealthStatus(score),
    rating: result.rating,
    components,
    trackedUnitCount: trackedUnits.length,
    pendingReason,
    dataCompleteness: result.dataCompleteness,
    topIssues: result.topIssues.map((issue) => issue.explanation),
  }
}

export function buildPropertyHealthReport(
  inputs: PropertyHealthInputs,
  landlordId: string = getActiveLandlordId(),
): PropertyHealthReport {
  const now = inputs.now ?? Date.now()
  const ticketBuildingCtx = buildTicketBuildingContext(inputs.units)

  const portfolio = computePropertyHealthScope(inputs)
  const portfolioDelta = (() => {
    if (!portfolio || portfolio.trackedUnitCount === 0) return null
    const previous = computePropertyHealthScope({
      ...inputs,
      now: now - FOUR_WEEKS_MS,
      repeatWindowMs: REPEAT_ISSUE_WINDOW_DAYS * 24 * 60 * 60 * 1000,
      openIssuesCreatedBeforeMs: now - FOUR_WEEKS_MS,
    })
    return previous ? portfolio.score - previous.score : null
  })()

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
      building,
      unitCount: buildingUnits.length,
      openTickets: scopedOpenTickets.length,
      occupancyPct: occupancy.occupancyPct,
      residentRating,
      feedbackCount: ratings.length,
      ...scopeScore,
    })
  }

  buildings.sort((a, b) => a.score - b.score)
  return { portfolio, portfolioDelta, buildings }
}

export function formatPropertyHealthTooltip(components: PropertyHealthComponent[]): string {
  return components
    .map((c) => {
      const pct = Math.round(c.weight * 100)
      const suffix = c.isFallback ? ' (unknown)' : ''
      return `${c.label} ${pct}%: ${c.isFallback ? '—' : c.score}${suffix} — ${c.detail}`
    })
    .join('\n')
}

const CATEGORY_ORDER: PropertyHealthComponentKey[] = ['condition', 'maintenance', 'risk']

/** KPI popover rows for Condition / Maintenance / Risk. */
export function propertyHealthFactorBreakdownLines(
  components: PropertyHealthComponent[],
  extras?: { dataCompleteness?: number; topIssues?: string[] },
): Array<{ label: string; value: string; detail: string }> {
  const byKey = new Map(components.map((component) => [component.key, component]))
  const lines = CATEGORY_ORDER.map((key) => {
    const component = byKey.get(key)
    if (!component) {
      return { label: `${COMPONENT_LABELS[key]} (${Math.round(PROPERTY_HEALTH_WEIGHTS[key] * 100)}%)`, value: '—', detail: '' }
    }
    const weightPct = Math.round(component.weight * 100)
    return {
      label: `${component.label} (${weightPct}%)`,
      value: component.isFallback ? 'Unknown' : String(component.score),
      detail: component.detail,
    }
  })
  for (const issue of extras?.topIssues ?? []) {
    lines.push({ label: 'Needs attention', value: '', detail: issue })
  }
  if (extras?.dataCompleteness != null) {
    lines.push({
      label: 'Data completeness',
      value: `${Math.round(extras.dataCompleteness * 100)}%`,
      detail: 'Missing items are unknown, not scored as poor.',
    })
  }
  return lines
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
    email: asString(raw.email) || null,
    issueCategory: asString(raw.issue_category ?? raw.issueCategory) || null,
    vendorWorkStatus: asString(raw.vendor_work_status ?? raw.vendorWorkStatus).toLowerCase(),
    assignedVendorId: asString(raw.assigned_vendor_id ?? raw.assignedVendorId) || null,
    description: asString(raw.description) || null,
    urgency: asString(raw.urgency) || null,
    severity: asString(raw.severity) || null,
    priority: asString(raw.priority) || null,
    dueAt: asString(raw.due_at ?? raw.dueAt) || null,
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

/** Fetch PM, assets, inspections, and damage reports for property health. */
export async function fetchPropertyHealthSignals(): Promise<{
  pmTasks: PropertyHealthPmTask[]
  feedback: PropertyHealthFeedback[]
  vendorMetrics: PropertyHealthVendorMetrics[]
  assets: PropertyHealthAsset[]
  inspections: PropertyHealthInspection[]
  damageReports: PropertyHealthDamageReport[]
}> {
  const empty = {
    pmTasks: [] as PropertyHealthPmTask[],
    feedback: [] as PropertyHealthFeedback[],
    vendorMetrics: [] as PropertyHealthVendorMetrics[],
    assets: [] as PropertyHealthAsset[],
    inspections: [] as PropertyHealthInspection[],
    damageReports: [] as PropertyHealthDamageReport[],
  }
  const { supabase } = await import('@/lib/supabase')
  if (!supabase) return empty

  const landlordId = getActiveLandlordId()

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

  return { pmTasks, feedback, vendorMetrics, assets, inspections, damageReports }
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
