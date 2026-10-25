/**
 * Freeze and extreme-cold decisions. Pure rules — no network and no model calls.
 * Thresholds are °F. A higher threshold means the alert starts at a warmer temperature.
 */

export const FREEZE_LEVELS = ['freeze_watch', 'hard_freeze', 'extreme_cold'] as const
export type FreezeLevel = (typeof FREEZE_LEVELS)[number]

export const WARM_CLIMATE_STATES = [
  'FL',
  'TX',
  'LA',
  'MS',
  'AL',
  'GA',
  'SC',
  'AZ',
  'CA',
  'HI',
] as const

export const FREEZE_WATCH_F = 32
export const HARD_FREEZE_F = 20
export const HARD_FREEZE_STREAK_F = 28
export const HARD_FREEZE_STREAK_HOURS = 4
export const EXTREME_WIND_CHILL_F = 0
export const WATCH_WINDOW_HOURS = 48
export const FORECAST_WINDOW_HOURS = 72
export const TICKET_FORECAST_HOURS = 24
export const SNAPSHOT_MAX_AGE_MS = 6 * 60 * 60 * 1000
export const PROPERTY_THRESHOLD_RAISE_F = 4

export type HourlyForecastPoint = {
  time: string
  tempF: number
  windChillF: number | null
}

export type NwsAlertFact = {
  event: string
  severity?: string | null
  onset?: string | null
  ends?: string | null
  headline?: string | null
}

export type FreezePropertyFacts = {
  state?: string | null
  yearBuilt?: number | null
  vacant?: boolean
  /** Landlord setting, clamped to ±4°F. Added on top of a property raise. */
  thresholdAdjustF?: number | null
}

const LEVEL_RANK: Record<FreezeLevel, number> = {
  freeze_watch: 1,
  hard_freeze: 2,
  extreme_cold: 3,
}

export function freezeLevelRank(level: FreezeLevel | null | undefined): number {
  if (!level) return 0
  return LEVEL_RANK[level] ?? 0
}

export function weatherCellKey(lat: number, lon: number): string {
  const round = (n: number) => (Math.round(n * 10) / 10).toFixed(1)
  return `${round(lat)},${round(lon)}`
}

export function snapshotIsFresh(fetchedAt: string, now: Date): boolean {
  const at = Date.parse(fetchedAt)
  if (!Number.isFinite(at)) return false
  const age = now.getTime() - at
  return age >= 0 && age <= SNAPSHOT_MAX_AGE_MS
}

export function clampThresholdAdjust(value: number | null | undefined): number {
  if (value == null || !Number.isFinite(value)) return 0
  return Math.max(-4, Math.min(4, Math.round(value)))
}

export function isWarmClimateState(state: string | null | undefined): boolean {
  const code = (state ?? '').trim().toUpperCase()
  return (WARM_CLIMATE_STATES as readonly string[]).includes(code)
}

/** +4°F when the home is in a warm state, has a vacant unit, or was built before 1960. */
export function propertyThresholdAdjustF(facts: FreezePropertyFacts): number {
  const landlord = clampThresholdAdjust(facts.thresholdAdjustF)
  const raised =
    isWarmClimateState(facts.state) ||
    facts.vacant === true ||
    (facts.yearBuilt != null && facts.yearBuilt < 1960)
  return landlord + (raised ? PROPERTY_THRESHOLD_RAISE_F : 0)
}

function hoursFrom(now: Date, hours: number): number {
  return now.getTime() + hours * 60 * 60 * 1000
}

function pointsWithin(points: HourlyForecastPoint[], now: Date, hours: number): HourlyForecastPoint[] {
  const end = hoursFrom(now, hours)
  return points.filter((point) => {
    const at = Date.parse(point.time)
    return Number.isFinite(at) && at >= now.getTime() - 60 * 60 * 1000 && at <= end
  })
}

