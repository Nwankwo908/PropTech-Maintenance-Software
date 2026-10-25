/**
 * Freeze-event lifecycle, winterizing, ticket raises, and landlord copy.
 * Decisions stay here so the monitor, tests, and screens share one result.
 */
import { LIMITED_ALPHA_1_LANDLORD_ID } from '../landlordCapabilities.ts'
import {
  descriptionNeedsOutdoorTemp,
  resolveUrgencyPolicy,
  type UrgencyBand,
} from '../maintenance/urgencyPolicy.ts'
import {
  evaluateFreezeLevel,
  forecastLowF,
  forecastLowPoint,
  freezeLevelRank,
  snapshotIsFresh,
  TICKET_FORECAST_HOURS,
  type FreezeLevel,
  type FreezePropertyFacts,
  type HourlyForecastPoint,
  type NwsAlertFact,
} from './freezeRules.ts'

export type WeatherSettings = {
  textEnabled: boolean
  thresholdAdjustF: number
  watchTextEnabled: boolean
}

export const DEFAULT_WEATHER_SETTINGS: WeatherSettings = {
  textEnabled: true,
  thresholdAdjustF: 0,
  watchTextEnabled: false,
}

export type WeatherEventState = {
  id: string
  propertyId: string
  landlordId: string
  level: FreezeLevel
  startsAt: string
  endsAt: string | null
  lowTempF: number | null
  nwsEvent: string | null
  status: 'active' | 'resolved'
  notifiedLevel: FreezeLevel | null
}

export type OpenWeatherTicket = {
  id: string
  propertyId: string
  description: string
  urgency: string | null
}

const URGENCY_RANK: Record<UrgencyBand, number> = {
  low: 1,
  medium: 2,
  emergency: 3,
}

export function urgencyBandFromStored(value: string | null | undefined): UrgencyBand {
  const raw = (value ?? '').trim().toLowerCase()
  if (raw === 'emergency' || raw === 'urgent' || raw === 'critical' || raw === 'high') {
    return 'emergency'
  }
  if (raw === 'low') return 'low'
  return 'medium'
}

const PIPE_RE = /\b(frozen\s+pipe|burst\s+pipe|pipe\s+(?:froze|frozen|burst))\b/i

export function ticketUsesFreezeForecast(text: string): boolean {
  return descriptionNeedsOutdoorTemp(text) || PIPE_RE.test(text)
}

export function raisedTicketUrgency(
  current: UrgencyBand,
  description: string,
  outdoorTempF: number | null,
): { next: UrgencyBand; changed: boolean } {
  if (!ticketUsesFreezeForecast(description) || outdoorTempF == null) {
    return { next: current, changed: false }
  }
  const policy = resolveUrgencyPolicy({ text: description, outdoorTempF })
  if (URGENCY_RANK[policy.band] > URGENCY_RANK[current]) {
    return { next: policy.band, changed: true }
  }
  return { next: current, changed: false }
}

export function ticketRaisedActivityMessage(band: UrgencyBand, lowTempF: number): string {
  return `No-heat ticket raised to ${band}: low of ${Math.round(lowTempF)}°F forecast tonight.`
}

export function colderForecastTemp(
  current: number | null,
  forecastLow: number | null,
): number | null {
  if (forecastLow == null) return current
  if (current == null) return forecastLow
  return Math.min(current, forecastLow)
}

export function formatPropertyNameList(names: string[]): string {
  const clean = names.map((name) => name.trim()).filter(Boolean)
  if (clean.length <= 3) return clean.join(', ')
  return `${clean.slice(0, 3).join(', ')} +${clean.length - 3} more`
}

function weekdayShort(iso: string): string {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return ''
  return at.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'America/New_York' })
}

