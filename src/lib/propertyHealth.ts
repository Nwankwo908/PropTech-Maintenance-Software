/**
 * Unified Property Health — single product metric for portfolio and per-building views.
 *
 * Score (0–100) = weighted sum of six operational signals:
 *   40% open maintenance issues
 *   20% PM compliance
 *   15% vacancy / occupancy
 *   10% resident satisfaction (vendor_feedback ratings when present)
 *   10% repeat issue risk
 *    5% vendor performance
 *
 * Missing signals use PROPERTY_HEALTH_NEUTRAL_SCORE (50) — neither rewards nor
 * penalizes until real data exists. Resident satisfaction never uses derived proxies.
 *
 * Property activation (Active vs Pending setup) is separate from health scoring.
 * A property is Active once units are tracked. 30 days of ops history or a
 * completed PM task only unlocks the numeric health score / insights — they
 * do not keep a set-up property in Pending setup.
 */
import { getActiveLandlordId } from '@/lib/activeLandlord'

/** Neither penalize nor reward when a signal has no underlying data yet. */
export const PROPERTY_HEALTH_NEUTRAL_SCORE = 50

/** Days of ops history required before showing a numeric health score / insights. */
export const PROPERTY_HEALTH_OPS_MATURITY_DAYS = 30

export const PROPERTY_HEALTH_INSIGHTS_CAPTION =
  'More activity needed for full insights'

export const PROPERTY_HEALTH_WEIGHTS = {
  openMaintenance: 0.4,
  pmCompliance: 0.2,
  vacancy: 0.15,
  residentSatisfaction: 0.1,
  repeatIssueRisk: 0.1,
  vendorPerformance: 0.05,
} as const

/** Same unit + category repeated within this window counts as repeat risk. */
export const REPEAT_ISSUE_WINDOW_DAYS = 45

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
  return PROPERTY_HEALTH_KPI_CAPTION
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
  return status === 'healthy' || status === 'monitor' || status === 'at_risk'
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
  | 'healthy'
  | 'monitor'
  | 'at_risk'
  | 'active'
  | 'pending_setup'

export type PropertyHealthComponentKey =
  | 'openMaintenance'
  | 'pmCompliance'
  | 'vacancy'
  | 'residentSatisfaction'
  | 'repeatIssueRisk'
  | 'vendorPerformance'

export type PropertyHealthComponent = {
  key: PropertyHealthComponentKey
  label: string
  score: number
  weight: number
  /** True when PROPERTY_HEALTH_NEUTRAL_SCORE was used (no signal data). */
  isFallback: boolean
  detail: string
}

export type PropertyHealthScopeScore = {
  score: number
  status: PropertyHealthStatus
  components: PropertyHealthComponent[]
  /** Tracked units (status !== inactive) in this scope. */
  trackedUnitCount: number
  pendingReason?: PropertyHealthPendingReason | null
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
  issueCategory: string | null
  vendorWorkStatus: string
  assignedVendorId: string | null
  email?: string | null
}

export type PropertyHealthPmTask = {
  building: string | null
  unitLabel: string | null
  taskStatus: string
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
  openMaintenance: 'Open maintenance',
  pmCompliance: 'PM compliance',
  vacancy: 'Occupancy',
  residentSatisfaction: 'Resident satisfaction',
  repeatIssueRisk: 'Repeat issue risk',
  vendorPerformance: 'Vendor performance',
}

function buildNeutralComponents(): PropertyHealthComponent[] {
  const details: Record<PropertyHealthComponentKey, string> = {
    openMaintenance: 'No active units to measure',
    pmCompliance: 'No preventive tasks on record yet',
    vacancy: 'No active units to measure',
    residentSatisfaction: 'No resident feedback yet — neutral default',
    repeatIssueRisk: 'No active units to measure',
    vendorPerformance: 'No vendor assignments yet — neutral default',
  }
  return (Object.keys(PROPERTY_HEALTH_WEIGHTS) as PropertyHealthComponentKey[]).map(
    (key) => ({
      key,
      label: COMPONENT_LABELS[key],
      score: PROPERTY_HEALTH_NEUTRAL_SCORE,
      weight: PROPERTY_HEALTH_WEIGHTS[key],
      isFallback: true,
      detail: details[key],
    }),
  )
}

