/**
 * Deterministic Property Health engine (0–100).
 * Condition 40% · Maintenance 35% · Risk 25%.
 * Missing factors are unknown — never filled with a placeholder penalty.
 */

export const PROPERTY_HEALTH_CATEGORY_WEIGHTS = {
  condition: 0.4,
  maintenance: 0.35,
  risk: 0.25,
} as const

export type PropertyHealthCategoryId = keyof typeof PROPERTY_HEALTH_CATEGORY_WEIGHTS

export type PropertyHealthRating =
  | 'Excellent'
  | 'Good'
  | 'Fair'
  | 'Needs Attention'
  | 'High Risk'

export const REPEAT_ISSUE_WINDOW_DAYS = 45

const DAMAGE_LOOKBACK_MS = 24 * 30 * 24 * 60 * 60 * 1000
const OPEN_AGE_PENALTY_DAYS = 14
const USEFUL_LIFE_YEARS: Record<MajorSystemId, number> = {
  roof: 25,
  hvac: 15,
  boiler: 15,
  water_heater: 12,
  electrical_panel: 30,
}

const MAJOR_SYSTEM_LABELS: Record<MajorSystemId, string> = {
  roof: 'Roof',
  hvac: 'HVAC',
  boiler: 'Boiler',
  water_heater: 'Water heater',
  electrical_panel: 'Electrical panel',
}

export type MajorSystemId = 'roof' | 'hvac' | 'boiler' | 'water_heater' | 'electrical_panel'

export type PropertyHealthFactor = {
  id: string
  category: PropertyHealthCategoryId
  label: string
  status: 'known' | 'unknown'
  deduction: number
  explanation: string | null
}

export type PropertyHealthCategoryResult = {
  score: number | null
  weight: number
  factors: PropertyHealthFactor[]
}

export type PropertyHealthIssue = {
  category: PropertyHealthCategoryId
  explanation: string
  deduction: number
}

export type CalculatePropertyHealthInput = {
  trackedUnits: Array<{ unitLabel: string; status: string }>
  tickets: CalculatePropertyHealthTicket[]
  pmTasks: Array<{ taskStatus: string; dueAt?: string | null }>
  assets: CalculatePropertyHealthAsset[]
  inspections: CalculatePropertyHealthInspection[]
  damageReports: Array<{ createdAt: string; maintenanceRequestId?: string | null }>
  now?: number
  /** Open tickets created after this time are ignored (4-week delta proxy). */
  openIssuesCreatedBeforeMs?: number
  repeatWindowMs?: number
}

export type CalculatePropertyHealthTicket = {
  id: string
  createdAt: string
  unit: string
  issueCategory: string | null
  vendorWorkStatus: string
  description?: string | null
  urgency?: string | null
  severity?: string | null
  priority?: string | null
  dueAt?: string | null
}

export type CalculatePropertyHealthAsset = {
  applianceType: string
  estimatedAgeYears: number | null
  usefulLifeYears: number | null
  replacementUrgency: string | null
  condition: string | null
  deficiencies?: Array<{ severity?: string | null; description?: string | null }>
}

export type CalculatePropertyHealthInspection = {
  category: string | null
  conditionRating: string | null
  deficiencies?: Array<{ severity?: string | null; description?: string | null }>
}

export type PropertyHealthResult = {
  score: number | null
  rating: PropertyHealthRating | null
  condition: PropertyHealthCategoryResult
  maintenance: PropertyHealthCategoryResult
  risk: PropertyHealthCategoryResult
  dataCompleteness: number
  topIssues: PropertyHealthIssue[]
}

const CLOSED_WORK_STATUSES = new Set(['completed', 'cancelled', 'deleted'])
const VOIDED_WORK_STATUSES = new Set(['cancelled', 'deleted'])

const PLANNED_FACTOR_IDS = [
  'condition.roof',
  'condition.hvac',
  'condition.water_heater',
  'condition.electrical_panel',
  'condition.inspection',
  'condition.smoke_co',
  'maintenance.open',
  'maintenance.overdue',
  'maintenance.pm',
  'maintenance.repeat',
  'maintenance.leaks',
  'risk.vacancy',
  'risk.safety',
  'risk.water_loss',
  'risk.electrical_fire',
  'risk.incidents',
  'risk.smoke_co',
] as const