export function weatherChipLabel(input: {
  sourceOk: boolean
  fetchedAt: string
  hourly: HourlyForecastPoint[]
  now: Date
}): string {
  if (!input.sourceOk || !snapshotIsFresh(input.fetchedAt, input.now)) return 'Weather unavailable'
  const low = forecastLowPoint(input.hourly, input.now, 48)
  if (!low) return 'Weather unavailable'
  const day = weekdayShort(low.time)
  return day ? `Low ${Math.round(low.tempF)}°F ${day}` : `Low ${Math.round(low.tempF)}°F`
}

function plural(count: number, singular: string, pluralLabel: string): string {
  return `${count} ${count === 1 ? singular : pluralLabel}`
}

export function buildFreezeAlertSms(input: {
  level: FreezeLevel
  lowTempF: number
  whenLabel: string
  propertyNames: string[]
  vacantCount: number
  unwinterizedCount: number
  link: string
}): string {
  const title =
    input.level === 'extreme_cold'
      ? 'Extreme cold'
      : input.level === 'hard_freeze'
        ? 'Hard freeze'
        : 'Freeze watch'
  const names = formatPropertyNameList(input.propertyNames)
  const count = input.propertyNames.length
  return [
    `Ulo: ${title} ${input.whenLabel}: ${Math.round(input.lowTempF)}°F at ${count} ${count === 1 ? 'property' : 'properties'} (${names}).`,
    `${plural(input.vacantCount, 'vacant unit', 'vacant units')}, ${plural(input.unwinterizedCount, 'not winterized', 'not winterized')}.`,
    `Open the app for the checklist: ${input.link}`,
  ].join(' ')
}

export function buildWinterizingSms(input: {
  frostLabel: string
  nearName: string
  propertyCount: number
  link: string
}): string {
  const count = input.propertyCount
  return `Ulo: First frost is usually around ${input.frostLabel} near ${input.nearName}. Winterizing checklist is ready for ${count} ${count === 1 ? 'property' : 'properties'}: ${input.link}`
}

export function weatherIdempotencyKey(
  landlordId: string,
  eventStartDate: string,
  level: FreezeLevel,
  notifiedLevel: FreezeLevel | null,
): string {
  const base = `weather:${landlordId}:${eventStartDate}`
  if (notifiedLevel && freezeLevelRank(level) > freezeLevelRank(notifiedLevel)) {
    return `${base}:${level}`
  }
  return base
}

export function shouldSendWeatherSms(input: {
  level: FreezeLevel
  notifiedLevel: FreezeLevel | null
  settings: WeatherSettings
  firstWatchOfSeason: boolean
}): boolean {
  if (freezeLevelRank(input.level) <= freezeLevelRank(input.notifiedLevel)) return false
  if (input.level === 'freeze_watch') {
    return input.settings.watchTextEnabled || input.firstWatchOfSeason
  }
  return input.settings.textEnabled
}

export function weatherSmsIsCritical(level: FreezeLevel): boolean {
  return level === 'extreme_cold'
}

export type CellSnapshotInput = {
  fetchedAt: string
  sourceOk: boolean
  hourly: HourlyForecastPoint[]
  alerts: NwsAlertFact[]
}

export type CycleProperty = {
  id: string
  landlordId: string
  name: string
  state: string | null
  yearBuilt: number | null
  vacant: boolean
  cellKey: string | null
}

export type CycleTicket = OpenWeatherTicket

export type CycleTask = {
  id: string
  propertyId: string
  title: string
  status: string
  kind: 'winterizing' | 'hvac' | 'other'
  season: string | null
  checklistDone: boolean
}

