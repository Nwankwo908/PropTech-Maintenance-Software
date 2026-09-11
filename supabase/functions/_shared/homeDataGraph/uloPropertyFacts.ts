/// <reference lib="deno.ns" />
/**
 * Ulo property-facts ingest for Overview (Home Value, highlights, facts).
 * Prefers Chocodata Zillow Scraper API; RapidAPI is a fallback.
 * Output is always HomeDataFacts — never vendor field names on the graph.
 */
import {
  emptyHomeDataFacts,
  homeDataHasFacts,
  type HomeDataFacts,
  type HomeDataIngestResult,
} from "../../../../shared/homeDataGraph.ts"
import { geocodeUsAddress } from "../weather/propertyOutdoorTemp.ts"
import {
  collectZillowPhotoUrls,
  fetchZillowJson,
  pickZillowZpid,
  zillowAddressQueryVariants,
  zillowRapidApiHeaders,
  zillowRapidApiHosts,
} from "../zillow/propertyPhotos.ts"
import {
  loadChocodataListing,
  mapChocodataPropertyToFacts,
} from "./chocodataZillow.ts"

export type UloPropertyFactsFetch =
  | { status: "ok"; ingest: HomeDataIngestResult }
  | { status: "not_configured"; error: string }

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

function asYear(value: unknown): number | null {
  const n = asPositive(value)
  if (n == null) return null
  const y = Math.round(n)
  if (y < 1700 || y > 2100) return null
  return y
}

function asText(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim()
  if (Array.isArray(value)) {
    const parts = value
      .map((item) => asText(item))
      .filter((item): item is string => Boolean(item))
    return parts.length ? parts.join(", ") : null
  }
  return null
}

function asBool(value: unknown): boolean | null {
  if (typeof value === "boolean") return value
  if (typeof value === "string") {
    const raw = value.trim().toLowerCase()
    if (raw === "true" || raw === "yes") return true
    if (raw === "false" || raw === "no" || raw === "none") return false
  }
  return null
}

function formatPropertyType(raw: string | null): string | null {
  if (!raw) return null
  const key = raw.trim().toUpperCase().replace(/[\s-]+/g, "_")
  const labels: Record<string, string> = {
    SINGLE_FAMILY: "Single Family",
    SINGLEFAMILY: "Single Family",
    MULTI_FAMILY: "Multi Family",
    MULTIFAMILY: "Multi Family",
    CONDO: "Condo",
    CONDOMINIUM: "Condo",
    TOWNHOUSE: "Townhouse",
    TOWNHOME: "Townhouse",
    APARTMENT: "Apartment",
    MANUFACTURED: "Manufactured",
    MOBILE: "Manufactured",
    LOT: "Lot",
    LAND: "Lot",
  }
  if (labels[key]) return labels[key]
  return raw
    .trim()
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (ch) => ch.toUpperCase())
}

function lotSizeToSqft(value: unknown, units: unknown): number | null {
  const n = asPositive(value)
  if (n == null) return null
  const unit = typeof units === "string" ? units.toLowerCase() : ""
  if (unit.includes("acre")) return Math.round(n * 43560)
  return Math.round(n)
}

function firstRecord(value: unknown): Record<string, unknown> | null {
  const rec = asRecord(value)
  if (rec) return rec
  if (Array.isArray(value) && value.length > 0) return asRecord(value[0])
  return null
}

function listingLooksUseful(row: Record<string, unknown>): boolean {
  return (
    row.zpid != null ||
    row.zestimate != null ||
    row.bedrooms != null ||
    row.livingArea != null ||
    row.livingAreaValue != null ||
    row.homeType != null ||
    row.resoFacts != null
  )
}

function listingRoot(payload: unknown, depth = 0): Record<string, unknown> | null {
  const row = asRecord(payload)
  if (!row || depth > 4) return row
  for (const key of ["property", "data", "result", "listing", "props", "results", "homes"]) {
    const nested = firstRecord(row[key])
    if (!nested) continue
    const deeper = listingRoot(nested, depth + 1) ?? nested
    if (listingLooksUseful(deeper)) return deeper
  }
  return row
}

function asIsoDate(value: unknown): string | null {
  const text = asText(value)
  if (!text) return null
  const ymd = text.match(/^(\d{4}-\d{2}-\d{2})/)
  if (ymd) return ymd[1]
  const parsed = new Date(text)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed.toISOString().slice(0, 10)
}

function lastSold(history: unknown): { price: number | null; date: string | null } {
  if (!Array.isArray(history)) return { price: null, date: null }
  for (const item of history) {
    const row = asRecord(item)
    if (!row) continue
    const event = asText(row.event) ?? asText(row.eventName) ?? ""
    if (!/sold/i.test(event)) continue
    const price = asPositive(row.price) ?? asPositive(row.amount)
    const date = asIsoDate(row.date) ?? asIsoDate(row.time) ?? asIsoDate(row.postingDate)
    return { price, date }
  }
  return { price: null, date: null }
}