export function propertyHealthRatingFromScore(score: number): PropertyHealthRating {
  if (score >= 90) return 'Excellent'
  if (score >= 80) return 'Good'
  if (score >= 70) return 'Fair'
  if (score >= 60) return 'Needs Attention'
  return 'High Risk'
}

export function clampHealthScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)))
}

export function normalizeHealthUnitLabel(label: string): string {
  return label
    .toLowerCase()
    .replace(/^(unit|apt|apartment|suite|ste|#)\s*/i, '')
    .replace(/[\s.#-]+/g, '')
    .trim()
}

export function resolveMajorSystemId(raw: string | null | undefined): MajorSystemId | null {
  const text = (raw ?? '').toLowerCase()
  if (!text) return null
  if (text.includes('roof')) return 'roof'
  if (text.includes('electrical') || text.includes('panel') || text.includes('breaker')) {
    return 'electrical_panel'
  }
  if (text.includes('water_heater') || text.includes('water heater') || text.includes('wh ')) {
    return 'water_heater'
  }
  if (text.includes('boiler')) return 'boiler'
  if (
    text.includes('hvac') ||
    text.includes('furnace') ||
    text.includes('heat pump') ||
    text.includes('air condition') ||
    /\bac\b/.test(text)
  ) {
    return 'hvac'
  }
  return null
}

function isTicketOpen(ticket: CalculatePropertyHealthTicket): boolean {
  return !CLOSED_WORK_STATUSES.has(ticket.vendorWorkStatus.toLowerCase())
}

function isVoided(ticket: CalculatePropertyHealthTicket): boolean {
  return VOIDED_WORK_STATUSES.has(ticket.vendorWorkStatus.toLowerCase())
}

function haystack(ticket: CalculatePropertyHealthTicket): string {
  return `${ticket.description ?? ''} ${ticket.issueCategory ?? ''}`.toLowerCase()
}

function isSevereOpen(ticket: CalculatePropertyHealthTicket): boolean {
  const band = `${ticket.urgency ?? ''} ${ticket.severity ?? ''} ${ticket.priority ?? ''}`.toLowerCase()
  return /\b(emergency|urgent|critical|high)\b/.test(band)
}

function looksLikeActiveLeak(ticket: CalculatePropertyHealthTicket): boolean {
  const hay = haystack(ticket)
  if (/\b(flood|flooding|water damage|soaking|active leak|uncontrolled leak)\b/.test(hay)) return true
  if (/\bleak/.test(hay) && !/\b(drip(?:ping)? faucet|minor leak|slow leak)\b/.test(hay)) return true
  return false
}

function looksLikeElectricalOrFireHazard(ticket: CalculatePropertyHealthTicket): boolean {
  const hay = haystack(ticket)
  return (
    /\b(spark|sparks|sparking|burning smell|smoke|gas leak|gas smell|carbon monoxide|co alarm)\b/.test(
      hay,
    ) ||
    (/\belectr/.test(hay) && isSevereOpen(ticket))
  )
}

function parseTime(value: string | null | undefined): number | null {
  if (!value?.trim()) return null
  const ts = new Date(value).getTime()
  return Number.isNaN(ts) ? null : ts
}

function conditionRatingDeduction(rating: string | null | undefined): number {
  const r = (rating ?? '').toLowerCase()
  if (r === 'unsafe') return 40
  if (r === 'poor') return 25
  if (r === 'fair') return 10
  return 0
}

function systemAgeDeduction(ageYears: number, usefulLife: number): number {
  if (!(usefulLife > 0) || !(ageYears >= 0)) return 0
  const ratio = ageYears / usefulLife
  if (ratio > 1) return 30
  if (ratio >= 0.7) return 15
  return 0
}

function maxDeduction(values: number[]): number {
  return values.reduce((max, value) => Math.max(max, value), 0)
}

function scoreCondition(input: CalculatePropertyHealthInput): PropertyHealthCategoryResult {
  const factors: PropertyHealthFactor[] = []
  const systems = new Map<MajorSystemId, number[]>()

  const addSystemDeduction = (id: MajorSystemId, amount: number) => {
    if (amount <= 0) return
    const list = systems.get(id) ?? []
    list.push(amount)
    systems.set(id, list)
  }

  let inspectionKnown = false
  let inspectionDeduction = 0

  for (const asset of input.assets) {
    const system = resolveMajorSystemId(asset.applianceType)
    if (!system) continue

    const useful =
      asset.usefulLifeYears != null && asset.usefulLifeYears > 0
        ? asset.usefulLifeYears
        : USEFUL_LIFE_YEARS[system]
    const parts: number[] = []
    if (asset.estimatedAgeYears != null && Number.isFinite(asset.estimatedAgeYears)) {
      parts.push(systemAgeDeduction(asset.estimatedAgeYears, useful))
    }
    parts.push(conditionRatingDeduction(asset.condition))
    if ((asset.replacementUrgency ?? '').toLowerCase() === 'immediate') parts.push(20)
    const hasSafety = (asset.deficiencies ?? []).some(
      (row) => (row.severity ?? '').toLowerCase() === 'safety_hazard',
    )
    if (hasSafety) parts.push(40)

    const known =
      asset.estimatedAgeYears != null ||
      Boolean(asset.condition?.trim()) ||
      Boolean(asset.replacementUrgency?.trim()) ||
      (asset.deficiencies ?? []).length > 0
    if (!known) continue
    addSystemDeduction(system, Math.min(40, parts.reduce((sum, n) => sum + n, 0)))
  }

  for (const photo of input.inspections) {
    const ratingDeduction = conditionRatingDeduction(photo.conditionRating)
    const safety = (photo.deficiencies ?? []).some(
      (row) => (row.severity ?? '').toLowerCase() === 'safety_hazard',
    )
    const system = resolveMajorSystemId(photo.category)
    if (system) {
      const extra = Math.min(40, ratingDeduction + (safety ? 40 : 0))
      if (photo.conditionRating || safety) addSystemDeduction(system, extra)
      continue
    }
    if (photo.conditionRating || safety) {
      inspectionKnown = true
      inspectionDeduction = Math.max(
        inspectionDeduction,
        Math.min(40, ratingDeduction + (safety ? 40 : 0)),
      )
    }
  }

  const scoredSystems: MajorSystemId[] = []
  for (const id of Object.keys(MAJOR_SYSTEM_LABELS) as MajorSystemId[]) {
    const deductions = systems.get(id)
    if (!deductions?.length) {
      factors.push({
        id: `condition.${id}`,
        category: 'condition',
        label: MAJOR_SYSTEM_LABELS[id],
        status: 'unknown',
        deduction: 0,
        explanation: null,
      })
      continue
    }
    scoredSystems.push(id)
    const deduction = Math.min(40, maxDeduction(deductions))
    const explanation =
      deduction >= 30
        ? `${MAJOR_SYSTEM_LABELS[id]} is past or well beyond expected useful life, or was flagged unsafe`
        : deduction >= 15
          ? `${MAJOR_SYSTEM_LABELS[id]} is approaching expected replacement age`
          : deduction > 0
            ? `${MAJOR_SYSTEM_LABELS[id]} condition needs attention`
            : null
    factors.push({
      id: `condition.${id}`,
      category: 'condition',
      label: MAJOR_SYSTEM_LABELS[id],
      status: 'known',
      deduction,
      explanation,
    })
  }

  if (inspectionKnown) {
    factors.push({
      id: 'condition.inspection',
      category: 'condition',
      label: 'Overall property condition',
      status: 'known',
      deduction: inspectionDeduction,
      explanation:
        inspectionDeduction > 0 ? 'Inspection noted poor or unsafe property condition' : null,
    })
  } else {
    factors.push({
      id: 'condition.inspection',
      category: 'condition',
      label: 'Overall property condition',
      status: 'unknown',
      deduction: 0,
      explanation: null,
    })
  }

  factors.push({
    id: 'condition.smoke_co',
    category: 'condition',
    label: 'Smoke / CO detectors',
    status: 'unknown',
    deduction: 0,
    explanation: null,
  })

  const knownScores: number[] = []
  for (const id of scoredSystems) {
    const factor = factors.find((row) => row.id === `condition.${id}`)
    if (factor) knownScores.push(100 - factor.deduction)
  }
  if (inspectionKnown) knownScores.push(100 - inspectionDeduction)

  return {
    score: knownScores.length ? clampHealthScore(knownScores.reduce((a, b) => a + b, 0) / knownScores.length) : null,
    weight: PROPERTY_HEALTH_CATEGORY_WEIGHTS.condition,
    factors,
  }
}

function scoreMaintenance(
  input: CalculatePropertyHealthInput,
  now: number,
  repeatWindowMs: number,
): PropertyHealthCategoryResult {
  const factors: PropertyHealthFactor[] = []
  const createdCutoff = input.openIssuesCreatedBeforeMs
  const openTickets = input.tickets.filter((ticket) => {
    if (!isTicketOpen(ticket) || isVoided(ticket)) return false
    if (createdCutoff == null) return true
    const ts = parseTime(ticket.createdAt)
    return ts != null && ts < createdCutoff
  })

  let routine = 0
  let severe = 0
  let leakCount = 0
  let overdueCount = 0
  let longRunning = 0

  for (const ticket of openTickets) {
    const leak = looksLikeActiveLeak(ticket)
    if (leak) leakCount += 1
    else if (isSevereOpen(ticket)) severe += 1
    else routine += 1

    const due = parseTime(ticket.dueAt ?? null)
    if (due != null && due < now) overdueCount += 1

    const created = parseTime(ticket.createdAt)
    if (created != null && now - created >= OPEN_AGE_PENALTY_DAYS * 24 * 60 * 60 * 1000) {
      longRunning += 1
    }
  }

  const openCapped = Math.min(56, Math.min(20, routine * 4) + Math.min(40, severe * 8))
  const openExplanationParts: string[] = []
  if (severe > 0) openExplanationParts.push(`${severe} urgent or critical open request${severe === 1 ? '' : 's'}`)
  if (routine > 0) openExplanationParts.push(`${routine} open maintenance request${routine === 1 ? '' : 's'}`)
  if (longRunning > 0) {
    openExplanationParts.push(`${longRunning} open longer than ${OPEN_AGE_PENALTY_DAYS} days`)
  }

  factors.push({
    id: 'maintenance.open',
    category: 'maintenance',
    label: 'Open work orders',
    status: 'known',
    deduction: Math.min(56, openCapped + Math.min(12, longRunning * 4)),
    explanation: openExplanationParts[0]
      ? openExplanationParts.join('; ')
      : null,
  })

  const overdueDeduction = Math.min(18, overdueCount * 6)
  factors.push({
    id: 'maintenance.overdue',
    category: 'maintenance',
    label: 'Overdue repairs',
    status: 'known',
    deduction: overdueDeduction,
    explanation:
      overdueCount > 0
        ? `${overdueCount} repair${overdueCount === 1 ? '' : 's'} past the response window`
        : null,
  })

  const overduePm = input.pmTasks.filter((task) => {
    const status = task.taskStatus.toLowerCase()
    if (status === 'completed' || status === 'cancelled') return false
    const due = parseTime(task.dueAt ?? null)
    return due != null && due < now
  }).length
  const pmDeduction = Math.min(15, overduePm * 5)
  factors.push({
    id: 'maintenance.pm',
    category: 'maintenance',
    label: 'Preventive maintenance',
    status: 'known',
    deduction: pmDeduction,
    explanation:
      overduePm > 0
        ? `${overduePm} preventive task${overduePm === 1 ? '' : 's'} overdue`
        : null,
  })

  const windowStart = now - repeatWindowMs
  const counts = new Map<string, { total: number; open: number }>()
  for (const ticket of input.tickets) {
    if (isVoided(ticket)) continue
    const ts = parseTime(ticket.createdAt)
    if (ts == null || ts < windowStart || ts > now) continue
    const unitKey = normalizeHealthUnitLabel(ticket.unit)
    if (!unitKey) continue
    const category = (ticket.issueCategory ?? 'general').toLowerCase()
    const key = `${unitKey}|${category}`
    const entry = counts.get(key) ?? { total: 0, open: 0 }
    entry.total += 1
    if (isTicketOpen(ticket)) entry.open += 1
    counts.set(key, entry)
  }
  let repeatGroups = 0
  for (const entry of counts.values()) {
    if (entry.total >= 2 && entry.open > 0) repeatGroups += 1
  }
  const repeatDeduction = repeatGroups > 0 ? 10 : 0
  factors.push({
    id: 'maintenance.repeat',
    category: 'maintenance',
    label: 'Repeat issues',
    status: 'known',
    deduction: repeatDeduction,
    explanation:
      repeatGroups > 0
        ? `${repeatGroups} recurring issue${repeatGroups === 1 ? '' : 's'} still open`
        : null,
  })

  const leakDeduction = Math.min(14, leakCount * 14)
  factors.push({
    id: 'maintenance.leaks',
    category: 'maintenance',
    label: 'Active leaks',
    status: 'known',
    deduction: leakDeduction > 14 ? 14 : leakDeduction,
    explanation:
      leakCount > 0
        ? `${leakCount} unresolved leak or water-damage request${leakCount === 1 ? '' : 's'}`
        : null,
  })

  const totalDeduction = Math.min(
    100,
    factors.reduce((sum, factor) => sum + factor.deduction, 0),
  )

  return {
    score: clampHealthScore(100 - totalDeduction),
    weight: PROPERTY_HEALTH_CATEGORY_WEIGHTS.maintenance,
    factors,
  }
}

function scoreRisk(
  input: CalculatePropertyHealthInput,
  now: number,
): PropertyHealthCategoryResult {
  const factors: PropertyHealthFactor[] = []
  const createdCutoff = input.openIssuesCreatedBeforeMs
  const openTickets = input.tickets.filter((ticket) => {
    if (!isTicketOpen(ticket) || isVoided(ticket)) return false
    if (createdCutoff == null) return true
    const ts = parseTime(ticket.createdAt)
    return ts != null && ts < createdCutoff
  })

  const vacant = input.trackedUnits.filter((unit) => unit.status.toLowerCase() === 'vacant').length
  const vacancyDeduction = Math.min(12, vacant * 3)
  factors.push({
    id: 'risk.vacancy',
    category: 'risk',
    label: 'Vacancy',
    status: 'known',
    deduction: vacancyDeduction,
    explanation: vacant > 0 ? `${vacant} vacant unit${vacant === 1 ? '' : 's'}` : null,
  })

  let inspectionSafety = 0
  let inspectionSafetyKnown = false
  for (const photo of input.inspections) {
    const hits = (photo.deficiencies ?? []).filter(
      (row) => (row.severity ?? '').toLowerCase() === 'safety_hazard',
    )
    if (photo.conditionRating || (photo.deficiencies ?? []).length > 0) {
      inspectionSafetyKnown = true
    }
    inspectionSafety += hits.length
  }
  for (const asset of input.assets) {
    const hits = (asset.deficiencies ?? []).filter(
      (row) => (row.severity ?? '').toLowerCase() === 'safety_hazard',
    )
    if (hits.length > 0 || asset.condition) inspectionSafetyKnown = true
    inspectionSafety += hits.length
  }
  const safetyDeduction = inspectionSafetyKnown ? Math.min(40, inspectionSafety * 20) : 0
  factors.push({
    id: 'risk.safety',
    category: 'risk',
    label: 'Safety hazards',
    status: inspectionSafetyKnown ? 'known' : 'unknown',
    deduction: safetyDeduction,
    explanation:
      inspectionSafety > 0
        ? `${inspectionSafety} safety hazard${inspectionSafety === 1 ? '' : 's'} flagged on inspection`
        : null,
  })

  const waterLoss = openTickets.filter(looksLikeActiveLeak).length
  factors.push({
    id: 'risk.water_loss',
    category: 'risk',
    label: 'Water-loss risk',
    status: 'known',
    deduction: waterLoss > 0 ? 15 : 0,
    explanation: waterLoss > 0 ? 'Open water-loss or leak risk' : null,
  })

  const electricalFire = openTickets.filter(looksLikeElectricalOrFireHazard).length
  factors.push({
    id: 'risk.electrical_fire',
    category: 'risk',
    label: 'Electrical / fire risk',
    status: 'known',
    deduction: electricalFire > 0 ? 15 : 0,
    explanation: electricalFire > 0 ? 'Open electrical, gas, or fire-related hazard' : null,
  })

  const damageCount = input.damageReports.filter((row) => {
    const ts = parseTime(row.createdAt)
    return ts != null && now - ts <= DAMAGE_LOOKBACK_MS && ts <= now
  }).length
  factors.push({
    id: 'risk.incidents',
    category: 'risk',
    label: 'Property incidents',
    status: 'known',
    deduction: damageCount > 0 ? 10 : 0,
    explanation:
      damageCount > 0 ? 'Significant property-damage incident on record' : null,
  })

  factors.push({
    id: 'risk.smoke_co',
    category: 'risk',
    label: 'Smoke / CO detector status',
    status: 'unknown',
    deduction: 0,
    explanation: null,
  })

  const known = factors.filter((factor) => factor.status === 'known')
  const totalDeduction = Math.min(
    100,
    known.reduce((sum, factor) => sum + factor.deduction, 0),
  )

  return {
    score: known.length ? clampHealthScore(100 - totalDeduction) : null,
    weight: PROPERTY_HEALTH_CATEGORY_WEIGHTS.risk,
    factors,
  }
}

function combineCategoryScores(
  categories: PropertyHealthCategoryResult[],
): number | null {
  const present = categories.filter((category) => category.score != null)
  if (present.length === 0) return null
  const weightSum = present.reduce((sum, category) => sum + category.weight, 0)
  if (weightSum <= 0) return null
  const mixed = present.reduce(
    (sum, category) => sum + (category.score ?? 0) * category.weight,
    0,
  )
  return clampHealthScore(mixed / weightSum)
}

export function calculatePropertyHealth(
  input: CalculatePropertyHealthInput,
): PropertyHealthResult {
  const now = input.now ?? Date.now()
  const repeatWindowMs =
    input.repeatWindowMs ?? REPEAT_ISSUE_WINDOW_DAYS * 24 * 60 * 60 * 1000

  const condition = scoreCondition(input)
  const maintenance =
    input.trackedUnits.length > 0
      ? scoreMaintenance(input, now, repeatWindowMs)
      : {
          score: null as number | null,
          weight: PROPERTY_HEALTH_CATEGORY_WEIGHTS.maintenance,
          factors: [],
        }
  const risk =
    input.trackedUnits.length > 0
      ? scoreRisk(input, now)
      : {
          score: null as number | null,
          weight: PROPERTY_HEALTH_CATEGORY_WEIGHTS.risk,
          factors: [],
        }

  const score = combineCategoryScores([condition, maintenance, risk])
  const knownIds = new Set(
    [...condition.factors, ...maintenance.factors, ...risk.factors]
      .filter((factor) => factor.status === 'known')
      .map((factor) => factor.id),
  )
  const completeness =
    PLANNED_FACTOR_IDS.filter((id) => knownIds.has(id)).length / PLANNED_FACTOR_IDS.length

  const topIssues = [...condition.factors, ...maintenance.factors, ...risk.factors]
    .filter((factor) => factor.status === 'known' && factor.deduction > 0 && factor.explanation)
    .sort((a, b) => b.deduction - a.deduction)
    .slice(0, 4)
    .map((factor) => ({
      category: factor.category,
      explanation: factor.explanation!,
      deduction: factor.deduction,
    }))

  return {
    score,
    rating: score == null ? null : propertyHealthRatingFromScore(score),
    condition,
    maintenance,
    risk,
    dataCompleteness: Math.round(completeness * 100) / 100,
    topIssues,
  }
}