export function nextWeatherEvent(input: {
  existing: WeatherEventState | null
  level: FreezeLevel | null
  lowTempF: number | null
  nwsEvent: string | null
  now: Date
  propertyId: string
  landlordId: string
}): { event: WeatherEventState | null; changed: boolean } {
  if (!input.level) {
    if (!input.existing || input.existing.status !== 'active') {
      return { event: input.existing, changed: false }
    }
    return {
      changed: true,
      event: {
        ...input.existing,
        status: 'resolved',
        endsAt: input.now.toISOString(),
      },
    }
  }
  if (!input.existing || input.existing.status !== 'active') {
    return {
      changed: true,
      event: {
        id: `new:${input.propertyId}:${input.now.getTime()}`,
        propertyId: input.propertyId,
        landlordId: input.landlordId,
        level: input.level,
        startsAt: input.now.toISOString(),
        endsAt: null,
        lowTempF: input.lowTempF,
        nwsEvent: input.nwsEvent,
        status: 'active',
        notifiedLevel: null,
      },
    }
  }
  const same =
    input.existing.level === input.level &&
    input.existing.lowTempF === input.lowTempF &&
    input.existing.nwsEvent === input.nwsEvent
  if (same) return { event: input.existing, changed: false }
  return {
    changed: true,
    event: {
      ...input.existing,
      level: input.level,
      lowTempF: input.lowTempF,
      nwsEvent: input.nwsEvent,
    },
  }
}

export type WeatherAttentionCard = {
  key: string
  badge: 'critical' | 'warning'
  title: string
  context: string
  meta: string
  propertyId: string
  heatTicketId: string | null
  level: FreezeLevel
}

function levelTitle(level: FreezeLevel): string {
  if (level === 'extreme_cold') return 'Extreme cold'
  if (level === 'hard_freeze') return 'Hard freeze'
  return 'Freeze watch'
}

export function deriveWeatherAttentionCard(input: {
  landlordId: string
  events: WeatherEventState[]
  properties: Array<{ id: string; name: string; vacant: boolean }>
  unwinterizedPropertyIds: string[]
  heatTickets: Array<{ id: string; propertyId: string }>
}): WeatherAttentionCard | null {
  const active = input.events.filter((event) => event.status === 'active')
  if (active.length === 0) return null
  const worst = active.reduce((best, event) =>
    freezeLevelRank(event.level) > freezeLevelRank(best.level) ? event : best,
  )
  const startDate = worst.startsAt.slice(0, 10)
  const names = active.map((event) => {
    return input.properties.find((property) => property.id === event.propertyId)?.name ?? 'Property'
  })
  const unwinterized = input.unwinterizedPropertyIds.filter((id) =>
    active.some((event) => event.propertyId === id),
  )
  const vacant = input.properties.filter(
    (property) => property.vacant && active.some((event) => event.propertyId === property.id),
  ).length
  const heat = input.heatTickets.filter((ticket) =>
    active.some((event) => event.propertyId === ticket.propertyId),
  )
  const severe = worst.level === 'hard_freeze' || worst.level === 'extreme_cold'
  const badge = severe || unwinterized.length > 0 ? 'critical' : 'warning'
  return {
    key: `weather:${input.landlordId}:${startDate}`,
    badge,
    title: levelTitle(worst.level),
    context: formatPropertyNameList(names),
    meta: `${plural(vacant, 'vacant unit', 'vacant units')} · ${plural(unwinterized.length, 'property not winterized', 'properties not winterized')} · ${plural(heat.length, 'open heat ticket', 'open heat tickets')}`,
    propertyId: worst.propertyId,
    heatTicketId: heat[0]?.id ?? null,
    level: worst.level,
  }
}

export function cellNeedsFetch(input: {
  lastFetchedAt: string | null
  hasActiveEvent: boolean
  now: Date
}): boolean {
  if (!input.lastFetchedAt) return true
  const at = Date.parse(input.lastFetchedAt)
  if (!Number.isFinite(at)) return true
  const age = input.now.getTime() - at
  if (input.hasActiveEvent) return age >= 60 * 60 * 1000
  return age >= 3 * 60 * 60 * 1000
}

export type PlannedSms = {
  landlordId: string
  body: string
  idempotencyKey: string
  isCritical: boolean
  level: FreezeLevel
}

export type PlannedTicketUpdate = {
  ticketId: string
  propertyId: string
  landlordId: string
  from: UrgencyBand
  to: UrgencyBand
  message: string
}

export type PlannedWinterizingTask = {
  propertyId: string
  landlordId: string
  title: string
  season: string
  dueAt: string
  hvacTaskId: string | null
  checklist: WinterizingChecklistItem[]
}

