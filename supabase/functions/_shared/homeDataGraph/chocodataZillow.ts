/// <reference lib="deno.ns" />
/**
 * Chocodata Zillow Scraper API → HomeDataFacts.
 * GET https://api.chocodata.com/api/v1/zillow/search|property?api_key=…
 */
import {
  emptyHomeDataFacts,
  parseHomeDataPhotoUrls,
  type HomeDataFacts,
} from "../../../../shared/homeDataGraph.ts"

const CHOCODATA_ORIGIN = "https://api.chocodata.com"
const FETCH_MS = 55_000

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function asNum(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string" && value.trim()) {
    const n = Number(value.replace(/[$,]/g, ""))
    if (Number.isFinite(n)) return n
  }
  return null
}

function asPositive(value: unknown): number | null {
  const n = asNum(value)
  return n != null && n > 0 ? n : null
}

function asNonNeg(value: unknown): number | null {
  const n = asNum(value)
  return n != null && n >= 0 ? n : null
}

function asText(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim()
  return null
}

function asYear(value: unknown): number | null {
  const n = asPositive(value)
  if (n == null) return null
  const y = Math.round(n)
  if (y < 1700 || y > 2100) return null
  return y
}

export function normalizeStreetKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/[.#,]/g, " ")
    .replace(/\b(street)\b/g, "st")
    .replace(/\b(avenue)\b/g, "ave")
    .replace(/\b(boulevard)\b/g, "blvd")
    .replace(/\b(drive)\b/g, "dr")
    .replace(/\b(road)\b/g, "rd")
    .replace(/\b(lane)\b/g, "ln")
    .replace(/\b(court)\b/g, "ct")
    .replace(/\b(place)\b/g, "pl")
    .replace(/\s+/g, " ")
    .trim()
}

export function chocodataSearchLocations(address: string): string[] {
  const raw = address.trim().replace(/\s+/g, " ")
  const locations: string[] = []
  const full = raw.match(/^(.*),\s*([^,]+),\s*([A-Za-z]{2})\s+(\d{5})(?:-\d{4})?$/)
  if (full) {
    locations.push(`${full[2].trim()}, ${full[3].toUpperCase()}`)
    locations.push(full[4])
  } else {
    const tail = raw.match(/,\s*([A-Za-z]{2})\s+(\d{5})(?:-\d{4})?$/)
    if (tail) locations.push(tail[2])
    const zip = zipFromAddress(raw)
    if (zip) locations.push(zip)
  }
  return [...new Set(locations.filter(Boolean))]
}

function zipFromAddress(address: string): string | null {
  const match = address.match(/\b(\d{5})(?:-\d{4})?\b/)
  return match?.[1] ?? null
}

function streetFromAddress(address: string): string {
  return normalizeStreetKey(address.split(",")[0] ?? address)
}

function roomCount(rooms: unknown, type: string): number | null {
  if (!Array.isArray(rooms)) return null
  for (const item of rooms) {
    const row = asRecord(item)
    if (!row) continue
    const kind = asText(row.room_type)?.toLowerCase() ?? ""
    if (!kind.includes(type)) continue
    const count = asNonNeg(row.count)
    if (count != null) return count
  }
  return null
}

function formatHomeType(raw: string | null): string | null {
  if (!raw) return null
  const key = raw.trim().toUpperCase().replace(/[\s-]+/g, "_")
  const labels: Record<string, string> = {
    SINGLE_FAMILY: "Single Family",
    HOUSE: "Single Family",
    MULTI_FAMILY: "Multi Family",
    MULTIFAMILY: "Multi Family",
    CONDO: "Condo",
    CONDOMINIUM: "Condo",
    TOWNHOUSE: "Townhouse",
    TOWNHOME: "Townhouse",
    APARTMENT: "Apartment",
    MANUFACTURED: "Manufactured",
  }
  if (labels[key]) return labels[key]
  return raw
    .trim()
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (ch) => ch.toUpperCase())
}

export function chocodataSearchResults(payload: unknown): Record<string, unknown>[] {
  const root = asRecord(payload)
  if (!root) return []
  const list = root.results ?? root.data
  if (!Array.isArray(list)) return []
  return list.map((item) => asRecord(item)).filter((row): row is Record<string, unknown> => Boolean(row))
}

export function pickChocodataSearchHit(
  payload: unknown,
  address: string,
): Record<string, unknown> | null {
  const rows = chocodataSearchResults(payload)
  if (rows.length === 0) return null
  const wantStreet = streetFromAddress(address)
  const wantZip = zipFromAddress(address)
  const scored = rows.map((row) => {
    const street = normalizeStreetKey(
      asText(row.address_street) ?? asText(row.title)?.split(",")[0] ?? "",
    )
    const zip = asText(row.address_zip) ?? zipFromAddress(asText(row.title) ?? "")
    let score = 0
    if (wantStreet && street && (street === wantStreet || street.startsWith(wantStreet) || wantStreet.startsWith(street))) {
      score += 10
    }
    if (wantZip && zip === wantZip) score += 3
    if (asPositive(row.zestimate) || asPositive(row.price) || asNonNeg(row.beds)) score += 1
    return { row, score }
  })
  scored.sort((a, b) => b.score - a.score)
  const best = scored[0]
  if (!best) return null
  if (best.score >= 10) return best.row
  if (rows.length === 1 && best.score >= 1) return best.row
  return null
}

