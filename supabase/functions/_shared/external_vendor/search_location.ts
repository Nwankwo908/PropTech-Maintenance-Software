import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import {
  formatPropertyAddressLine,
  formatPropertyCityStateZip,
  loadLandlordPropertyRecords,
  matchPropertyByName,
} from "../ask_ulo/tools/properties/propertyRecords.ts"
import { formatLocationWithOptionalUnit } from "../properties/unitLabelDisplay.ts"

export type ResolvedVendorSearchContext = {
  searchLocation: string
  locationLabel: string
  /** City, State ZIP for the rail header — never a street address. */
  areaLabel: string | null
}

function pickOnboardingDraftProperty(
  building: string,
  draftState: unknown,
): { addressLine: string | null; areaLabel: string | null } | null {
  if (!building.trim() || !draftState || typeof draftState !== "object") return null
  const props = (draftState as Record<string, unknown>).properties
  if (!Array.isArray(props)) return null

  const target = building.trim().toLowerCase()
  for (const raw of props) {
    if (!raw || typeof raw !== "object") continue
    const row = raw as Record<string, unknown>
    const name = typeof row.name === "string" ? row.name.trim() : ""
    if (!name || name.toLowerCase() !== target) continue

    const city = typeof row.city === "string" ? row.city.trim() : ""
    const state = typeof row.state === "string" ? row.state.trim() : ""
    const zipCode = typeof row.zipCode === "string" ? row.zipCode.trim() : ""
    const parts = [
      typeof row.streetAddress === "string" ? row.streetAddress.trim() : "",
      [city, state].filter(Boolean).join(", "),
      zipCode,
    ].filter(Boolean)
    return {
      addressLine: parts.length > 0 ? parts.join(" ") : null,
      areaLabel: formatPropertyCityStateZip({ city, state, zipCode }),
    }
  }
  return null
}

const US_STATE_RE =
  /\b(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC)\b/

const US_STATE_NAMES: Record<string, string> = {
  alabama: "AL",
  alaska: "AK",
  arizona: "AZ",
  arkansas: "AR",
  california: "CA",
  colorado: "CO",
  connecticut: "CT",
  delaware: "DE",
  florida: "FL",
  georgia: "GA",
  hawaii: "HI",
  idaho: "ID",
  illinois: "IL",
  indiana: "IN",
  iowa: "IA",
  kansas: "KS",
  kentucky: "KY",
  louisiana: "LA",
  maine: "ME",
  maryland: "MD",
  massachusetts: "MA",
  michigan: "MI",
  minnesota: "MN",
  mississippi: "MS",
  missouri: "MO",
  montana: "MT",
  nebraska: "NE",
  nevada: "NV",
  "new hampshire": "NH",
  "new jersey": "NJ",
  "new mexico": "NM",
  "new york": "NY",
  "north carolina": "NC",
  "north dakota": "ND",
  ohio: "OH",
  oklahoma: "OK",
  oregon: "OR",
  pennsylvania: "PA",
  "rhode island": "RI",
  "south carolina": "SC",
  "south dakota": "SD",
  tennessee: "TN",
  texas: "TX",
  utah: "UT",
  vermont: "VT",
  virginia: "VA",
  washington: "WA",
  "west virginia": "WV",
  wisconsin: "WI",
  wyoming: "WY",
  "district of columbia": "DC",
}

/** Two-letter state from an address or "City, ST ZIP" label. */
export function usStateFromLocation(value: string | null | undefined): string | null {
  const text = String(value ?? "").trim()
  if (!text) return null
  const upper = text.toUpperCase()
  const trailing = upper.match(
    /,\s*(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC)\b/,
  )
  if (trailing?.[1]) return trailing[1]
  const withZip = upper.match(
    /\b(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC)\s+\d{5}\b/,
  )
  if (withZip?.[1]) return withZip[1]
  const lower = text.toLowerCase()
  const named = Object.keys(US_STATE_NAMES)
    .sort((a, b) => b.length - a.length)
    .find((name) => lower.includes(name))
  if (named) return US_STATE_NAMES[named]
  const match = upper.match(US_STATE_RE)
  return match?.[1] ?? null
}

