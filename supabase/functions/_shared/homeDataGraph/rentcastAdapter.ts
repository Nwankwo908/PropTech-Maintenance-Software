/**
 * RentCast → Home Data Graph adapter.
 * Maps vendor payloads into HomeDataFacts. Do not persist RentCast field names on the graph.
 */
import {
  emptyHomeDataFacts,
  type HomeDataFacts,
  type HomeDataIngestResult,
} from "../../../../shared/homeDataGraph.ts"

type RentCastRaw = {
  property: unknown
  avmValue: unknown
  avmRent: unknown
  saleListings: unknown
  rentalListings: unknown
}

export type RentCastHomeDataResult = HomeDataIngestResult & {
  raw: RentCastRaw
}

const MAX_PHOTO_URLS = 24
const PHOTO_KEY_RE =
  /^(photos?|images?|media|thumbnails?|primaryPhoto|primaryImage|heroImage|imageUrl|imageURL|photoUrl|photoURL|imgUrl|picture|pictures)$/i

function isHttpsUrl(value: string): boolean {
  if (!value.startsWith("https://")) return false
  try {
    return new URL(value).protocol === "https:"
  } catch {
    return false
  }
}

function looksLikeImageUrl(value: string): boolean {
  if (!isHttpsUrl(value)) return false
  try {
    const url = new URL(value)
    const path = url.pathname.toLowerCase()
    if (/\.(jpe?g|png|webp|gif|avif)$/i.test(path)) return true
    if (/\.(jpe?g|png|webp|gif|avif)(\?|$)/i.test(url.href)) return true
    return /\/(photo|photos|image|images|img|media)\b/i.test(path)
  } catch {
    return false
  }
}