export type WeatherCyclePlan = {
  events: WeatherEventState[]
  sms: PlannedSms[]
  ticketUpdates: PlannedTicketUpdate[]
  winterizingTasks: PlannedWinterizingTask[]
  winterizingSms: PlannedSms[]
  acted: boolean
}

function winningAlert(alerts: NwsAlertFact[], level: FreezeLevel | null): string | null {
  if (!level) return null
  const match = alerts.find((alert) => {
    const event = alert.event.trim().toLowerCase()
    if (level === 'extreme_cold') {
      return event === 'extreme cold warning' || event === 'wind chill warning'
    }
    if (level === 'hard_freeze') {
      return event === 'freeze warning' || event === 'hard freeze warning'
    }
    return false
  })
  return match?.event ?? null
}

export function planWeatherCycle(input: {
  now: Date
  properties: CycleProperty[]
  snapshots: Record<string, CellSnapshotInput | undefined>
  events: WeatherEventState[]
  tickets: CycleTicket[]
  tasks: CycleTask[]
  settingsByLandlord: Record<string, WeatherSettings | undefined>
  firstWatchOfSeasonByLandlord?: Record<string, boolean | undefined>
  winterizingAlreadySentOn?: Record<string, string | undefined>
  appLink: string
  frostByProperty?: Record<string, { monthDay: string; label: string } | undefined>
}): WeatherCyclePlan {
  const events = input.events.map((event) => ({ ...event }))
  const sms: PlannedSms[] = []
  const ticketUpdates: PlannedTicketUpdate[] = []
  const winterizingTasks: PlannedWinterizingTask[] = []
  const winterizingSms: PlannedSms[] = []
  let acted = false
  const notifyGroups = new Map<
    string,
    {
      landlordId: string
      level: FreezeLevel
      low: number
      whenLabel: string
      names: string[]
      vacant: number
      unwinterized: number
      startDate: string
      notifiedLevel: FreezeLevel | null
      settings: WeatherSettings
      firstWatch: boolean
    }
  >()

  for (const property of input.properties) {
    if (property.landlordId === LIMITED_ALPHA_1_LANDLORD_ID) continue
    if (!property.cellKey) continue
    const snapshot = input.snapshots[property.cellKey]
    if (!snapshot || !snapshotIsFresh(snapshot.fetchedAt, input.now) || !snapshot.sourceOk) {
      continue
    }
    const settings = input.settingsByLandlord[property.landlordId] ?? DEFAULT_WEATHER_SETTINGS
    const facts: FreezePropertyFacts = {
      state: property.state,
      yearBuilt: property.yearBuilt,
      vacant: property.vacant,
      thresholdAdjustF: settings.thresholdAdjustF,
    }
    const level = evaluateFreezeLevel({
      hourly: snapshot.hourly,
      alerts: snapshot.alerts,
      property: facts,
      now: input.now,
    })
    const lowPoint = forecastLowPoint(snapshot.hourly, input.now, 48)
    const existing = events.find(
      (event) => event.propertyId === property.id && event.status === 'active',
    ) ?? null
    const next = nextWeatherEvent({
      existing,
      level,
      lowTempF: lowPoint ? Math.round(lowPoint.tempF) : null,
      nwsEvent: winningAlert(snapshot.alerts, level),
      now: input.now,
      propertyId: property.id,
      landlordId: property.landlordId,
    })
    if (next.changed && next.event) {
      acted = true
      const index = events.findIndex((event) => event.propertyId === property.id && event.status === 'active')
      if (index >= 0 && next.event.status === 'active') events[index] = next.event
      else if (index >= 0 && next.event.status === 'resolved') events[index] = next.event
      else if (next.event.status === 'active') events.push(next.event)
    }
    const active = events.find(
      (event) => event.propertyId === property.id && event.status === 'active',
    )
    if (active && level) {
      const unwinterized = !input.tasks.some(
        (task) =>
          task.propertyId === property.id &&
          task.kind === 'winterizing' &&
          task.checklistDone,
      )
      const send = shouldSendWeatherSms({
        level,
        notifiedLevel: active.notifiedLevel,
        settings,
        firstWatchOfSeason: input.firstWatchOfSeasonByLandlord?.[property.landlordId] === true,
      })
      if (send && lowPoint) {
        const startDate = active.startsAt.slice(0, 10)
        const groupKey = `${property.landlordId}:${startDate}:${level}`
        const group = notifyGroups.get(groupKey) ?? {
          landlordId: property.landlordId,
          level,
          low: lowPoint.tempF,
          whenLabel: `${weekdayShort(lowPoint.time)} night`.trim(),
          names: [],
          vacant: 0,
          unwinterized: 0,
          startDate,
          notifiedLevel: active.notifiedLevel,
          settings,
          firstWatch: input.firstWatchOfSeasonByLandlord?.[property.landlordId] === true,
        }
        group.names.push(property.name)
        group.low = Math.min(group.low, lowPoint.tempF)
        if (property.vacant) group.vacant += 1
        if (unwinterized) group.unwinterized += 1
        notifyGroups.set(groupKey, group)
        active.notifiedLevel = level
      }
    }

    const low24 = forecastLowF(snapshot.hourly, input.now, TICKET_FORECAST_HOURS)
    if (low24 != null && level) {
      for (const ticket of input.tickets) {
        if (ticket.propertyId !== property.id) continue
        const current = urgencyBandFromStored(ticket.urgency)
        const raised = raisedTicketUrgency(current, ticket.description, low24)
        if (!raised.changed) continue
        acted = true
        ticketUpdates.push({
          ticketId: ticket.id,
          propertyId: property.id,
          landlordId: property.landlordId,
          from: current,
          to: raised.next,
          message: ticketRaisedActivityMessage(raised.next, low24),
        })
      }
    }
  }

  for (const group of notifyGroups.values()) {
    const body = buildFreezeAlertSms({
      level: group.level,
      lowTempF: group.low,
      whenLabel: group.whenLabel,
      propertyNames: group.names,
      vacantCount: group.vacant,
      unwinterizedCount: group.unwinterized,
      link: input.appLink,
    })
    sms.push({
      landlordId: group.landlordId,
      body,
      idempotencyKey: weatherIdempotencyKey(
        group.landlordId,
        group.startDate,
        group.level,
        group.notifiedLevel,
      ),
      isCritical: weatherSmsIsCritical(group.level),
      level: group.level,
    })
    acted = true
  }

  const today = input.now.toISOString().slice(0, 10)
  const winterGroups = new Map<string, { names: string[]; label: string; near: string }>()
  for (const property of input.properties) {
    if (property.landlordId === LIMITED_ALPHA_1_LANDLORD_ID) continue
    const frost = input.frostByProperty?.[property.id]
    if (!frost) continue
    const due = winterizingWindow(input.now, frost.monthDay)
    if (!due) continue
    const exists = input.tasks.some(
      (task) =>
        task.propertyId === property.id &&
        task.kind === 'winterizing' &&
        task.season === due.season,
    )
    const hvac = input.tasks.find(
      (task) => task.propertyId === property.id && task.kind === 'hvac',
    )
    if (!exists) {
      acted = true
      winterizingTasks.push({
        propertyId: property.id,
        landlordId: property.landlordId,
        title: 'Winterizing checklist',
        season: due.season,
        dueAt: due.frostAt,
        hvacTaskId: hvac?.id ?? null,
        checklist: winterizingChecklist(hvac?.id ?? null),
      })
    }
    if (input.winterizingAlreadySentOn?.[property.landlordId] === today) continue
    const group = winterGroups.get(property.landlordId) ?? {
      names: [],
      label: frost.label,
      near: property.name,
    }
    group.names.push(property.name)
    winterGroups.set(property.landlordId, group)
  }
  for (const [landlordId, group] of winterGroups) {
    winterizingSms.push({
      landlordId,
      body: buildWinterizingSms({
        frostLabel: group.label,
        nearName: group.near,
        propertyCount: group.names.length,
        link: input.appLink,
      }),
      idempotencyKey: `winterizing:${landlordId}:${today}`,
      isCritical: false,
      level: 'freeze_watch',
    })
  }

  return { events, sms, ticketUpdates, winterizingTasks, winterizingSms, acted }
}