/** Keep a vendor when its address is in the property's state. Unknown addresses stay. */
export function vendorAddressMatchesSearchState(
  address: string | null | undefined,
  searchLocation: string | null | undefined,
): boolean {
  const want = usStateFromLocation(searchLocation)
  if (!want) return true
  const got = usStateFromLocation(address)
  if (!got) return true
  return got === want
}

/** Exact name or street. A short name must not steal a different property's address. */
export function matchPropertyForVendorSearch<T extends { name: string; streetAddress?: string | null }>(
  records: readonly T[],
  building: string,
): T | null {
  const q = building.trim().toLowerCase()
  if (q.length < 4) return null
  const exactStreet = records.find((r) => (r.streetAddress ?? "").trim().toLowerCase() === q)
  if (exactStreet) return exactStreet
  const exactName = records.find((r) => r.name.trim().toLowerCase() === q)
  if (exactName) return exactName
  return records.find((r) => {
    const street = (r.streetAddress ?? "").trim().toLowerCase()
    return street.length >= 8 && (q.startsWith(`${street} `) || q.startsWith(`${street},`))
  }) ?? null
}

async function propertyRecordForBuilding(
  supabase: SupabaseClient,
  landlordId: string,
  building: string,
) {
  const records = await loadLandlordPropertyRecords(supabase, landlordId)
  return matchPropertyForVendorSearch(records, building)
}

export async function propertyIdMatchingVendorBuilding(
  supabase: SupabaseClient,
  landlordId: string,
  building: string,
): Promise<string | null> {
  const matched = await propertyRecordForBuilding(supabase, landlordId, building)
  return matched?.id?.trim() || null
}

async function propertyRecordById(
  supabase: SupabaseClient,
  propertyId: string,
  landlordId: string | null,
) {
  const id = propertyId.trim()
  if (!id) return null
  if (landlordId?.trim()) {
    const records = await loadLandlordPropertyRecords(supabase, landlordId.trim())
    const hit = records.find((r) => r.id === id)
    if (hit) return hit
  }
  const { data, error } = await supabase
    .from("properties")
    .select(
      "id, name, street_address, city, state, zip_code, property_type, year_built, unit_count, latitude, longitude, landlord_id",
    )
    .eq("id", id)
    .maybeSingle()
  if (error || !data) return null
  const owner = typeof data.landlord_id === "string" ? data.landlord_id.trim() : ""
  if (!owner) return null
  const records = await loadLandlordPropertyRecords(supabase, owner)
  return records.find((r) => r.id === id) ?? null
}

export function formatVendorSetupLocationLabel(
  unit: string,
  building: string,
  propertyType?: string | null,
): string {
  const label = formatLocationWithOptionalUnit({
    propertyLabel: building,
    unitLabel: unit,
    propertyType,
  })
  return label || "Property"
}

function looksGeocodable(value: string): boolean {
  const v = value.trim()
  if (!v) return false
  if (/\b\d{5}(?:-\d{4})?\b/.test(v)) return true
  if (v.includes(",") && /\d/.test(v)) return true
  return false
}

type ZipLookup =
  | { status: "match" | "mismatch"; state: string | null; zip: string | null }
  | { status: "unknown" }

function fiveDigitZip(value: string | null | undefined): string {
  return String(value ?? "").match(/\d{5}/)?.[0] ?? ""
}

async function readZippopotam(
  url: string,
  fetchFn: typeof fetch,
): Promise<ZipLookup> {
  try {
    const res = await fetchFn(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(4000),
    })
    if (res.status === 404) return { status: "mismatch", state: null, zip: null }
    if (!res.ok) return { status: "unknown" }
    const body = await res.json() as Record<string, unknown>
    const places = Array.isArray(body.places) ? body.places : []
    const place = places[0] && typeof places[0] === "object"
      ? places[0] as Record<string, unknown>
      : null
    const state = typeof place?.["state abbreviation"] === "string"
      ? place["state abbreviation"].trim().toUpperCase()
      : ""
    const zip = fiveDigitZip(typeof place?.["post code"] === "string" ? place["post code"] : "")
    if (!state && !zip) return { status: "mismatch", state: null, zip: null }
    return { status: state ? "match" : "mismatch", state: state || null, zip: zip || null }
  } catch {
    return { status: "unknown" }
  }
}

