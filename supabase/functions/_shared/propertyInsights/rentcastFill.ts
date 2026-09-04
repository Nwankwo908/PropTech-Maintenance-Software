/** RentCast property record + AVM for Overview stats. */

export type RentCastFill = {
  yearBuilt: number | null
  homeValue: number | null
  rentEstimate: number | null
  rentLow: number | null
  rentHigh: number | null
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

function propertyRow(payload: unknown): Record<string, unknown> | null {
  if (Array.isArray(payload) && payload[0] && typeof payload[0] === "object") {
    return payload[0] as Record<string, unknown>
  }
  if (payload && typeof payload === "object") return payload as Record<string, unknown>
  return null
}

export function parseRentCastProperty(payload: unknown): Pick<
  RentCastFill,
  "yearBuilt" | "latitude" | "longitude"
> {
  const row = propertyRow(payload)
  if (!row) return { yearBuilt: null, latitude: null, longitude: null }
  const latitude = asNum(row.latitude)
  const longitude = asNum(row.longitude)
  return {
    yearBuilt: yearFromUnknown(row.yearBuilt) ?? yearFromUnknown(row.year_built),
    latitude: latitude != null && Math.abs(latitude) <= 90 ? latitude : null,
    longitude: longitude != null && Math.abs(longitude) <= 180 ? longitude : null,
  }
}

export function parseRentCastValueAvm(payload: unknown): number | null {
  if (!payload || typeof payload !== "object") return null
  const row = payload as Record<string, unknown>
  const v = asPositive(row.price) ?? asPositive(row.value)
  return v != null ? Math.round(v) : null
}

export function parseRentCastRentAvm(payload: unknown): {
  rent: number | null
  low: number | null
  high: number | null
} {
  if (!payload || typeof payload !== "object") return { rent: null, low: null, high: null }
  const row = payload as Record<string, unknown>
  const rent = asPositive(row.rent)
  return {
    rent: rent != null ? Math.round(rent) : null,
    low: asPositive(row.rentRangeLow),
    high: asPositive(row.rentRangeHigh),
  }
}

async function rentcastGet(apiKey: string, path: string, params: Record<string, string>): Promise<unknown | null> {
  const url = new URL(`https://api.rentcast.io${path}`)
  for (const [k, v] of Object.entries(params)) {
    if (v) url.searchParams.set(k, v)
  }
  const res = await fetch(url, {
    headers: { Accept: "application/json", "X-Api-Key": apiKey },
  })
  const text = await res.text().catch(() => "")
  if (!res.ok) {
    console.warn("[property-insights/rentcast]", res.status, path, text.slice(0, 180))
    return null
  }
  try {
    return text ? JSON.parse(text) : null
  } catch {
    return null
  }
}

export async function loadRentCastFill(input: {
  address: string
  apiKey: string
}): Promise<RentCastFill> {
  const empty: RentCastFill = {
    yearBuilt: null,
    homeValue: null,
    rentEstimate: null,
    rentLow: null,
    rentHigh: null,
    latitude: null,
    longitude: null,
  }
  const key = input.apiKey.trim()
  if (!key) return empty

  const [property, value, rent] = await Promise.all([
    rentcastGet(key, "/v1/properties", { address: input.address }),
    rentcastGet(key, "/v1/avm/value", { address: input.address }),
    rentcastGet(key, "/v1/avm/rent/long-term", { address: input.address, compCount: "1" }),
  ])
  const parsed = parseRentCastProperty(property)
  const rentAvm = parseRentCastRentAvm(rent)
  return {
    yearBuilt: parsed.yearBuilt,
    homeValue: parseRentCastValueAvm(value),
    rentEstimate: rentAvm.rent,
    rentLow: rentAvm.low,
    rentHigh: rentAvm.high,
    latitude: parsed.latitude,
    longitude: parsed.longitude,
  }
}