function buildNeutralScopeScore(): PropertyHealthScopeScore {
  const components = buildNeutralComponents()
  const score = aggregateWeightedScore(components)
  return {
    score,
    status: resolvePropertyHealthStatus(score, components),
    components,
    trackedUnitCount: 0,
    pendingReason: 'inactive_units',
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
  landlordId: string = getActiveLandlordId(),
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
  if (score >= 85) return 'healthy'
  if (score >= 70) return 'monitor'
  return 'at_risk'
}

export function resolvePropertyHealthStatus(
  score: number,
  components: PropertyHealthComponent[],
  options?: { insufficientOperationalSignal?: boolean },
): PropertyHealthStatus {
  if (isPendingSetupHealth(components)) return 'pending_setup'
  if (options?.insufficientOperationalSignal) return 'active'
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

function isTicketOpen(ticket: PropertyHealthTicket): boolean {
  return !CLOSED_WORK_STATUSES.has(ticket.vendorWorkStatus.toLowerCase())
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)))
}

function responseTimeToScore(minutes: number | null): number {
  if (minutes == null || !Number.isFinite(minutes)) return PROPERTY_HEALTH_NEUTRAL_SCORE
  if (minutes <= 15) return 100
  if (minutes <= 60) return 85
  if (minutes <= 240) return 65
  if (minutes <= 1440) return 40
  return 20
}