/**
 * Use the property ZIP only when it belongs to that state.
 * A Maryland city stored with a New Jersey ZIP must not be searched in New Jersey.
 */
export async function alignZipToPropertyState(
  input: { city?: string | null; state?: string | null; zipCode?: string | null },
  fetchFn: typeof fetch = fetch,
): Promise<string | null> {
  const state = (input.state ?? "").trim().toUpperCase()
  const city = (input.city ?? "").trim()
  const zip = fiveDigitZip(input.zipCode)
  if (state.length !== 2) return zip || null

  if (zip) {
    const looked = await readZippopotam(`https://api.zippopotam.us/us/${zip}`, fetchFn)
    if (looked.status === "unknown") return zip
    if (looked.status === "match" && looked.state === state) return zip
  }

  if (!city) return null
  const citySlug = encodeURIComponent(city.toLowerCase())
  const byCity = await readZippopotam(
    `https://api.zippopotam.us/us/${state.toLowerCase()}/${citySlug}`,
    fetchFn,
  )
  if (byCity.status === "match" || byCity.status === "mismatch") return byCity.zip
  return zip || null
}

function cityStateFromRecords(
  records: Awaited<ReturnType<typeof loadLandlordPropertyRecords>>,
): string | null {
  for (const record of records) {
    const city = record.city?.trim()
    const state = record.state?.trim()
    if (city && state) return `${city}, ${state}`
  }
  return null
}

/** Resolve a geocodable search anchor near the ticket property (not a bare unit label). */
export async function resolveExternalVendorSearchContext(
  supabase: SupabaseClient,
  input: {
    unit: string
    building: string | null
    landlordId: string | null
    /** Canonical properties.id — preferred over building-name match. */
    propertyId?: string | null
  },
): Promise<ResolvedVendorSearchContext> {
  const unit = input.unit.trim()
  const building = input.building?.trim() ?? ""
  const propertyId = input.propertyId?.trim() ?? ""
  let locationLabel = formatVendorSetupLocationLabel(unit, building)

  let addressLine: string | null = null
  let areaLabel: string | null = null

  // 1) Prefer the ticket's canonical property address (street / city / state / ZIP).
  if (propertyId) {
    const byId = await propertyRecordById(supabase, propertyId, input.landlordId)
    if (byId) {
      const aligned = { ...byId, zipCode: await alignZipToPropertyState(byId) }
      addressLine = formatPropertyAddressLine(aligned)
      areaLabel = formatPropertyCityStateZip(aligned)
      locationLabel = formatVendorSetupLocationLabel(
        unit,
        byId.name || building,
        byId.propertyType,
      )
    }
  }

  // 2) Fall back to live properties table by building name, then onboarding draft.
  if ((!addressLine || !areaLabel) && input.landlordId && building) {
    const matched = await propertyRecordForBuilding(supabase, input.landlordId, building)
    if (matched) {
      const aligned = { ...matched, zipCode: await alignZipToPropertyState(matched) }
      addressLine = addressLine ?? formatPropertyAddressLine(aligned)
      areaLabel = areaLabel ?? formatPropertyCityStateZip(aligned)
      if (!propertyId) {
        locationLabel = formatVendorSetupLocationLabel(
          unit,
          matched.name || building,
          matched.propertyType,
        )
      }
    }

    if (!addressLine || !areaLabel) {
      const { data } = await supabase
        .from("landlord_onboarding")
        .select("draft_state")
        .eq("landlord_id", input.landlordId)
        .maybeSingle()
      const fromDraft = pickOnboardingDraftProperty(building, data?.draft_state)
      addressLine = addressLine ?? fromDraft?.addressLine ?? null
      areaLabel = areaLabel ?? fromDraft?.areaLabel ?? null
    }
  }

  if (addressLine) {
    return { searchLocation: addressLine, locationLabel, areaLabel }
  }

  if (looksGeocodable(unit)) {
    return { searchLocation: unit, locationLabel, areaLabel }
  }

  if (building) {
    return { searchLocation: building, locationLabel, areaLabel }
  }

  const envLoc = Deno.env.get("EXTERNAL_VENDOR_SEARCH_LOCATION")?.trim() || ""
  if (envLoc) {
    return { searchLocation: envLoc, locationLabel, areaLabel }
  }

  return { searchLocation: unit || "United States", locationLabel, areaLabel }
}