export const WINTERIZING_CHECKLIST = [
  { key: 'faucets', label: 'Shut off and drain outdoor faucets and disconnect hoses' },
  { key: 'irrigation', label: 'Blow out irrigation' },
  { key: 'gutters', label: 'Clean gutters' },
  { key: 'pipes', label: 'Insulate exposed pipes' },
  { key: 'vacant_heat', label: "Set vacant units' heat to at least 55°F" },
  { key: 'furnace', label: 'Furnace tune-up' },
] as const

export type WinterizingChecklistItem = {
  key: string
  label: string
  done: boolean
  linkedTaskId?: string | null
}

export function winterizingChecklist(hvacTaskId: string | null): WinterizingChecklistItem[] {
  return WINTERIZING_CHECKLIST.map((item) => ({
    key: item.key,
    label: item.label,
    done: false,
    linkedTaskId: item.key === 'furnace' ? hvacTaskId : null,
  }))
}

export function winterizingWindow(
  now: Date,
  monthDay: string,
): { season: string; frostAt: string } | null {
  const match = /^(\d{2})-(\d{2})$/.exec(monthDay)
  if (!match) return null
  const month = Number(match[1])
  const day = Number(match[2])
  const year = now.getUTCFullYear()
  const candidate = Date.UTC(year, month - 1, day, 12)
  const frostMs = candidate >= now.getTime() ? candidate : Date.UTC(year + 1, month - 1, day, 12)
  const lead = frostMs - 28 * 24 * 60 * 60 * 1000
  if (now.getTime() < lead || now.getTime() > frostMs) return null
  const frost = new Date(frostMs)
  return {
    season: String(frost.getUTCFullYear()),
    frostAt: frost.toISOString(),
  }
}

