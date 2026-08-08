import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import {
  formatPropertyAddressLine,
  loadLandlordPropertyRecords,
  matchPropertyByName,
} from "../ask_ulo/tools/properties/propertyRecords.ts"

export type ResolvedVendorSearchContext = {
  searchLocation: string
  locationLabel: string
}

function pickAddressFromOnboardingDraft(
  building: string,
  draftState: unknown,
): string | null {
  if (!building.trim() || !draftState || typeof draftState !== "object") return null
  const props = (draftState as Record<string, unknown>).properties
  if (!Array.isArray(props)) return null

  const target = building.trim().toLowerCase()
  for (const raw of props) {
    if (!raw || typeof raw !== "object") continue
    const row = raw as Record<string, unknown>
    const name = typeof row.name === "string" ? row.name.trim() : ""
    if (!name || name.toLowerCase() !== target) continue

    const parts = [
      typeof row.streetAddress === "string" ? row.streetAddress.trim() : "",
      [row.city, row.state].filter((v) => typeof v === "string" && v.trim()).join(", "),
      typeof row.zipCode === "string" ? row.zipCode.trim() : "",
    ].filter(Boolean)
    if (parts.length > 0) return parts.join(" ")
  }
  return null
}

async function propertyAddressForBuilding(
  supabase: SupabaseClient,
  landlordId: string,
  building: string,
): Promise<string | null> {
  const records = await loadLandlordPropertyRecords(supabase, landlordId)
  const matched = matchPropertyByName(records, building)
  if (!matched) return null
  return formatPropertyAddressLine(matched)
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
  },
): Promise<ResolvedVendorSearchContext> {
  const unit = input.unit.trim()
  const building = input.building?.trim() ?? ""
  const locationLabel = formatVendorSetupLocationLabel(unit, building)

  let addressLine: string | null = null

  if (input.landlordId && building) {
    const { data } = await supabase
      .from("landlord_onboarding")
      .select("draft_state")
      .eq("landlord_id", input.landlordId)
      .maybeSingle()
    addressLine = pickAddressFromOnboardingDraft(building, data?.draft_state)

    if (!addressLine) {
      addressLine = await propertyAddressForBuilding(supabase, input.landlordId, building)
    }
  }

  if (addressLine) {
    return { searchLocation: addressLine, locationLabel }
  }

  if (looksGeocodable(unit)) {
    return { searchLocation: unit, locationLabel }
  }

  if (building) {
    return { searchLocation: building, locationLabel }
  }

  const envLoc = Deno.env.get("EXTERNAL_VENDOR_SEARCH_LOCATION")?.trim() || ""
  if (envLoc) {
    return { searchLocation: envLoc, locationLabel }
  }

  return { searchLocation: unit || "United States", locationLabel }
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
        return { searchLocation: address, locationLabel: b }
      }
    }

    const cityState = cityStateFromRecords(propertyRecords)
    if (cityState) {
      return { searchLocation: cityState, locationLabel: "Portfolio area" }
    }
  }

  const envLoc = Deno.env.get("EXTERNAL_VENDOR_SEARCH_LOCATION")?.trim() || ""
  if (envLoc) {
    return { searchLocation: envLoc, locationLabel: "Portfolio area" }
  }

  return { searchLocation: "United States", locationLabel: "Portfolio area" }
}