/** Portfolio-level search anchor for Ask Ulo (no ticket). Prefers named building, then first geocodable property. */
export async function resolvePortfolioExternalSearchContext(
  supabase: SupabaseClient,
  input: {
    landlordId: string
    buildingFilter?: string | null
  },
): Promise<ResolvedVendorSearchContext> {
  const landlordId = input.landlordId.trim()
  const building = input.buildingFilter?.trim() ?? ""

  if (building) {
    return resolveExternalVendorSearchContext(supabase, {
      unit: "",
      building,
      landlordId: landlordId || null,
    })
  }

  if (landlordId) {
    const propertyRecords = await loadLandlordPropertyRecords(supabase, landlordId)

    const { data } = await supabase
      .from("landlord_onboarding")
      .select("draft_state")
      .eq("landlord_id", landlordId)
      .maybeSingle()

    const props = data?.draft_state && typeof data.draft_state === "object"
      ? (data.draft_state as Record<string, unknown>).properties
      : null
    if (Array.isArray(props)) {
      for (const raw of props) {
        if (!raw || typeof raw !== "object") continue
        const row = raw as Record<string, unknown>
        const name = typeof row.name === "string" ? row.name.trim() : ""
        const parts = [
          typeof row.streetAddress === "string" ? row.streetAddress.trim() : "",
          [row.city, row.state].filter((v) => typeof v === "string" && String(v).trim()).join(", "),
          typeof row.zipCode === "string" ? row.zipCode.trim() : "",
        ].filter(Boolean)
        const address = parts.join(" ")
        if (looksGeocodable(address)) {
          return {
            searchLocation: address,
            locationLabel: name || "Portfolio property",
            areaLabel: formatPropertyCityStateZip({
              city: typeof row.city === "string" ? row.city : null,
              state: typeof row.state === "string" ? row.state : null,
              zipCode: typeof row.zipCode === "string" ? row.zipCode : null,
            }),
          }
        }
      }
    }

    for (const record of propertyRecords) {
      const address = formatPropertyAddressLine(record)
      if (address && looksGeocodable(address)) {
        return {
          searchLocation: address,
          locationLabel: record.name || "Portfolio property",
          areaLabel: formatPropertyCityStateZip(record),
        }
      }
    }

    const { data: units } = await supabase
      .from("units")
      .select("building")
      .eq("landlord_id", landlordId)
      .not("building", "is", null)
      .limit(50)

    const seen = new Set<string>()
    for (const u of units ?? []) {
      const b = typeof u.building === "string" ? u.building.trim() : ""
      if (!b || seen.has(b)) continue
      seen.add(b)
      const matched = matchPropertyByName(propertyRecords, b)
      const address = matched ? formatPropertyAddressLine(matched) : null
      if (address && looksGeocodable(address)) {
        return {
          searchLocation: address,
          locationLabel: b,
          areaLabel: matched ? formatPropertyCityStateZip(matched) : null,
        }
      }
    }

    const cityState = cityStateFromRecords(propertyRecords)
    if (cityState) {
      return { searchLocation: cityState, locationLabel: "Portfolio area", areaLabel: cityState }
    }
  }

  const envLoc = Deno.env.get("EXTERNAL_VENDOR_SEARCH_LOCATION")?.trim() || ""
  if (envLoc) {
    return { searchLocation: envLoc, locationLabel: "Portfolio area", areaLabel: null }
  }

  return { searchLocation: "United States", locationLabel: "Portfolio area", areaLabel: null }
}
