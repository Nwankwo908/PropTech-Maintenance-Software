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
 */
import { DEMO_LANDLORD_ID, getActiveLandlordId } from '@/lib/activeLandlord'

/** Neither penalize nor reward when a signal has no underlying data yet. */
export const PROPERTY_HEALTH_NEUTRAL_SCORE = 50

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

/**
 * Canonical property names per landlord. Merged with unit-derived buildings so the
 * Property Health grid count matches the Buildings KPI (e.g. demo portfolio = 6).
 */
export const LANDLORD_REGISTERED_BUILDINGS: Partial<Record<string, readonly string[]>> = {
  [DEMO_LANDLORD_ID]: [
    'Oakwood Apartments',
    'Pine Ridge',
    'Cedar Court',
    'Maple Heights',
    'Birch Tower',
    'Willow Park',
  ],
}

export type PropertyHealthStatus = 'healthy' | 'monitor' | 'at_risk' | 'pending_setup'

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
}

export type PropertyHealthBuildingRow = PropertyHealthScopeScore & {
  building: string
  unitCount: number
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
  }
}

/** All distinct portfolio buildings for a landlord (units + PM + tickets + registry). */
export function collectPortfolioBuildingKeys(
  units: PropertyHealthUnit[],
  pmTasks: PropertyHealthPmTask[],
  tickets: PropertyHealthTicket[],
  landlordId: string = getActiveLandlordId(),
): string[] {
  const unitBuildingMap = buildUnitBuildingMap(units)
  const keys = new Set<string>()

  for (const unit of units) {
    keys.add(normalizeBuildingKey(unit.building))
  }
  for (const task of pmTasks) {
    if (task.building?.trim()) keys.add(normalizeBuildingKey(task.building))
  }
  for (const ticket of tickets) {
    keys.add(ticketBuilding(ticket, unitBuildingMap))
  }
  for (const building of LANDLORD_REGISTERED_BUILDINGS[landlordId] ?? []) {
    keys.add(normalizeBuildingKey(building))
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
): number {
  return collectPortfolioBuildingKeys(units, pmTasks, tickets, landlordId).length
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
): PropertyHealthStatus {
  if (isPendingSetupHealth(components)) return 'pending_setup'
  return propertyHealthStatus(score)
}

export function normalizeUnitLabel(label: string): string {
  return label.toLowerCase().replace(/^unit\s+/, '').trim()
}

export function normalizeBuildingKey(building: string | null | undefined): string {
  const trimmed = building?.trim()
  return trimmed || 'Portfolio'
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

function buildUnitBuildingMap(units: PropertyHealthUnit[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const unit of units) {
    map.set(normalizeUnitLabel(unit.unitLabel), normalizeBuildingKey(unit.building))
  }
  return map
}

function ticketBuilding(
  ticket: PropertyHealthTicket,
  unitBuildingMap: Map<string, string>,
): string {
  if (ticket.building?.trim()) return normalizeBuildingKey(ticket.building)
  const fromUnit = unitBuildingMap.get(normalizeUnitLabel(ticket.unit))
  return fromUnit ?? 'Portfolio'
}

function filterUnitsForBuilding(
  units: PropertyHealthUnit[],
  building: string,
): PropertyHealthUnit[] {
  return units.filter((u) => normalizeBuildingKey(u.building) === building)
}

function filterTicketsForBuilding(
  tickets: PropertyHealthTicket[],
  building: string,
  unitBuildingMap: Map<string, string>,
): PropertyHealthTicket[] {
  return tickets.filter((t) => ticketBuilding(t, unitBuildingMap) === building)
}

function filterPmForBuilding(tasks: PropertyHealthPmTask[], building: string): PropertyHealthPmTask[] {
  return tasks.filter((t) => normalizeBuildingKey(t.building) === building)
}

function filterFeedbackForBuilding(
  feedback: PropertyHealthFeedback[],
  building: string,
  unitBuildingMap: Map<string, string>,
): PropertyHealthFeedback[] {
  return feedback.filter((f) => {
    if (f.building?.trim()) return normalizeBuildingKey(f.building) === building
    if (f.unit) {
      return unitBuildingMap.get(normalizeUnitLabel(f.unit)) === building
    }
    return building === 'Portfolio'
  })
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

function scoreVacancy(trackedUnits: PropertyHealthUnit[]): PropertyHealthComponent {
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
  const occupied = trackedUnits.filter((u) => u.status === 'active').length
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
  scope: { building?: string } = {},
): PropertyHealthScopeScore | null {
  const now = inputs.now ?? Date.now()
  const repeatWindowMs =
    inputs.repeatWindowMs ?? REPEAT_ISSUE_WINDOW_DAYS * 24 * 60 * 60 * 1000
  const unitBuildingMap = buildUnitBuildingMap(inputs.units)

  const scopedUnits = scope.building
    ? filterUnitsForBuilding(inputs.units, scope.building)
    : inputs.units
  const trackedUnits = scopedUnits.filter((u) => u.status !== 'inactive')
  if (trackedUnits.length === 0) {
    if (!scope.building) return null
    return buildNeutralScopeScore()
  }

  const scopedTickets = scope.building
    ? filterTicketsForBuilding(inputs.tickets, scope.building, unitBuildingMap)
    : inputs.tickets
  const openTickets = scopedTickets.filter(isTicketOpen)
  const scopedPm = scope.building
    ? filterPmForBuilding(inputs.pmTasks, scope.building)
    : inputs.pmTasks
  const scopedFeedback = scope.building
    ? filterFeedbackForBuilding(inputs.feedback, scope.building, unitBuildingMap)
    : inputs.feedback

  const components: PropertyHealthComponent[] = [
    scoreOpenMaintenance(trackedUnits, openTickets, inputs.openIssuesCreatedBeforeMs),
    scorePmCompliance(scopedPm),
    scoreVacancy(trackedUnits),
    scoreResidentSatisfaction(scopedFeedback),
    scoreRepeatIssueRisk(trackedUnits, scopedTickets, now, repeatWindowMs),
    scoreVendorPerformance(scopedTickets, inputs.vendorMetrics),
  ]

  const score = aggregateWeightedScore(components)
  return {
    score,
    status: resolvePropertyHealthStatus(score, components),
    components,
    trackedUnitCount: trackedUnits.length,
  }
}

export function buildPropertyHealthReport(
  inputs: PropertyHealthInputs,
  landlordId: string = getActiveLandlordId(),
): PropertyHealthReport {
  const now = inputs.now ?? Date.now()
  const unitBuildingMap = buildUnitBuildingMap(inputs.units)

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

  const buildingKeys = collectPortfolioBuildingKeys(
    inputs.units,
    inputs.pmTasks,
    inputs.tickets,
    landlordId,
  )

  const openTickets = inputs.tickets.filter(isTicketOpen)
  const openByUnit = new Map<string, number>()
  for (const ticket of openTickets) {
    const key = normalizeUnitLabel(ticket.unit)
    if (!key) continue
    openByUnit.set(key, (openByUnit.get(key) ?? 0) + 1)
  }

  const buildings: PropertyHealthBuildingRow[] = []
  for (const building of buildingKeys) {
    const buildingUnits = filterUnitsForBuilding(inputs.units, building)
    const scopeScore =
      buildingUnits.length > 0
        ? computePropertyHealthScope(inputs, { building })
        : buildNeutralScopeScore()

    if (!scopeScore) continue

    const tracked = buildingUnits.filter((u) => u.status !== 'inactive')
    const active = tracked.filter((u) => u.status === 'active').length
    const occupancyPct = tracked.length ? Math.round((active / tracked.length) * 100) : 0

    const openTicketCount = tracked.reduce(
      (sum, u) => sum + (openByUnit.get(normalizeUnitLabel(u.unitLabel)) ?? 0),
      0,
    )

    const scopedFeedback = filterFeedbackForBuilding(
      inputs.feedback,
      building,
      unitBuildingMap,
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
      openTickets: openTicketCount,
      occupancyPct,
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

/** Map dashboard maintenance ticket rows into property-health inputs. */
export function mapTicketsForPropertyHealth(
  rows: Record<string, unknown>[],
): PropertyHealthTicket[] {
  return rows.map((raw) => ({
    id: asString(raw.id),
    createdAt: asString(raw.created_at),
    unit: asString(raw.unit),
    unitId: asString(raw.unit_id) || null,
    building: asString(raw.building) || null,
    issueCategory: asString(raw.issue_category) || null,
    vendorWorkStatus: asString(raw.vendor_work_status).toLowerCase(),
    assignedVendorId: asString(raw.assigned_vendor_id) || null,
  }))
}

export function mapUnitsForPropertyHealth(
  rows: Record<string, unknown>[],
): PropertyHealthUnit[] {
  return rows.map((raw) => ({
    id: asString(raw.id),
    unitLabel: asString(raw.unit_label),
    building: asString(raw.building) || null,
    status: asString(raw.status).toLowerCase(),
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
      .eq('landlord_id', landlordId),
    supabase
      .from('vendor_feedback')
      .select('rating, maintenance_request_id')
      .eq('landlord_id', landlordId),
    supabase
      .from('vendor_operational_metrics')
      .select(
        'vendor_id, accepted_jobs, completed_jobs, completion_rate, avg_response_time',
      )
      .eq('landlord_id', landlordId),
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