/** Pull https image URLs from a provider payload without storing RentCast field names on the graph. */
export function collectPhotoUrls(...payloads: unknown[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()

  const add = (url: string) => {
    const trimmed = url.trim()
    if (!isHttpsUrl(trimmed) || seen.has(trimmed)) return
    seen.add(trimmed)
    out.push(trimmed)
  }

  const walk = (node: unknown, parentKey: string | null): void => {
    if (out.length >= MAX_PHOTO_URLS) return
    if (typeof node === "string") {
      if (parentKey && PHOTO_KEY_RE.test(parentKey) && isHttpsUrl(node)) add(node)
      else if (looksLikeImageUrl(node)) add(node)
      return
    }
    if (Array.isArray(node)) {
      for (const item of node) walk(item, parentKey)
      return
    }
    if (!node || typeof node !== "object") return
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      walk(value, key)
    }
  }

  for (const payload of payloads) walk(payload, null)
  return out
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

function asBool(value: unknown): boolean | null {
  if (typeof value === "boolean") return value
  return null
}

function asText(value: unknown): string | null {
  if (typeof value !== "string") return null
  const t = value.trim()
  return t || null
}

function yearFromUnknown(value: unknown): number | null {
  const n = asPositive(value)
  if (n == null) return null
  const y = Math.round(n)
  if (y < 1700 || y > 2100) return null
  return y
}

function dateOnly(value: unknown): string | null {
  const text = asText(value)
  if (!text) return null
  const iso = text.slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : null
}

function propertyRow(payload: unknown): Record<string, unknown> | null {
  if (Array.isArray(payload) && payload[0] && typeof payload[0] === "object") {
    return payload[0] as Record<string, unknown>
  }
  if (payload && typeof payload === "object") return payload as Record<string, unknown>
  return null
}

function latestYearEntry(
  bag: unknown,
  valueKey: "total" | "value",
): { year: number; amount: number } | null {
  if (!bag || typeof bag !== "object" || Array.isArray(bag)) return null
  let best: { year: number; amount: number } | null = null
  for (const [key, entry] of Object.entries(bag as Record<string, unknown>)) {
    const year = Number.parseInt(key, 10)
    if (!Number.isFinite(year)) continue
    const row = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : {}
    const amount = asPositive(row[valueKey]) ?? asPositive(row.total) ?? asPositive(row.value)
    if (amount == null) continue
    if (!best || year > best.year) best = { year, amount }
  }
  return best
}

function pickLatLng(...sources: unknown[]): { latitude: number | null; longitude: number | null } {
  const rows: unknown[] = []
  for (const source of sources) {
    if (Array.isArray(source)) rows.push(...source)
    else if (source != null) rows.push(source)
  }
  for (const source of rows) {
    const row = propertyRow(source)
    if (!row) continue
    const nested =
      row.address && typeof row.address === "object" && !Array.isArray(row.address)
        ? (row.address as Record<string, unknown>)
        : {}
    const latitude =
      asNum(row.latitude) ?? asNum(row.lat) ?? asNum(nested.latitude) ?? asNum(nested.lat)
    const longitude =
      asNum(row.longitude) ??
      asNum(row.lng) ??
      asNum(row.lon) ??
      asNum(nested.longitude) ??
      asNum(nested.lng) ??
      asNum(nested.lon)
    if (
      latitude != null &&
      longitude != null &&
      Math.abs(latitude) <= 90 &&
      Math.abs(longitude) <= 180
    ) {
      return { latitude, longitude }
    }
  }
  return { latitude: null, longitude: null }
}

function amenityLabel(has: boolean | null, type: string | null): string | null {
  if (type) return type
  if (has === true) return "Yes"
  if (has === false) return "None"
  return null
}

export function parseRentCastAvmRent(payload: unknown): {
  rent: number | null
  low: number | null
  high: number | null
} {
  if (!payload || typeof payload !== "object") {
    return { rent: null, low: null, high: null }
  }
  const row = payload as Record<string, unknown>
  const rent = asPositive(row.rent) ?? asPositive(row.price)
  return {
    rent: rent != null ? Math.round(rent) : null,
    low: asPositive(row.rentRangeLow) ?? asPositive(row.priceRangeLow),
    high: asPositive(row.rentRangeHigh) ?? asPositive(row.priceRangeHigh),
  }
}

export function parseRentCastAvmValue(payload: unknown): {
  value: number | null
  low: number | null
  high: number | null
} {
  if (!payload || typeof payload !== "object") {
    return { value: null, low: null, high: null }
  }
  const row = payload as Record<string, unknown>
  const value = asPositive(row.price) ?? asPositive(row.value)
  return {
    value: value != null ? Math.round(value) : null,
    low: asPositive(row.priceRangeLow) ?? asPositive(row.low),
    high: asPositive(row.priceRangeHigh) ?? asPositive(row.high),
  }
}

export function parseRentCastPropertyRecord(payload: unknown): {
  recordId: string | null
  facts: HomeDataFacts
} {
  const facts = emptyHomeDataFacts()
  const row = propertyRow(payload)
  if (!row) return { recordId: null, facts }

  const features =
    row.features && typeof row.features === "object"
      ? (row.features as Record<string, unknown>)
      : {}

  const hasGarage = asBool(features.garage)
  const hasPool = asBool(features.pool)
  const hasHeat = asBool(features.heating)
  const hasCool = asBool(features.cooling)
  const tax = latestYearEntry(row.propertyTaxes, "total")
  const assessment = latestYearEntry(row.taxAssessments, "value")

  facts.propertyType = asText(row.propertyType)
  facts.bedrooms = asNum(row.bedrooms)
  facts.bathrooms = asNum(row.bathrooms)
  facts.livingAreaSqft = asPositive(row.squareFootage)
  facts.lotSizeSqft = asPositive(row.lotSize)
  facts.yearBuilt = yearFromUnknown(row.yearBuilt) ?? yearFromUnknown(row.year_built)
  facts.unitCount = asPositive(features.unitCount) ?? asPositive(row.unitCount)
  facts.hasGarage = hasGarage
  facts.garageSpaces = asPositive(features.garageSpaces)
  facts.garageType = asText(features.garageType)
  facts.hasPool = hasPool
  facts.poolType = asText(features.poolType)
  facts.heating = amenityLabel(hasHeat, asText(features.heatingType))
  facts.cooling = amenityLabel(hasCool, asText(features.coolingType))
  facts.lastSalePrice = asPositive(row.lastSalePrice)
  facts.lastSaleDate = dateOnly(row.lastSaleDate)
  facts.taxYear = tax?.year ?? assessment?.year ?? null
  facts.propertyTaxAnnual = tax?.amount ?? null
  facts.assessedValue = assessment?.amount ?? null

  const coords = pickLatLng(row, payload)
  facts.latitude = coords.latitude
  facts.longitude = coords.longitude
  facts.photoUrls = collectPhotoUrls(payload)

  return {
    recordId: asText(row.id),
    facts,
  }
}

export function mergeRentCastHomeData(input: {
  property: unknown
  avmValue: unknown
  avmRent?: unknown
  saleListings?: unknown
  rentalListings?: unknown
}): RentCastHomeDataResult {
  const parsed = parseRentCastPropertyRecord(input.property)
  const avm = parseRentCastAvmValue(input.avmValue)
  const rent = parseRentCastAvmRent(input.avmRent)
  const photoUrls = collectPhotoUrls(
    input.property,
    input.avmValue,
    input.avmRent,
    input.saleListings,
    input.rentalListings,
  )
  const coords = pickLatLng(
    input.property,
    input.avmValue,
    input.avmRent,
    input.saleListings,
    input.rentalListings,
  )
  return {
    provider: "rentcast",
    providerRecordId: parsed.recordId,
    facts: {
      ...parsed.facts,
      estimatedValue: avm.value,
      estimatedValueLow: avm.low != null ? Math.round(avm.low) : null,
      estimatedValueHigh: avm.high != null ? Math.round(avm.high) : null,
      estimatedRent: rent.rent,
      estimatedRentLow: rent.low != null ? Math.round(rent.low) : null,
      estimatedRentHigh: rent.high != null ? Math.round(rent.high) : null,
      latitude: parsed.facts.latitude ?? coords.latitude,
      longitude: parsed.facts.longitude ?? coords.longitude,
      photoUrls,
    },
    raw: {
      property: input.property,
      avmValue: input.avmValue,
      avmRent: input.avmRent ?? null,
      saleListings: input.saleListings ?? null,
      rentalListings: input.rentalListings ?? null,
    },
  }
}

async function rentcastGet(
  apiKey: string,
  path: string,
  params: Record<string, string>,
): Promise<unknown | null> {
  const url = new URL(`https://api.rentcast.io${path}`)
  for (const [k, v] of Object.entries(params)) {
    if (v) url.searchParams.set(k, v)
  }
  const res = await fetch(url, {
    headers: { Accept: "application/json", "X-Api-Key": apiKey },
  })
  const text = await res.text().catch(() => "")
  if (!res.ok) {
    console.warn("[home-data-graph/rentcast]", res.status, path, text.slice(0, 180))
    return null
  }
  try {
    return text ? JSON.parse(text) : null
  } catch {
    return null
  }
}

export async function fetchRentCastHomeData(input: {
  address: string
  apiKey: string
}): Promise<RentCastHomeDataResult> {
  const empty: RentCastHomeDataResult = {
    provider: "rentcast",
    providerRecordId: null,
    facts: emptyHomeDataFacts(),
    raw: { property: null, avmValue: null, avmRent: null, saleListings: null, rentalListings: null },
  }
  const key = input.apiKey.trim()
  const address = input.address.trim()
  if (!key || !address) return empty

  const [property, avmValue, avmRent, saleListings, rentalListings] = await Promise.all([
    rentcastGet(key, "/v1/properties", { address }),
    rentcastGet(key, "/v1/avm/value", { address }),
    rentcastGet(key, "/v1/avm/rent/long-term", { address, compCount: "5" }),
    rentcastGet(key, "/v1/listings/sale", { address, limit: "5" }),
    rentcastGet(key, "/v1/listings/rental/long-term", { address, limit: "5" }),
  ])
  return mergeRentCastHomeData({ property, avmValue, avmRent, saleListings, rentalListings })
}
