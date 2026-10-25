/**
 * Current outdoor temperature (°F) at a property, via Census geocode + NWS.
 * Used by urgency policy (no heat / no cooling). Failures return null.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import {
  formatPropertyAddressLine,
  formatPropertyCityStateZip,
  loadLandlordPropertyRecords,
  matchPropertyByName,
  type AskUloPropertyRecord,
} from "../ask_ulo/tools/properties/propertyRecords.ts"
import { descriptionNeedsOutdoorTemp } from "../../../../shared/maintenance/urgencyPolicy.ts"
import {
  forecastLowF,
  shouldRetryNwsStatus,
  snapshotIsFresh,
  weatherCellKey,
  type HourlyForecastPoint,
  type NwsAlertFact,
} from "../../../../shared/weather/freezeRules.ts"
import {
  colderForecastTemp,
  geocodeStatusForAddress,
} from "../../../../shared/weather/weatherMonitor.ts"

export const NWS_TEMP_USER_AGENT =
  "UloPropertyOps/1.0 (maintenance-urgency; https://ulohome.com)"

const CACHE_TTL_MS = 30 * 60 * 1000
const FETCH_MS = 4000

type CacheEntry = { tempF: number; expiresAt: number }
const tempCache = new Map<string, CacheEntry>()

export type OutdoorTempLookupInput = {
  landlordId?: string | null
  propertyId?: string | null
  unitId?: string | null
  building?: string | null
  unitLabel?: string | null
  description?: string | null
}

export type OutdoorTempDeps = {
  fetchFn?: typeof fetch
  now?: () => number
}

function asRecord(v: unknown): Record<string, unknown> | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null
  return v as Record<string, unknown>
}

function cacheKey(lat: number, lon: number): string {
  return `${lat.toFixed(3)},${lon.toFixed(3)}`
}

export function celsiusToFahrenheit(c: number): number {
  return Math.round((c * 9) / 5 + 32)
}

export function parseCensusCoordinates(body: unknown): { lat: number; lon: number } | null {
  const root = asRecord(body)
  const result = asRecord(root?.result)
  const matches = result?.addressMatches
  if (!Array.isArray(matches) || matches.length === 0) return null
  const coords = asRecord(asRecord(matches[0])?.coordinates)
  const lon = coords?.x
  const lat = coords?.y
  if (typeof lat !== "number" || typeof lon !== "number") return null
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
  return { lat, lon }
}

export function parseNwsObservationTempF(body: unknown): number | null {
  const props = asRecord(asRecord(body)?.properties)
  const temp = asRecord(props?.temperature)
  const value = temp?.value
  if (typeof value !== "number" || !Number.isFinite(value)) return null
  const unit = typeof temp?.unitCode === "string" ? temp.unitCode.toLowerCase() : ""
  if (unit.includes("degf") || unit.endsWith(":f")) return Math.round(value)
  return celsiusToFahrenheit(value)
}

export function parseNwsHourlyTempF(body: unknown): number | null {
  const props = asRecord(asRecord(body)?.properties)
  const periods = props?.periods
  if (!Array.isArray(periods) || periods.length === 0) return null
  const first = asRecord(periods[0])
  const value = first?.temperature
  if (typeof value !== "number" || !Number.isFinite(value)) return null
  const unit = typeof first?.temperatureUnit === "string"
    ? first.temperatureUnit.toUpperCase()
    : "F"
  if (unit === "C") return celsiusToFahrenheit(value)
  return Math.round(value)
}

export function parseNwsPointUrls(body: unknown): {
  forecastHourly: string | null
  observations: string | null
} {
  const props = asRecord(asRecord(body)?.properties)
  const forecastHourly =
    typeof props?.forecastHourly === "string" ? props.forecastHourly : null
  const stations = asRecord(props?.observationStations)
  const observations =
    typeof props?.observationStations === "string"
      ? props.observationStations
      : typeof stations?.href === "string"
      ? stations.href
      : null
  return { forecastHourly, observations }
}

export function parseNwsHourlyForecast(
  body: unknown,
  now = new Date(),
): HourlyForecastPoint[] {
  const props = asRecord(asRecord(body)?.properties)
  const periods = props?.periods
  if (!Array.isArray(periods)) return []
  const end = now.getTime() + 72 * 60 * 60 * 1000
  const points: HourlyForecastPoint[] = []
  for (const raw of periods) {
    const period = asRecord(raw)
    const time = typeof period?.startTime === "string" ? period.startTime : ""
    const at = Date.parse(time)
    if (!time || !Number.isFinite(at) || at > end) continue
    const value = period?.temperature
    if (typeof value !== "number" || !Number.isFinite(value)) continue
    const unit = typeof period?.temperatureUnit === "string"
      ? period.temperatureUnit.toUpperCase()
      : "F"
    const tempF = unit === "C" ? celsiusToFahrenheit(value) : Math.round(value)
    const chillRaw = period?.windChill
    let windChillF: number | null = null
    if (typeof chillRaw === "number" && Number.isFinite(chillRaw)) {
      const chillUnit = typeof period?.windChillUnit === "string"
        ? period.windChillUnit.toUpperCase()
        : unit
      windChillF = chillUnit === "C" ? celsiusToFahrenheit(chillRaw) : Math.round(chillRaw)
    }
    points.push({ time, tempF, windChillF })
    if (points.length >= 72) break
  }
  return points
}

export function parseNwsActiveAlerts(body: unknown): NwsAlertFact[] {
  const features = asRecord(body)?.features
  if (!Array.isArray(features)) return []
  const alerts: NwsAlertFact[] = []
  for (const raw of features) {
    const props = asRecord(asRecord(raw)?.properties)
    const event = typeof props?.event === "string" ? props.event.trim() : ""
    if (!event) continue
    alerts.push({
      event,
      severity: typeof props?.severity === "string" ? props.severity : null,
      onset: typeof props?.onset === "string" ? props.onset : null,
      ends: typeof props?.ends === "string" ? props.ends : null,
      headline: typeof props?.headline === "string" ? props.headline : null,
    })
  }
  return alerts
}

export type WeatherFetchResult = { ok: boolean; status: number; body: unknown | null }

export async function fetchWeatherResponse(
  url: string,
  headers: Record<string, string>,
  fetchFn: typeof fetch,
  timeoutMs = FETCH_MS,
): Promise<WeatherFetchResult> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetchFn(url, { headers, signal: ctrl.signal })
    if (!res.ok) return { ok: false, status: res.status, body: null }
    return { ok: true, status: res.status, body: await res.json() }
  } catch {
    return { ok: false, status: 0, body: null }
  } finally {
    clearTimeout(timer)
  }
}

async function fetchJson(
  url: string,
  headers: Record<string, string>,
  fetchFn: typeof fetch,
): Promise<unknown | null> {
  const result = await fetchWeatherResponse(url, headers, fetchFn)
  return result.ok ? result.body : null
}

const NWS_HEADERS = {
  Accept: "application/geo+json",
  "User-Agent": NWS_TEMP_USER_AGENT,
}

async function fetchNwsOnce(
  url: string,
  fetchFn: typeof fetch,
  pause: (ms: number) => Promise<void>,
  beforeRequest?: () => Promise<void>,
): Promise<WeatherFetchResult> {
  if (beforeRequest) await beforeRequest()
  let result = await fetchWeatherResponse(url, NWS_HEADERS, fetchFn, 8000)
  if (shouldRetryNwsStatus(result.status)) {
    await pause(750)
    if (beforeRequest) await beforeRequest()
    result = await fetchWeatherResponse(url, NWS_HEADERS, fetchFn, 8000)
  }
  return result
}

export async function fetchNwsCellSnapshot(
  lat: number,
  lon: number,
  fetchFn: typeof fetch = fetch,
  pause: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  beforeRequest?: () => Promise<void>,
): Promise<{ hourly: HourlyForecastPoint[]; alerts: NwsAlertFact[]; sourceOk: boolean }> {
  const points = await fetchNwsOnce(
    `https://api.weather.gov/points/${lat.toFixed(4)},${lon.toFixed(4)}`,
    fetchFn,
    pause,
    beforeRequest,
  )
  const urls = parseNwsPointUrls(points.body)
  if (!urls.forecastHourly) {
    return { hourly: [], alerts: [], sourceOk: false }
  }
  const hourly = await fetchNwsOnce(urls.forecastHourly, fetchFn, pause, beforeRequest)
  const alerts = await fetchNwsOnce(
    `https://api.weather.gov/alerts/active?point=${lat.toFixed(4)},${lon.toFixed(4)}`,
    fetchFn,
    pause,
    beforeRequest,
  )
  const parsedHours = parseNwsHourlyForecast(hourly.body)
  if (!hourly.ok || parsedHours.length === 0) {
    return { hourly: [], alerts: parseNwsActiveAlerts(alerts.body), sourceOk: false }
  }
  return {
    hourly: parsedHours,
    alerts: parseNwsActiveAlerts(alerts.body),
    sourceOk: true,
  }
}

function firstStationUrl(stationsBody: unknown): string | null {
  const features = asRecord(stationsBody)?.features
  if (!Array.isArray(features) || features.length === 0) return null
  const id = asRecord(features[0])?.id
  return typeof id === "string" && id.trim() ? `${id.replace(/\/$/, "")}/observations/latest` : null
}

export async function geocodeUsAddress(
  address: string,
  fetchFn: typeof fetch = fetch,
): Promise<{ lat: number; lon: number } | null> {
  const trimmed = address.trim()
  if (!trimmed) return null
  const url =
    "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress" +
    `?address=${encodeURIComponent(trimmed)}` +
    "&benchmark=Public_AR_Current&vintage=Current_Current&format=json"
  const body = await fetchJson(
    url,
    { Accept: "application/json", "User-Agent": NWS_TEMP_USER_AGENT },
    fetchFn,
  )
  return parseCensusCoordinates(body)
}

export async function fetchNwsTempF(
  lat: number,
  lon: number,
  fetchFn: typeof fetch = fetch,
): Promise<number | null> {
  const points = await fetchJson(
    `https://api.weather.gov/points/${lat.toFixed(4)},${lon.toFixed(4)}`,
    { Accept: "application/geo+json", "User-Agent": NWS_TEMP_USER_AGENT },
    fetchFn,
  )
  const urls = parseNwsPointUrls(points)
  if (urls.observations) {
    const stations = await fetchJson(
      urls.observations,
      { Accept: "application/geo+json", "User-Agent": NWS_TEMP_USER_AGENT },
      fetchFn,
    )
    const obsUrl = firstStationUrl(stations)
    if (obsUrl) {
      const obs = await fetchJson(
        obsUrl,
        { Accept: "application/geo+json", "User-Agent": NWS_TEMP_USER_AGENT },
        fetchFn,
      )
      const fromObs = parseNwsObservationTempF(obs)
      if (fromObs != null) return fromObs
    }
  }
  if (urls.forecastHourly) {
    const hourly = await fetchJson(
      urls.forecastHourly,
      { Accept: "application/geo+json", "User-Agent": NWS_TEMP_USER_AGENT },
      fetchFn,
    )
    return parseNwsHourlyTempF(hourly)
  }
  return null
}

async function loadPropertyRow(
  supabase: SupabaseClient,
  propertyId: string,
): Promise<AskUloPropertyRecord | null> {
  const { data, error } = await supabase
    .from("properties")
    .select(
      "id, name, street_address, city, state, zip_code, property_type, year_built, unit_count, latitude, longitude",
    )
    .eq("id", propertyId)
    .maybeSingle()
  if (error || !data) return null
  const records = [data as Record<string, unknown>]
  const mapped = records.map((row) => ({
    id: String(row.id ?? ""),
    name: String(row.name ?? "").trim(),
    streetAddress: typeof row.street_address === "string" ? row.street_address.trim() : null,
    city: typeof row.city === "string" ? row.city.trim() : null,
    state: typeof row.state === "string" ? row.state.trim().toUpperCase() : null,
    zipCode: typeof row.zip_code === "string" ? row.zip_code.trim() : null,
    propertyType: typeof row.property_type === "string" ? row.property_type.trim() : null,
    yearBuilt: typeof row.year_built === "number" ? row.year_built : null,
    unitCount: typeof row.unit_count === "number" ? row.unit_count : null,
    latitude: typeof row.latitude === "number" && Number.isFinite(row.latitude)
      ? row.latitude
      : null,
    longitude: typeof row.longitude === "number" && Number.isFinite(row.longitude)
      ? row.longitude
      : null,
  }))
  return mapped[0] ?? null
}

function coordsFromRecord(
  record: AskUloPropertyRecord | null,
): { lat: number; lon: number } | null {
  if (!record) return null
  if (record.latitude != null && record.longitude != null) {
    return { lat: record.latitude, lon: record.longitude }
  }
  return null
}

function addressFromRecord(record: AskUloPropertyRecord | null): string | null {
  if (!record) return null
  return formatPropertyAddressLine(record) ?? formatPropertyCityStateZip(record)
}

async function resolvePropertyRecord(
  supabase: SupabaseClient,
  input: OutdoorTempLookupInput,
): Promise<AskUloPropertyRecord | null> {
  if (input.propertyId?.trim()) {
    const row = await loadPropertyRow(supabase, input.propertyId.trim())
    if (row) return row
  }

  if (input.unitId?.trim()) {
    const { data: unit } = await supabase
      .from("units")
      .select("property_id, building")
      .eq("id", input.unitId.trim())
      .maybeSingle()
    const propertyId = typeof unit?.property_id === "string" ? unit.property_id : null
    if (propertyId) {
      const row = await loadPropertyRow(supabase, propertyId)
      if (row) return row
    }
    const building = typeof unit?.building === "string" ? unit.building : input.building
    if (input.landlordId && building) {
      const records = await loadLandlordPropertyRecords(supabase, input.landlordId)
      const matched = matchPropertyByName(records, building)
      if (matched) return matched
    }
  }

  const landlordId = input.landlordId?.trim()
  if (!landlordId) return null

  const records = await loadLandlordPropertyRecords(supabase, landlordId)
  if (input.building?.trim()) {
    const matched = matchPropertyByName(records, input.building)
    if (matched) return matched
  }

  if (input.unitLabel?.trim()) {
    const { data: units } = await supabase
      .from("units")
      .select("property_id, unit_label, building")
      .eq("landlord_id", landlordId)
      .limit(400)
    const want = input.unitLabel.trim().toLowerCase().replace(/^unit\s+/i, "")
    const hit = (units ?? []).find((row) => {
      const label = String(row.unit_label ?? "").trim().toLowerCase().replace(/^unit\s+/i, "")
      return label === want
    })
    const propertyId = typeof hit?.property_id === "string" ? hit.property_id : null
    if (propertyId) {
      const row = await loadPropertyRow(supabase, propertyId)
      if (row) return row
    }
    const building = typeof hit?.building === "string" ? hit.building : null
    if (building) {
      const matched = matchPropertyByName(records, building)
      if (matched) return matched
    }
  }

  return records.length === 1 ? records[0] : null
}

async function persistPropertyGeocode(
  supabase: SupabaseClient,
  record: AskUloPropertyRecord,
  coords: { lat: number; lon: number } | null,
): Promise<void> {
  const status = geocodeStatusForAddress(record.state, coords)
  const { error } = await supabase
    .from("properties")
    .update({
      latitude: coords?.lat ?? null,
      longitude: coords?.lon ?? null,
      geocoded_at: new Date().toISOString(),
      geocode_status: status,
    })
    .eq("id", record.id)
  if (error) console.warn("[weather] could not save property coordinates", error.message)
}

async function loadActiveForecastLow(
  supabase: SupabaseClient,
  propertyId: string,
  coords: { lat: number; lon: number },
  now: Date,
): Promise<number | null> {
  const { data: event, error: eventError } = await supabase
    .from("weather_events")
    .select("id")
    .eq("property_id", propertyId)
    .eq("status", "active")
    .limit(1)
    .maybeSingle()
  if (eventError || !event) return null
  const { data: snap, error: snapError } = await supabase
    .from("weather_snapshots")
    .select("fetched_at, source_ok, forecast_hourly")
    .eq("cell_key", weatherCellKey(coords.lat, coords.lon))
    .order("fetched_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (snapError || !snap) return null
  const fetchedAt = typeof snap.fetched_at === "string" ? snap.fetched_at : ""
  if (snap.source_ok !== true || !snapshotIsFresh(fetchedAt, now)) return null
  const hourly = Array.isArray(snap.forecast_hourly)
    ? snap.forecast_hourly as HourlyForecastPoint[]
    : []
  return forecastLowF(hourly, now, 24)
}

/**
 * Best-effort outdoor °F at the ticket property. Returns null when the
 * description does not need temperature, or lookup fails.
 * Saved coordinates are used first. A missing geocode is saved.
 * During an active freeze, the forecast low is used when it is colder.
 */