const STATE_FIRST_FROST: Record<string, string> = {
  AL: '11-12', AK: '09-01', AZ: '11-20', AR: '11-05', CA: '12-01', CO: '09-15',
  CT: '10-10', DE: '10-25', FL: '12-20', GA: '11-08', HI: '01-15', ID: '09-20',
  IL: '10-15', IN: '10-15', IA: '10-10', KS: '10-15', KY: '10-20', LA: '11-20',
  ME: '09-25', MD: '10-20', MA: '10-10', MI: '10-05', MN: '09-30', MS: '11-10',
  MO: '10-15', MT: '09-15', NE: '10-05', NV: '10-01', NH: '09-25', NJ: '10-20',
  NM: '10-15', NY: '10-10', NC: '11-01', ND: '09-20', OH: '10-15', OK: '11-01',
  OR: '10-15', PA: '10-15', RI: '10-15', SC: '11-10', SD: '09-25', TN: '10-25',
  TX: '11-15', UT: '09-25', VT: '09-25', VA: '10-25', WA: '10-20', WV: '10-15',
  WI: '10-01', WY: '09-10', DC: '11-01',
}

export function stateFirstFrostMonthDay(state: string | null | undefined): string | null {
  const code = (state ?? '').trim().toUpperCase()
  return STATE_FIRST_FROST[code] ?? null
}

