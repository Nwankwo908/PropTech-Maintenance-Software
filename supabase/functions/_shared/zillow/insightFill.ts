import {
  collectZillowPhotoUrls,
  fetchZillowJson,
  zillowAddressQueryVariants,
  zillowRapidApiHeaders,
  zillowRapidApiHosts,
} from "./propertyPhotos.ts"

export type ZillowInsightFill = {
  photos: string[]
  yearBuilt: number | null
  homeValue: number | null
  rentEstimate: number | null
  latitude: number | null
  longitude: number | null
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

function yearFromUnknown(value: unknown): number | null {
  const n = asPositive(value)
  if (n == null) return null
  const y = Math.round(n)
  if (y < 1700 || y > 2100) return null
  return y
}

export function parseZillowPropertyInsights(payload: unknown): ZillowInsightFill {
  const empty: ZillowInsightFill = {
    photos: [],
    yearBuilt: null,
    homeValue: null,
    rentEstimate: null,
    latitude: null,
    longitude: null,
  }
  if (!payload || typeof payload !== "object") return empty
  const row = payload as Record<string, unknown>
  const nested =
    (row.property && typeof row.property === "object" ? (row.property as Record<string, unknown>) : null) ??
    (row.data && typeof row.data === "object" ? (row.data as Record<string, unknown>) : null) ??
    row
  const reso = nested.resoFacts as Record<string, unknown> | undefined
  const lat = asNum(nested.latitude) ?? asNum(nested.lat)
  const lng = asNum(nested.longitude) ?? asNum(nested.lng)
  return {
    photos: collectZillowPhotoUrls(payload),
    yearBuilt:
      yearFromUnknown(reso?.yearBuilt) ??
      yearFromUnknown(nested.yearBuilt) ??
      yearFromUnknown(nested.year_built),
    homeValue:
      asPositive(nested.zestimate) ??
      asPositive(nested.price) ??
      asPositive((nested.zestimate as Record<string, unknown> | undefined)?.value),
    rentEstimate: asPositive(nested.rentZestimate) ?? asPositive(nested.rentzestimate),
    latitude: lat != null && Math.abs(lat) <= 90 ? lat : null,
    longitude: lng != null && Math.abs(lng) <= 180 ? lng : null,
  }
}

export async function loadZillowInsightFill(input: {
  address: string
  apiKey: string
  host?: string | null
}): Promise<ZillowInsightFill> {
  const empty: ZillowInsightFill = {
    photos: [],
    yearBuilt: null,
    homeValue: null,
    rentEstimate: null,
    latitude: null,
    longitude: null,
  }
  const apiKey = input.apiKey.trim()
  if (!apiKey) return empty
  const host = zillowRapidApiHosts(input.host)[0]
  const headers = zillowRapidApiHeaders(apiKey, host)
  const queries = zillowAddressQueryVariants(input.address)
  const q =
    queries.find((addr) => (addr.match(/,/g) ?? []).length >= 2) ??
    queries.find((addr) => addr.includes(",")) ??
    queries[0]
  if (!q) return empty

  const url = new URL(`https://${host}/property`)
  url.searchParams.set("address", q)
  const res = await fetchZillowJson(url.toString(), headers)
  if (res.blocked || !res.json) return empty
  return parseZillowPropertyInsights(res.json)
}