export function forecastLowF(
  points: HourlyForecastPoint[],
  now: Date,
  hours: number,
): number | null {
  const window = pointsWithin(points, now, hours)
  if (window.length === 0) return null
  return window.reduce((low, point) => Math.min(low, point.tempF), window[0].tempF)
}

export function forecastLowPoint(
  points: HourlyForecastPoint[],
  now: Date,
  hours: number,
): HourlyForecastPoint | null {
  const window = pointsWithin(points, now, hours)
  if (window.length === 0) return null
  return window.reduce((best, point) => (point.tempF < best.tempF ? point : best), window[0])
}

function hasConsecutiveHoursAtOrBelow(
  points: HourlyForecastPoint[],
  now: Date,
  threshold: number,
  hours: number,
): boolean {
  const window = pointsWithin(points, now, FORECAST_WINDOW_HOURS)
    .slice()
    .sort((a, b) => Date.parse(a.time) - Date.parse(b.time))
  let run = 0
  for (const point of window) {
    if (point.tempF <= threshold) {
      run += 1
      if (run >= hours) return true
    } else {
      run = 0
    }
  }
  return false
}

function alertEvent(alert: NwsAlertFact): string {
  return alert.event.trim().toLowerCase()
}

export function nwsAlertLevel(alerts: NwsAlertFact[]): FreezeLevel | null {
  let level: FreezeLevel | null = null
  for (const alert of alerts) {
    const event = alertEvent(alert)
    if (event === 'extreme cold warning' || event === 'wind chill warning') {
      return 'extreme_cold'
    }
    if (event === 'freeze warning' || event === 'hard freeze warning') {
      level = 'hard_freeze'
    }
  }
  return level
}

export function evaluateFreezeLevel(input: {
  hourly: HourlyForecastPoint[]
  alerts?: NwsAlertFact[]
  property: FreezePropertyFacts
  now: Date
}): FreezeLevel | null {
  const adjust = propertyThresholdAdjustF(input.property)
  const watchAt = FREEZE_WATCH_F + adjust
  const hardAt = HARD_FREEZE_F + adjust
  const streakAt = HARD_FREEZE_STREAK_F + adjust
  const windAt = EXTREME_WIND_CHILL_F + adjust
  const alerts = input.alerts ?? []
  const fromAlert = nwsAlertLevel(alerts)

  const next48 = pointsWithin(input.hourly, input.now, WATCH_WINDOW_HOURS)
  const next72 = pointsWithin(input.hourly, input.now, FORECAST_WINDOW_HOURS)
  const low48 = next48.length
    ? next48.reduce((low, point) => Math.min(low, point.tempF), next48[0].tempF)
    : null
  const low72 = next72.length
    ? next72.reduce((low, point) => Math.min(low, point.tempF), next72[0].tempF)
    : null
  const wind = next72.reduce<number | null>((low, point) => {
    if (point.windChillF == null) return low
    return low == null ? point.windChillF : Math.min(low, point.windChillF)
  }, null)

  let fromTemp: FreezeLevel | null = null
  if (wind != null && wind <= windAt) fromTemp = 'extreme_cold'
  else if (
    (low72 != null && low72 <= hardAt) ||
    hasConsecutiveHoursAtOrBelow(input.hourly, input.now, streakAt, HARD_FREEZE_STREAK_HOURS)
  ) {
    fromTemp = 'hard_freeze'
  } else if (low48 != null && low48 <= watchAt) {
    fromTemp = 'freeze_watch'
  }

  if (freezeLevelRank(fromAlert) >= freezeLevelRank(fromTemp)) return fromAlert
  return fromTemp
}

export function nwsRequestDelayMs(
  sentAtMs: number[],
  nowMs: number,
  maxPerSecond = 5,
): number {
  const recent = sentAtMs.filter((at) => nowMs - at < 1000).sort((a, b) => a - b)
  if (recent.length < maxPerSecond) return 0
  return Math.max(0, 1000 - (nowMs - recent[0]))
}

export function shouldRetryNwsStatus(status: number): boolean {
  return status === 429 || status >= 500
}