export function formatFrostLabel(monthDay: string): string {
  const match = /^(\d{2})-(\d{2})$/.exec(monthDay)
  if (!match) return monthDay
  const at = new Date(Date.UTC(2026, Number(match[1]) - 1, Number(match[2]), 12))
  return at.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

type DailyMin = { time: string; tempMinF: number }

function seasonKey(isoDate: string): string {
  const [year, month] = isoDate.split('-').map(Number)
  return month >= 7 ? String(year) : String(year - 1)
}

export function firstFrostMonthDays(days: DailyMin[]): string[] {
  const bySeason = new Map<string, string>()
  const ordered = days.slice().sort((a, b) => a.time.localeCompare(b.time))
  for (const day of ordered) {
    if (day.tempMinF > 32) continue
    const season = seasonKey(day.time)
    if (!bySeason.has(season)) bySeason.set(season, day.time.slice(5, 10))
  }
  return [...bySeason.values()]
}

function dayOfYear(monthDay: string): number {
  const [month, day] = monthDay.split('-').map(Number)
  return Math.round(Date.UTC(2023, month - 1, day) / 86400000)
}

export function medianMonthDay(monthDays: string[]): string | null {
  const clean = monthDays.filter((value) => /^\d{2}-\d{2}$/.test(value))
  if (clean.length === 0) return null
  const sorted = clean.slice().sort((a, b) => dayOfYear(a) - dayOfYear(b))
  const mid = Math.floor((sorted.length - 1) / 2)
  return sorted.length % 2 === 1
    ? sorted[mid]
    : sorted[mid]
}

export function resolveFrostDate(input: {
  state: string | null
  openMeteoDays: DailyMin[] | null
  apiKeyPresent: boolean
}): { monthDay: string | null; source: 'open-meteo' | 'state_average'; loggedFallback: boolean } {
  if (input.apiKeyPresent && input.openMeteoDays && input.openMeteoDays.length > 0) {
    const median = medianMonthDay(firstFrostMonthDays(input.openMeteoDays))
    if (median) return { monthDay: median, source: 'open-meteo', loggedFallback: false }
  }
  return {
    monthDay: stateFirstFrostMonthDay(input.state),
    source: 'state_average',
    loggedFallback: !input.apiKeyPresent,
  }
}

const US_STATE_CODES = new Set(Object.keys(STATE_FIRST_FROST))

export function geocodeStatusForAddress(
  state: string | null | undefined,
  coords: { lat: number; lon: number } | null,
): 'ok' | 'not_found' | 'non_us' {
  if (coords) return 'ok'
  const raw = (state ?? '').trim()
  if (!raw) return 'not_found'
  const code = raw.toUpperCase()
  if (US_STATE_CODES.has(code)) return 'not_found'
  return 'non_us'
}

export type GeocodeBackfillRow = {
  id: string
  landlordId: string
  state: string | null
  latitude: number | null
  longitude: number | null
}

export function planGeocodeBackfill(input: {
  rows: GeocodeBackfillRow[]
  dryRun: boolean
  results: Record<string, { lat: number; lon: number } | null>
}): Array<{
  id: string
  action: 'skip_la1' | 'skip_existing' | 'save' | 'dry_run' | 'not_found' | 'non_us'
  latitude?: number
  longitude?: number
  geocodeStatus?: 'ok' | 'not_found' | 'non_us'
}> {
  return input.rows.map((row) => {
    if (row.landlordId === LIMITED_ALPHA_1_LANDLORD_ID) return { id: row.id, action: 'skip_la1' }
    if (row.latitude != null && row.longitude != null) return { id: row.id, action: 'skip_existing' }
    const coords = input.results[row.id] ?? null
    const status = geocodeStatusForAddress(row.state, coords)
    if (status === 'non_us') return { id: row.id, action: 'non_us', geocodeStatus: 'non_us' }
    if (!coords) return { id: row.id, action: 'not_found', geocodeStatus: 'not_found' }
    if (input.dryRun) {
      return {
        id: row.id,
        action: 'dry_run',
        latitude: coords.lat,
        longitude: coords.lon,
        geocodeStatus: 'ok',
      }
    }
    return {
      id: row.id,
      action: 'save',
      latitude: coords.lat,
      longitude: coords.lon,
      geocodeStatus: 'ok',
    }
  })
}

export const GEOCODE_ADDRESS_HINT = 'Add a full address to get weather alerts'
export const WEATHER_UNAVAILABLE_LABEL = 'Weather unavailable'