function ratingToScore(rating: number): number {
  return clampScore((rating / 5) * 100)
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
    if (aliases.has(normalizeBuildingKey(resident.building))) return true

    const unitKey = normalizeUnitLabel(resident.unit)
    if (!unitKey) return false

    const matchingUnits = scopedUnits.filter(
      (unit) => normalizeUnitLabel(unit.unitLabel) === unitKey,
    )
    if (matchingUnits.length === 0) return false

    const residentBuilding = resident.building?.trim()
    if (!residentBuilding) return true

    const residentBuildingKey = normalizeBuildingKey(residentBuilding)
    if (aliases.has(residentBuildingKey)) return true
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

function filterResidentsForScope(
  residents: PropertyHealthResident[],
  building: string,
  property: PropertyHealthCanonicalProperty | null,
  units: PropertyHealthUnit[],
): PropertyHealthResident[] {
  return filterResidentsForPropertyScope(residents, building, property, units)
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

function scoreOpenMaintenance(
  trackedUnits: PropertyHealthUnit[],
  openTickets: PropertyHealthTicket[],
  openIssuesCreatedBeforeMs?: number,
): PropertyHealthComponent {
  if (trackedUnits.length === 0) {
    return {
      key: 'openMaintenance',
      label: COMPONENT_LABELS.openMaintenance,
      score: PROPERTY_HEALTH_NEUTRAL_SCORE,
      weight: PROPERTY_HEALTH_WEIGHTS.openMaintenance,
      isFallback: true,
      detail: 'No active units to measure',
    }
  }

  const unitLabels = new Set(
    trackedUnits.map((u) => normalizeUnitLabel(u.unitLabel)).filter(Boolean),
  )
  const qualifyingOpen = openIssuesCreatedBeforeMs
    ? openTickets.filter((t) => {
        const ts = new Date(t.createdAt).getTime()
        return !Number.isNaN(ts) && ts < openIssuesCreatedBeforeMs
      })
    : openTickets

  const unitsWithOpen = new Set<string>()
  for (const ticket of qualifyingOpen) {
    const key = normalizeUnitLabel(ticket.unit)
    if (key && unitLabels.has(key)) unitsWithOpen.add(key)
  }

  const openRate = unitsWithOpen.size / trackedUnits.length
  const score = clampScore(100 * (1 - openRate))
  return {
    key: 'openMaintenance',
    label: COMPONENT_LABELS.openMaintenance,
    score,
    weight: PROPERTY_HEALTH_WEIGHTS.openMaintenance,
    isFallback: false,
    detail: `${unitsWithOpen.size} of ${trackedUnits.length} units with open requests`,
  }
}

function scorePmCompliance(tasks: PropertyHealthPmTask[]): PropertyHealthComponent {
  if (tasks.length === 0) {
    return {
      key: 'pmCompliance',
      label: COMPONENT_LABELS.pmCompliance,
      score: PROPERTY_HEALTH_NEUTRAL_SCORE,
      weight: PROPERTY_HEALTH_WEIGHTS.pmCompliance,
      isFallback: true,
      detail: 'No preventive tasks on record yet',
    }
  }
  const completed = tasks.filter((t) => t.taskStatus === 'completed').length
  const score = clampScore((completed / tasks.length) * 100)
  return {
    key: 'pmCompliance',
    label: COMPONENT_LABELS.pmCompliance,
    score,
    weight: PROPERTY_HEALTH_WEIGHTS.pmCompliance,
    isFallback: false,
    detail: `${completed} of ${tasks.length} PM tasks complete`,
  }
}

function scoreVacancy(
  trackedUnits: PropertyHealthUnit[],
  residents: PropertyHealthResident[],
  building?: string,
): PropertyHealthComponent {
  if (trackedUnits.length === 0) {
    return {
      key: 'vacancy',
      label: COMPONENT_LABELS.vacancy,
      score: PROPERTY_HEALTH_NEUTRAL_SCORE,
      weight: PROPERTY_HEALTH_WEIGHTS.vacancy,
      isFallback: true,
      detail: 'No active units to measure',
    }
  }
  const occupied = countOccupiedUnits(trackedUnits, residents, building)
  const score = clampScore((occupied / trackedUnits.length) * 100)
  return {
    key: 'vacancy',
    label: COMPONENT_LABELS.vacancy,
    score,
    weight: PROPERTY_HEALTH_WEIGHTS.vacancy,
    isFallback: false,
    detail: `${occupied} of ${trackedUnits.length} units occupied`,
  }
}

function scoreResidentSatisfaction(feedback: PropertyHealthFeedback[]): PropertyHealthComponent {
  const ratings = feedback
    .map((f) => f.rating)
    .filter((r) => Number.isFinite(r) && r >= 1 && r <= 5)
  if (ratings.length === 0) {
    return {
      key: 'residentSatisfaction',
      label: COMPONENT_LABELS.residentSatisfaction,
      score: PROPERTY_HEALTH_NEUTRAL_SCORE,
      weight: PROPERTY_HEALTH_WEIGHTS.residentSatisfaction,
      isFallback: true,
      detail: 'No resident feedback yet — neutral default',
    }
  }
  const avg = ratings.reduce((sum, r) => sum + r, 0) / ratings.length
  return {
    key: 'residentSatisfaction',
    label: COMPONENT_LABELS.residentSatisfaction,
    score: ratingToScore(avg),
    weight: PROPERTY_HEALTH_WEIGHTS.residentSatisfaction,
    isFallback: false,
    detail: `${ratings.length} rating${ratings.length === 1 ? '' : 's'} · avg ${avg.toFixed(1)}/5`,
  }
}

function scoreRepeatIssueRisk(
  trackedUnits: PropertyHealthUnit[],
  tickets: PropertyHealthTicket[],
  now: number,
  repeatWindowMs: number,
): PropertyHealthComponent {
  if (trackedUnits.length === 0) {
    return {
      key: 'repeatIssueRisk',
      label: COMPONENT_LABELS.repeatIssueRisk,
      score: PROPERTY_HEALTH_NEUTRAL_SCORE,
      weight: PROPERTY_HEALTH_WEIGHTS.repeatIssueRisk,
      isFallback: true,
      detail: 'No active units to measure',
    }
  }

  const windowStart = now - repeatWindowMs
  const unitLabels = new Set(
    trackedUnits.map((u) => normalizeUnitLabel(u.unitLabel)).filter(Boolean),
  )
  const countsByUnitCategory = new Map<string, number>()

  for (const ticket of tickets) {
    if (isVoidedWorkOrder(ticket)) continue
    const unitKey = normalizeUnitLabel(ticket.unit)
    if (!unitKey || !unitLabels.has(unitKey)) continue
    const ts = new Date(ticket.createdAt).getTime()
    if (Number.isNaN(ts) || ts < windowStart || ts > now) continue
    const category = (ticket.issueCategory ?? 'general').toLowerCase()
    const key = `${unitKey}|${category}`
    countsByUnitCategory.set(key, (countsByUnitCategory.get(key) ?? 0) + 1)
  }

  const unitsWithRepeat = new Set<string>()
  for (const [key, count] of countsByUnitCategory) {
    if (count >= 2) unitsWithRepeat.add(key.split('|')[0]!)
  }

  const repeatRate = unitsWithRepeat.size / trackedUnits.length
  const score = clampScore(100 * (1 - repeatRate))
  return {
    key: 'repeatIssueRisk',
    label: COMPONENT_LABELS.repeatIssueRisk,
    score,
    weight: PROPERTY_HEALTH_WEIGHTS.repeatIssueRisk,
    isFallback: false,
    detail: `${unitsWithRepeat.size} unit${unitsWithRepeat.size === 1 ? '' : 's'} with repeat issues (${REPEAT_ISSUE_WINDOW_DAYS}d)`,
  }
}

function scoreVendorPerformance(
  tickets: PropertyHealthTicket[],
  vendorMetrics: PropertyHealthVendorMetrics[],
): PropertyHealthComponent {
  const assigned = tickets.filter((t) => t.assignedVendorId)
  if (assigned.length === 0 && vendorMetrics.length === 0) {
    return {
      key: 'vendorPerformance',
      label: COMPONENT_LABELS.vendorPerformance,
      score: PROPERTY_HEALTH_NEUTRAL_SCORE,
      weight: PROPERTY_HEALTH_WEIGHTS.vendorPerformance,
      isFallback: true,
      detail: 'No vendor assignments yet — neutral default',
    }
  }

  const responseRate =
    assigned.length === 0
      ? null
      : (assigned.filter((t) => t.vendorWorkStatus !== 'pending_accept').length /
          assigned.length) *
        100

  const vendorIdsInScope = new Set(
    assigned.map((t) => t.assignedVendorId).filter(Boolean) as string[],
  )
  const metricsInScope =
    vendorIdsInScope.size > 0
      ? vendorMetrics.filter((m) => vendorIdsInScope.has(m.vendorId))
      : vendorMetrics

  const completionRates = metricsInScope
    .map((m) => m.completionRate)
    .filter((r): r is number => r != null && Number.isFinite(r))
  const avgCompletion =
    completionRates.length > 0
      ? (completionRates.reduce((s, r) => s + r, 0) / completionRates.length) * 100
      : null

  const responseTimes = metricsInScope
    .map((m) => m.avgResponseTime)
    .filter((t): t is number => t != null && Number.isFinite(t))
  const avgResponseTime =
    responseTimes.length > 0
      ? responseTimes.reduce((s, t) => s + t, 0) / responseTimes.length
      : null

  const parts: number[] = []
  const weights: number[] = []
  if (responseRate != null) {
    parts.push(responseRate)
    weights.push(0.4)
  }
  if (avgCompletion != null) {
    parts.push(avgCompletion)
    weights.push(0.35)
  }
  const timeScore = responseTimeToScore(avgResponseTime)
  if (avgResponseTime != null) {
    parts.push(timeScore)
    weights.push(0.25)
  }

  if (parts.length === 0) {
    return {
      key: 'vendorPerformance',
      label: COMPONENT_LABELS.vendorPerformance,
      score: PROPERTY_HEALTH_NEUTRAL_SCORE,
      weight: PROPERTY_HEALTH_WEIGHTS.vendorPerformance,
      isFallback: true,
      detail: 'Insufficient vendor metrics — neutral default',
    }
  }

  const weightSum = weights.reduce((s, w) => s + w, 0)
  const blended = parts.reduce((s, p, i) => s + p * weights[i]!, 0) / weightSum

  return {
    key: 'vendorPerformance',
    label: COMPONENT_LABELS.vendorPerformance,
    score: clampScore(blended),
    weight: PROPERTY_HEALTH_WEIGHTS.vendorPerformance,
    isFallback: false,
    detail: [
      responseRate != null ? `${Math.round(responseRate)}% response` : null,
      avgCompletion != null ? `${Math.round(avgCompletion)}% completion` : null,
      avgResponseTime != null ? `${Math.round(avgResponseTime)}m avg response` : null,
    ]
      .filter(Boolean)
      .join(' · '),
  }
}

function aggregateWeightedScore(components: PropertyHealthComponent[]): number {
  let sum = 0
  for (const c of components) {
    sum += c.score * c.weight
  }
  return clampScore(sum)
}

export function computePropertyHealthScope(
  inputs: PropertyHealthInputs,
  scope: { building?: string; property?: PropertyHealthCanonicalProperty } = {},
): PropertyHealthScopeScore | null {
  const now = inputs.now ?? Date.now()
  const repeatWindowMs =
    inputs.repeatWindowMs ?? REPEAT_ISSUE_WINDOW_DAYS * 24 * 60 * 60 * 1000
  const ticketBuildingCtx = buildTicketBuildingContext(inputs.units)
  const scopeBuilding = scope.building?.trim()
  const scopeProperty = scope.property ?? null

  const scopedUnits =
    scopeBuilding != null
      ? filterUnitsForScope(inputs.units, scopeBuilding, scopeProperty)
      : inputs.units
  const trackedUnits = scopedUnits.filter((u) => u.status !== 'inactive')
  if (trackedUnits.length === 0) {
    if (scopeBuilding == null) return null
    return buildNeutralScopeScore()
  }

  const scopedResidents =
    scopeBuilding != null
      ? filterResidentsForScope(inputs.residents ?? [], scopeBuilding, scopeProperty, inputs.units)
      : (inputs.residents ?? [])

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
  const openTickets = scopedTickets.filter(isTicketOpen)
  const scopedPm =
    scopeBuilding != null
      ? filterPmForScope(inputs.pmTasks, scopeBuilding, scopeProperty, inputs.units)
      : inputs.pmTasks
  const scopedFeedback =
    scopeBuilding != null
      ? filterFeedbackForScope(
          inputs.feedback,
          scopeBuilding,
          ticketBuildingCtx,
          scopeProperty,
          inputs.units,
        )
      : inputs.feedback

  const components: PropertyHealthComponent[] = [
    scoreOpenMaintenance(trackedUnits, openTickets, inputs.openIssuesCreatedBeforeMs),
    scorePmCompliance(scopedPm),
    scoreVacancy(trackedUnits, scopedResidents, scopeBuilding),
    scoreResidentSatisfaction(scopedFeedback),
    scoreRepeatIssueRisk(trackedUnits, scopedTickets, now, repeatWindowMs),
    scoreVendorPerformance(scopedTickets, inputs.vendorMetrics),
  ]

  const score = aggregateWeightedScore(components)
  const insufficientOperationalSignal = !hasPropertyHealthOperationalSignal(
    trackedUnits,
    scopedPm,
    scopedTickets,
    now,
  )
  const pendingReason: PropertyHealthPendingReason | null = isPendingSetupHealth(components)
    ? 'inactive_units'
    : insufficientOperationalSignal
      ? 'collecting_history'
      : null

  return {
    score,
    status: resolvePropertyHealthStatus(score, components, { insufficientOperationalSignal }),
    components,
    trackedUnitCount: trackedUnits.length,
    pendingReason,
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
      const suffix = c.isFallback ? ' (neutral)' : ''
      return `${c.label} ${pct}%: ${c.score}${suffix} — ${c.detail}`
    })
    .join('\n')
}

/** KPI popover rows for the six weighted health factors (weakest first). */
export function propertyHealthFactorBreakdownLines(
  components: PropertyHealthComponent[],
): Array<{ label: string; value: string; detail: string }> {
  return [...components]
    .sort((a, b) => a.score - b.score || b.weight - a.weight)
    .map((component) => {
      const weightPct = Math.round(component.weight * 100)
      return {
        label: `${component.label} (${weightPct}%)`,
        value: component.isFallback ? `${component.score} · neutral` : String(component.score),
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
    email: asString(raw.email) || null,
    issueCategory: asString(raw.issue_category ?? raw.issueCategory) || null,
    vendorWorkStatus: asString(raw.vendor_work_status ?? raw.vendorWorkStatus).toLowerCase(),
    assignedVendorId: asString(raw.assigned_vendor_id ?? raw.assignedVendorId) || null,
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

/** Fetch PM tasks, resident feedback, and vendor metrics for property health. */
export async function fetchPropertyHealthSignals(): Promise<{
  pmTasks: PropertyHealthPmTask[]
  feedback: PropertyHealthFeedback[]
  vendorMetrics: PropertyHealthVendorMetrics[]
}> {
  const { supabase } = await import('@/lib/supabase')
  if (!supabase) {
    return { pmTasks: [], feedback: [], vendorMetrics: [] }
  }

  const landlordId = getActiveLandlordId()

  const [pmResult, feedbackResult, vendorResult] = await Promise.allSettled([
    supabase
      .from('pm_compliance_dashboard_view')
      .select('building, unit_label, task_status')
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
  ])

  const pmTasks: PropertyHealthPmTask[] =
    pmResult.status === 'fulfilled' && !pmResult.value.error
      ? ((pmResult.value.data ?? []) as Record<string, unknown>[]).map((row) => ({
          building: asString(row.building) || null,
          unitLabel: asString(row.unit_label) || null,
          taskStatus: asString(row.task_status).toLowerCase(),
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

  return { pmTasks, feedback, vendorMetrics }
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
