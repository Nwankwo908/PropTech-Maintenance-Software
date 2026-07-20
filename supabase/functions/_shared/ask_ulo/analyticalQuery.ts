/**
 * Analytical portfolio questions — entity + metric + scope + timeframe + ranking.
 * Prevents “which units generate the most maintenance requests?” from collapsing
 * into a generic open-ticket portfolio total.
 */

export type AnalyticalEntity =
  | "unit"
  | "property"
  | "vendor"
  | "resident"
  | "portfolio"
  | null

export type AnalyticalMetric =
  | "maintenance_request_count"
  | "open_work_orders"
  | "severity_priority"
  | null

export type AnalyticalRanking = "highest" | "lowest" | null

export type AnalyticalScope = "property" | "portfolio" | null

export type AnalyticalQuery = {
  entity: AnalyticalEntity
  metric: AnalyticalMetric
  ranking: AnalyticalRanking
  /** Explicit window from the user question, when present. */
  timeframeDays: number | null
  /** Default used when the user did not state a window (must be disclosed). */
  defaultTimeframeDays: number
  scope: AnalyticalScope
  /** True when this is a unit × maintenance-request volume ranking. */
  isUnitMaintenanceVolumeRanking: boolean
  confidence: "high" | "medium" | "low"
  reason: string
}

const DEFAULT_TIMEFRAME_DAYS = 60

const UNIT_ENTITY_RE =
  /\b(units?|apartments?|suites?|doors?)\b/i

const PROPERTY_ENTITY_RE =
  /\b(propert(?:y|ies)|buildings?|sites?)\b/i

const MAINTENANCE_VOLUME_RE =
  /\b(maintenance(?:\s+(?:requests?|tickets?|issues?|history))?|work\s*orders?|repair\s+requests?|service\s+requests?)\b/i

const OPEN_BACKLOG_RE =
  /\b(open\s+(?:work\s*orders?|tickets?|requests?|maintenance)|how\s+many\s+open|total\s+(?:open\s+)?(?:work\s*orders?|tickets?))\b/i

const HIGHEST_RE =
  /\b(most|highest|top|greatest|generate(?:s|d)?\s+the\s+most|busiest|heaviest)\b/i

const LOWEST_RE =
  /\b(least|lowest|fewest|quietest)\b/i

const TIMEFRAME_RE =
  /\b(?:last|past|previous|in\s+the\s+(?:last|past))\s+(\d+)\s*(day|days|week|weeks|month|months)\b/i

function parseTimeframeDays(question: string): number | null {
  const m = question.match(TIMEFRAME_RE)
  if (!m) return null
  const n = Number(m[1])
  if (!Number.isFinite(n) || n <= 0) return null
  const unit = m[2]!.toLowerCase()
  if (unit.startsWith("day")) return Math.min(365, Math.round(n))
  if (unit.startsWith("week")) return Math.min(365, Math.round(n * 7))
  if (unit.startsWith("month")) return Math.min(730, Math.round(n * 30))
  return null
}

function detectScope(question: string): AnalyticalScope {
  const q = question.toLowerCase()
  if (/\b(this\s+(?:property|building)|at\s+this\s+(?:property|building)|current\s+property)\b/.test(q)) {
    return "property"
  }
  if (/\b(across\s+(?:my\s+)?(?:portfolio|properties|buildings)|portfolio[- ]wide|all\s+(?:my\s+)?(?:properties|buildings|units))\b/.test(q)) {
    return "portfolio"
  }
  return null
}

/**
 * Classify analytical target from the latest user question.
 * Does not invent rankings — callers must verify entity/metric before answering.
 */
export function classifyAnalyticalQuery(question: string): AnalyticalQuery {
  const q = question.trim()
  const empty: AnalyticalQuery = {
    entity: null,
    metric: null,
    ranking: null,
    timeframeDays: null,
    defaultTimeframeDays: DEFAULT_TIMEFRAME_DAYS,
    scope: null,
    isUnitMaintenanceVolumeRanking: false,
    confidence: "low",
    reason: "empty_or_unmatched",
  }
  if (!q) return empty

  const timeframeDays = parseTimeframeDays(q)
  const scope = detectScope(q)

  const mentionsUnit = UNIT_ENTITY_RE.test(q)
  const mentionsProperty = PROPERTY_ENTITY_RE.test(q)
  const mentionsMaintenanceVolume = MAINTENANCE_VOLUME_RE.test(q)
  const mentionsOpenBacklog = OPEN_BACKLOG_RE.test(q)

  let entity: AnalyticalEntity = null
  if (mentionsUnit && !/\bwhich\s+(?:property|building)\b/i.test(q)) {
    entity = "unit"
  } else if (mentionsProperty) {
    entity = "property"
  }

  let metric: AnalyticalMetric = null
  if (mentionsOpenBacklog && !mentionsUnit) {
    metric = "open_work_orders"
  } else if (mentionsMaintenanceVolume) {
    metric = "maintenance_request_count"
  }

  let ranking: AnalyticalRanking = null
  if (HIGHEST_RE.test(q)) ranking = "highest"
  else if (LOWEST_RE.test(q)) ranking = "lowest"
  // "which units generate …" without most/least still implies a ranking ask
  if (
    !ranking &&
    entity === "unit" &&
    metric === "maintenance_request_count" &&
    /\b(which|rank|compare|top)\b/i.test(q)
  ) {
    ranking = "highest"
  }

  const isUnitMaintenanceVolumeRanking =
    entity === "unit" &&
    metric === "maintenance_request_count" &&
    (ranking === "highest" || ranking === "lowest" || /\bwhich\b/i.test(q))

  if (isUnitMaintenanceVolumeRanking) {
    return {
      entity: "unit",
      metric: "maintenance_request_count",
      ranking: ranking ?? "highest",
      timeframeDays,
      defaultTimeframeDays: DEFAULT_TIMEFRAME_DAYS,
      scope,
      isUnitMaintenanceVolumeRanking: true,
      confidence: "high",
      reason: "unit_maintenance_request_volume_ranking",
    }
  }

  if (entity || metric || ranking) {
    return {
      entity,
      metric,
      ranking,
      timeframeDays,
      defaultTimeframeDays: DEFAULT_TIMEFRAME_DAYS,
      scope,
      isUnitMaintenanceVolumeRanking: false,
      confidence: entity && metric ? "medium" : "low",
      reason: "partial_analytical_match",
    }
  }

  return empty
}

export function isUnitMaintenanceVolumeQuestion(question: string): boolean {
  return classifyAnalyticalQuery(question).isUnitMaintenanceVolumeRanking
}

/** Effective analysis window in days (user-stated or disclosed default). */
export function effectiveAnalyticalTimeframeDays(query: AnalyticalQuery): number {
  return query.timeframeDays ?? query.defaultTimeframeDays
}
