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

function firstStationUrl(stationsBody: unknown): string | null {
  const features = asRecord(stationsBody)?.features
  if (!Array.isArray(features) || features.length === 0) return null
  const id = asRecord(features[0])?.id
  return typeof id === "string" && id.trim() ? `${id.replace(/\/$/, "")}/observations/latest` : null
}

async function fetchJson(
  url: string,
  headers: Record<string, string>,
  fetchFn: typeof fetch,
): Promise<unknown | null> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), FETCH_MS)
  try {
    const res = await fetchFn(url, { headers, signal: ctrl.signal })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
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

/**
 * Best-effort outdoor °F at the ticket property. Returns null when the
 * description does not need temperature, or lookup fails.
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
    let coords = coordsFromRecord(record)
    if (!coords) {
      const address = addressFromRecord(record)
      if (address) coords = await geocodeUsAddress(address, fetchFn)
    }
    if (!coords) return null

    const key = cacheKey(coords.lat, coords.lon)
    const cached = tempCache.get(key)
    if (cached && cached.expiresAt > now()) return cached.tempF

    const tempF = await fetchNwsTempF(coords.lat, coords.lon, fetchFn)
    if (tempF == null) return null
    tempCache.set(key, { tempF, expiresAt: now() + CACHE_TTL_MS })
    return tempF
  } catch (err) {
    console.warn("[weather] outdoor temp lookup failed", err)
    return null
  }
}
