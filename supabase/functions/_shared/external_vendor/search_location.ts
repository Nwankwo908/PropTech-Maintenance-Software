import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import {
  formatPropertyAddressLine,
  formatPropertyCityStateZip,
  loadLandlordPropertyRecords,
  matchPropertyByName,
} from "../ask_ulo/tools/properties/propertyRecords.ts"

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

async function propertyRecordForBuilding(
  supabase: SupabaseClient,
  landlordId: string,
  building: string,
) {
  const records = await loadLandlordPropertyRecords(supabase, landlordId)
  const byName = matchPropertyByName(records, building)
  if (byName) return byName
  const q = building.trim().toLowerCase()
  return records.find((r) => (r.streetAddress ?? "").trim().toLowerCase() === q) ?? null
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

export function formatVendorSetupLocationLabel(unit: string, building: string): string {
  const u = unit.trim()
  const b = building.trim()
  const unitPart = u.replace(/^unit\s+/i, "").trim() || u
  if (b && u) return `${b} · Unit ${unitPart}`
  if (b) return b
  if (u) return u.match(/^unit\b/i) ? u : `Unit ${u}`
  return "Property · Unit"
}

function looksGeocodable(value: string): boolean {
  const v = value.trim()
  if (!v) return false
  if (/\b\d{5}(?:-\d{4})?\b/.test(v)) return true
  if (v.includes(",") && /\d/.test(v)) return true
  return false
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
      addressLine = formatPropertyAddressLine(byId)
      areaLabel = formatPropertyCityStateZip(byId)
      if (byId.name && !building) {
        locationLabel = formatVendorSetupLocationLabel(unit, byId.name)
      } else if (byId.name && building && byId.name.toLowerCase() !== building.toLowerCase()) {
        locationLabel = formatVendorSetupLocationLabel(unit, byId.name)
      }
    }
  }

  // 2) Fall back to live properties table by building name, then onboarding draft.
  if ((!addressLine || !areaLabel) && input.landlordId && building) {
    const matched = await propertyRecordForBuilding(supabase, input.landlordId, building)
    if (matched) {
      addressLine = addressLine ?? formatPropertyAddressLine(matched)
      areaLabel = areaLabel ?? formatPropertyCityStateZip(matched)
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