function valueBand(mid: number | null, lowPct: unknown, highPct: unknown): {
  low: number | null
  high: number | null
} {
  if (mid == null) return { low: null, high: null }
  const lowP = asNonNeg(lowPct)
  const highP = asNonNeg(highPct)
  return {
    low: lowP != null ? Math.round(mid * (1 - lowP / 100)) : null,
    high: highP != null ? Math.round(mid * (1 + highP / 100)) : null,
  }
}

/** Map a RapidAPI `/property` (or similar) listing JSON into graph facts. */
export function mapListingPayloadToHomeDataFacts(payload: unknown): {
  facts: HomeDataFacts
  providerRecordId: string | null
} {
  const facts = emptyHomeDataFacts()
  const nested = listingRoot(payload)
  if (!nested) return { facts, providerRecordId: pickZillowZpid(payload) }
  const reso = asRecord(nested.resoFacts) ?? {}
  const zestObj = asRecord(nested.zestimate)

  const estimatedValue =
    asPositive(nested.zestimate) ??
    asPositive(zestObj?.value) ??
    asPositive(zestObj?.amount) ??
    asPositive(nested.price)
  const band = valueBand(
    estimatedValue,
    nested.zestimateLowPercent ?? zestObj?.lowPercent,
    nested.zestimateHighPercent ?? zestObj?.highPercent,
  )
  const sold = lastSold(nested.priceHistory)

  const lot =
    lotSizeToSqft(nested.lotSize, nested.lotAreaUnits) ??
    lotSizeToSqft(nested.lotAreaValue, nested.lotAreaUnits) ??
    lotSizeToSqft(reso.lotSize, reso.lotSizeUnits) ??
    lotSizeToSqft(reso.lotSizeSquareFeet, "sqft")

  const living =
    asPositive(nested.livingArea) ??
    asPositive(nested.livingAreaValue) ??
    asPositive(reso.livingArea) ??
    asPositive(reso.livingAreaValue)

  const garageSpaces =
    asNonNeg(nested.garageSpaces) ??
    asNonNeg(reso.garageSpaces) ??
    asNonNeg(reso.parkingCapacity)
  const hasGarage =
    asBool(nested.hasGarage) ??
    asBool(reso.hasGarage) ??
    (garageSpaces != null ? garageSpaces > 0 : null)

  const hasPool =
    asBool(nested.hasPool) ??
    asBool(reso.hasPrivatePool) ??
    asBool(reso.hasSpa) ??
    (asText(reso.poolFeatures) ? true : null)

  const taxAnnual = asPositive(reso.taxAnnualAmount) ?? asPositive(nested.taxAnnualAmount)
  const assessed =
    asPositive(nested.taxAssessedValue) ?? asPositive(reso.taxAssessedValue)
  const taxYear =
    asYear(nested.taxAssessedYear) ??
    asYear(reso.taxAssessedYear) ??
    asYear(nested.taxYear)

  const lat = asNum(nested.latitude) ?? asNum(nested.lat)
  const lng = asNum(nested.longitude) ?? asNum(nested.lng)

  const unitCount =
    asNonNeg(nested.unitCount) ??
    asNonNeg(reso.numberOfUnitsTotal) ??
    asNonNeg(reso.numberOfUnitsInCommunity)

  Object.assign(facts, {
    estimatedValue,
    estimatedValueLow: asPositive(nested.zestimateLow) ?? asPositive(zestObj?.low) ?? band.low,
    estimatedValueHigh: asPositive(nested.zestimateHigh) ?? asPositive(zestObj?.high) ?? band.high,
    estimatedRent: asPositive(nested.rentZestimate) ?? asPositive(nested.rentzestimate),
    estimatedRentLow: asPositive(nested.rentZestimateLow),
    estimatedRentHigh: asPositive(nested.rentZestimateHigh),
    propertyType: formatPropertyType(
      asText(nested.homeType) ?? asText(nested.propertyType) ?? asText(reso.propertySubType) ?? asText(reso.homeType),
    ),
    bedrooms: asNonNeg(nested.bedrooms) ?? asNonNeg(reso.bedrooms),
    bathrooms:
      asNonNeg(nested.bathrooms) ??
      asNonNeg(nested.bathroomsFloat) ??
      asNonNeg(reso.bathrooms),
    livingAreaSqft: living != null ? Math.round(living) : null,
    lotSizeSqft: lot,
    yearBuilt: asYear(reso.yearBuilt) ?? asYear(nested.yearBuilt) ?? asYear(nested.year_built),
    unitCount: unitCount != null ? Math.round(unitCount) : null,
    hasGarage,
    garageSpaces,
    garageType: asText(reso.parkingFeatures) ?? asText(nested.garageType),
    hasPool,
    poolType: asText(reso.poolFeatures) ?? asText(nested.poolType),
    heating: asText(reso.heating) ?? asText(nested.heating),
    cooling: asText(reso.cooling) ?? asText(nested.cooling),
    lastSalePrice: sold.price ?? asPositive(nested.lastSoldPrice),
    lastSaleDate: sold.date ?? asIsoDate(nested.lastSoldDate),
    taxYear,
    propertyTaxAnnual: taxAnnual,
    assessedValue: assessed,
    latitude: lat != null && Math.abs(lat) <= 90 ? lat : null,
    longitude: lng != null && Math.abs(lng) <= 180 ? lng : null,
    photoUrls: collectZillowPhotoUrls(payload),
  } satisfies Partial<HomeDataFacts>)

  return { facts, providerRecordId: pickZillowZpid(payload) ?? pickZillowZpid(nested) }
}