export async function lookupOutdoorTempForProperty(
  supabase: SupabaseClient,
  input: OutdoorTempLookupInput,
  deps: OutdoorTempDeps = {},
): Promise<number | null> {
  const text = input.description ?? ""
  if (text.trim() && !descriptionNeedsOutdoorTemp(text)) return null

  const fetchFn = deps.fetchFn ?? fetch
  const now = deps.now ?? Date.now

  try {
    const record = await resolvePropertyRecord(supabase, input)
    const saved = coordsFromRecord(record)
    let coords = saved
    if (!coords) {
      const address = addressFromRecord(record)
      if (address) coords = await geocodeUsAddress(address, fetchFn)
      if (record?.id) await persistPropertyGeocode(supabase, record, coords)
    }
    if (!coords) return null

    const key = cacheKey(coords.lat, coords.lon)
    const cached = tempCache.get(key)
    let tempF: number | null = cached && cached.expiresAt > now() ? cached.tempF : null
    if (tempF == null) {
      tempF = await fetchNwsTempF(coords.lat, coords.lon, fetchFn)
      if (tempF != null) tempCache.set(key, { tempF, expiresAt: now() + CACHE_TTL_MS })
    }
    const forecastLow = record?.id
      ? await loadActiveForecastLow(supabase, record.id, coords, new Date(now()))
      : null
    return colderForecastTemp(tempF, forecastLow)
  } catch (err) {
    console.warn("[weather] outdoor temp lookup failed", err)
    return null
  }
}