export function mapChocodataSearchHitToFacts(row: Record<string, unknown>): HomeDataFacts {
  const facts = emptyHomeDataFacts()
  const photos = parseHomeDataPhotoUrls([
    asText(row.thumbnail),
    ...(Array.isArray(row.photos) ? row.photos : []),
  ])
  return {
    ...facts,
    estimatedValue: asPositive(row.zestimate) ?? asPositive(row.price),
    propertyType: formatHomeType(asText(row.home_type)),
    bedrooms: asNonNeg(row.beds),
    bathrooms: asNonNeg(row.baths),
    livingAreaSqft: asPositive(row.sqft),
    lotSizeSqft: asPositive(row.lot_area),
    latitude: asNum(row.latitude),
    longitude: asNum(row.longitude),
    photoUrls: photos,
  }
}

export function mapChocodataPropertyToFacts(
  payload: unknown,
  searchHit?: Record<string, unknown> | null,
): { facts: HomeDataFacts; providerRecordId: string | null } {
  const root = asRecord(payload) ?? {}
  const nested = asRecord(root.data) ?? root
  const area = asRecord(nested.area)
  const trades = Array.isArray(nested.trade_info) ? nested.trade_info : []
  const sale = trades.map((item) => asRecord(item)).find((row) => row && asPositive(row.price))
  const search = searchHit ? mapChocodataSearchHitToFacts(searchHit) : emptyHomeDataFacts()
  const images = [
    asText(nested.main_image),
    ...(Array.isArray(nested.images) ? nested.images : []),
    ...search.photoUrls,
  ]
  const facts: HomeDataFacts = {
    ...emptyHomeDataFacts(),
    estimatedValue: search.estimatedValue ?? asPositive(sale?.price) ?? asPositive(nested.price),
    estimatedRent: search.estimatedRent,
    propertyType:
      formatHomeType(asText(nested.property_type)) ??
      formatHomeType(asText(nested.home_type)) ??
      search.propertyType,
    bedrooms:
      roomCount(nested.rooms, "bedroom") ??
      asNonNeg(nested.number_of_rooms) ??
      search.bedrooms,
    bathrooms: roomCount(nested.rooms, "bathroom") ?? asNonNeg(nested.baths) ?? search.bathrooms,
    livingAreaSqft: asPositive(area?.value) ?? asPositive(nested.living_area) ?? search.livingAreaSqft,
    lotSizeSqft: asPositive(nested.lot_size) ?? search.lotSizeSqft,
    yearBuilt: asYear(nested.year_built),
    latitude: asNum(nested.latitude) ?? search.latitude,
    longitude: asNum(nested.longitude) ?? search.longitude,
    photoUrls: parseHomeDataPhotoUrls(images),
  }
  const zpid =
    asText(nested.zpid) ??
    (typeof nested.zpid === "number" ? String(nested.zpid) : null) ??
    asText(searchHit?.zpid) ??
    asText(searchHit?.id)
  return { facts, providerRecordId: zpid }
}

async function chocodataGet(
  path: string,
  params: Record<string, string>,
  apiKey: string,
  attempt = 0,
): Promise<unknown | null> {
  const url = new URL(`${CHOCODATA_ORIGIN}${path}`)
  url.searchParams.set("api_key", apiKey)
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), FETCH_MS)
  try {
    const res = await fetch(url.toString(), {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: ctrl.signal,
    })
    const text = await res.text().catch(() => "")
    if (res.status === 502 && attempt < 1) {
      await new Promise((resolve) => setTimeout(resolve, 800))
      return await chocodataGet(path, params, apiKey, attempt + 1)
    }
    if (!res.ok) {
      console.warn("[chocodata-zillow]", res.status, path, params.location ?? params.zpid ?? "")
      return null
    }
    try {
      return text ? JSON.parse(text) : null
    } catch {
      return null
    }
  } catch (err) {
    console.warn("[chocodata-zillow] fetch failed", path, err instanceof Error ? err.message : "error")
    return null
  } finally {
    clearTimeout(timer)
  }
}

export async function loadChocodataListing(input: {
  address: string
  apiKey: string
}): Promise<{ payload: unknown; searchHit: Record<string, unknown> | null } | null> {
  const apiKey = input.apiKey.trim()
  const address = input.address.trim()
  if (!apiKey || !address) return null
  const locations = chocodataSearchLocations(address)
  if (locations.length === 0) return null

  for (const location of locations) {
    const search = await chocodataGet(
      "/api/v1/zillow/search",
      { location, limit: "40" },
      apiKey,
    )
    const hit = search ? pickChocodataSearchHit(search, address) : null
    const zpid = hit ? asText(hit.zpid) ?? asText(hit.id) : null
    if (zpid) {
      const property = await chocodataGet("/api/v1/zillow/property", { zpid }, apiKey)
      if (property) return { payload: property, searchHit: hit }
      return { payload: hit, searchHit: hit }
    }
    if (hit) return { payload: hit, searchHit: hit }
  }
  return null
}
