/**
 * Resolve property address fields — properties table first, then fallbacks.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"

export type PropertyLocationFields = {
  streetAddress: string | null
  city: string | null
  state: string | null
  zipCode: string | null
}

type PropertyRow = {
  street_address?: string | null
  city?: string | null
  state?: string | null
  zip_code?: string | null
}

function trimOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function applyPropertyRow(
  target: PropertyLocationFields,
  row: PropertyRow | null | undefined,
): void {
  if (!row) return
  const street = trimOrNull(row.street_address)
  const city = trimOrNull(row.city)
  const state = trimOrNull(row.state)
  const zip = trimOrNull(row.zip_code)
  if (street) target.streetAddress = street
  if (city) target.city = city
  if (state) target.state = state
  if (zip) target.zipCode = zip
}

/** Load address from canonical properties row by id or building name. */
export async function loadPropertyLocationFromTable(
  supabase: SupabaseClient,
  landlordId: string,
  opts: { propertyId?: string | null; building?: string | null },
): Promise<PropertyLocationFields | null> {
  if (opts.propertyId?.trim()) {
    const { data } = await supabase
      .from("properties")
      .select("street_address, city, state, zip_code")
      .eq("id", opts.propertyId.trim())
      .eq("landlord_id", landlordId)
      .maybeSingle()
    if (data) {
      const out: PropertyLocationFields = {
        streetAddress: null,
        city: null,
        state: null,
        zipCode: null,
      }
      applyPropertyRow(out, data as PropertyRow)
      if (out.streetAddress || out.city || out.state || out.zipCode) return out
    }
  }

  const building = trimOrNull(opts.building)
  if (!building) return null

  const { data } = await supabase
    .from("properties")
    .select("street_address, city, state, zip_code")
    .eq("landlord_id", landlordId)
    .ilike("name", building)
    .limit(1)
    .maybeSingle()

  if (!data) return null

  const out: PropertyLocationFields = {
    streetAddress: null,
    city: null,
    state: null,
    zipCode: null,
  }
  applyPropertyRow(out, data as PropertyRow)
  return out.streetAddress || out.city || out.state || out.zipCode ? out : null
}

/** Onboarding JSON fallback — matched by building name. */
export function loadPropertyLocationFromOnboarding(
  properties: unknown,
  building: string | null,
): PropertyLocationFields | null {
  if (!building?.trim() || !Array.isArray(properties)) return null
  const buildingLc = building.trim().toLowerCase()
  const match = properties.find((raw) => {
    if (!raw || typeof raw !== "object") return false
    const row = raw as Record<string, unknown>
    const name = typeof row.name === "string" ? row.name.trim().toLowerCase() : ""
    return Boolean(name && name === buildingLc)
  }) as Record<string, unknown> | undefined

  if (!match) return null

  const street =
    typeof match.streetAddress === "string"
      ? match.streetAddress.trim()
      : typeof match.address === "string"
        ? match.address.trim()
        : ""

  const out: PropertyLocationFields = {
    streetAddress: street || null,
    city: trimOrNull(match.city),
    state: trimOrNull(match.state),
    zipCode: trimOrNull(match.zipCode) ?? trimOrNull(match.zip_code),
  }

  return out.streetAddress || out.city || out.state || out.zipCode ? out : null
}

/** properties table → onboarding JSON (legacy). */
export async function resolvePropertyLocation(
  supabase: SupabaseClient,
  landlordId: string,
  opts: {
    propertyId?: string | null
    building?: string | null
    onboardingProperties?: unknown
  },
): Promise<PropertyLocationFields> {
  const fromTable = await loadPropertyLocationFromTable(supabase, landlordId, opts)
  if (fromTable) return fromTable

  const fromOnboarding = loadPropertyLocationFromOnboarding(
    opts.onboardingProperties,
    opts.building ?? null,
  )
  if (fromOnboarding) return fromOnboarding

  return { streetAddress: null, city: null, state: null, zipCode: null }
}