function listingScore(payload: unknown): number {
  const { facts } = mapListingPayloadToHomeDataFacts(payload)
  return [
    facts.estimatedValue,
    facts.estimatedRent,
    facts.bedrooms,
    facts.bathrooms,
    facts.livingAreaSqft,
    facts.yearBuilt,
    facts.propertyType,
    facts.photoUrls.length || null,
  ].filter((value) => value != null && value !== "").length
}

async function loadZillowListingJson(input: {
  address: string
  apiKey: string
  host?: string | null
}): Promise<unknown | null> {
  const queries = zillowAddressQueryVariants(input.address)
  const q =
    queries.find((addr) => (addr.match(/,/g) ?? []).length >= 2) ??
    queries.find((addr) => addr.includes(",")) ??
    queries[0]
  if (!q) return null

  const payloads: unknown[] = []
  for (const host of zillowRapidApiHosts(input.host)) {
    const headers = zillowRapidApiHeaders(input.apiKey, host)
    const get = async (path: string, params: Record<string, string>) => {
      const url = new URL(`https://${host}${path.startsWith("/") ? path : `/${path}`}`)
      for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
      return await fetchZillowJson(url.toString(), headers)
    }
    const before = payloads.length
    for (const res of [
      await get("/search_address", { address: q }),
      await get("/property", { address: q }),
    ]) {
      if (res.json) payloads.push(res.json)
    }
    const zpid = payloads.map((row) => pickZillowZpid(row)).find((id) => Boolean(id))
    if (zpid) {
      const byId = await get("/property", { zpid })
      if (byId.json) payloads.push(byId.json)
    }
    console.warn("[ulo-property-facts]", {
      host,
      newPayloads: payloads.length - before,
      totalPayloads: payloads.length,
    })
    if (payloads.some((row) => listingScore(row) > 0)) break
  }
  if (payloads.length === 0) return null
  return payloads.sort((a, b) => listingScore(b) - listingScore(a))[0] ?? null
}

export async function fetchUloPropertyFacts(input: {
  address: string
  zillowKey?: string | null
  zillowHost?: string | null
  chocodataKey?: string | null
  geocodeFn?: typeof geocodeUsAddress
}): Promise<UloPropertyFactsFetch> {
  const address = input.address.trim()
  if (!address) {
    return { status: "not_configured", error: "Missing address." }
  }

  const chocodataKey =
    input.chocodataKey?.trim() ?? Deno.env.get("CHOCODATA_API_KEY")?.trim() ?? ""
  const zillowKey = input.zillowKey?.trim() ?? Deno.env.get("ZILLOW_RAPIDAPI_KEY")?.trim() ?? ""
  const zillowHost = input.zillowHost ?? Deno.env.get("ZILLOW_RAPIDAPI_HOST")?.trim() ?? null
  const geocode = input.geocodeFn ?? geocodeUsAddress

  const [chocodata, listing, coords] = await Promise.all([
    chocodataKey ? loadChocodataListing({ address, apiKey: chocodataKey }) : Promise.resolve(null),
    !chocodataKey && zillowKey
      ? loadZillowListingJson({ address, apiKey: zillowKey, host: zillowHost })
      : Promise.resolve(null),
    geocode(address).catch(() => null),
  ])

  const mapped = chocodata
    ? mapChocodataPropertyToFacts(chocodata.payload, chocodata.searchHit)
    : listing
      ? mapListingPayloadToHomeDataFacts(listing)
      : { facts: emptyHomeDataFacts(), providerRecordId: null }
  const facts = { ...mapped.facts }
  if (facts.latitude == null && coords) facts.latitude = coords.lat
  if (facts.longitude == null && coords) facts.longitude = coords.lon

  if (!homeDataHasFacts(facts)) {
    if (!chocodataKey && !zillowKey) {
      return {
        status: "not_configured",
        error: "Property data isn’t connected (set CHOCODATA_API_KEY).",
      }
    }
    return {
      status: "ok",
      ingest: {
        provider: "ulo",
        providerRecordId: mapped.providerRecordId,
        facts,
        raw: chocodata?.payload ?? listing ?? { geocode: coords },
      },
    }
  }

  const ingest: HomeDataIngestResult = {
    provider: "ulo",
    providerRecordId: mapped.providerRecordId,
    facts,
    raw: chocodata?.payload ?? listing ?? { geocode: coords },
  }
  return { status: "ok", ingest }
}
