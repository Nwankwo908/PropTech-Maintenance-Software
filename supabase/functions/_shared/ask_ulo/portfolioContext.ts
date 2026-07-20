/**
 * Resolve landlord footprint → primary state_code / city for Ask Ulo jurisdiction filters.
 *
 * Source of truth priority (user input first — never invent geography):
 * 1. landlord_onboarding.properties (and draft_state.properties if present)
 * 2. units.city / units.state (persisted from onboarding)
 * 3. Demo building name map — only when no user locations exist (demo accounts)
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"

export type PortfolioLocationSource =
  | "onboarding_properties"
  | "units"
  | "demo_buildings"
  | "none"

export type PortfolioJurisdiction = {
  stateCode: string | null
  citySlug: string | null
  cityLabel: string | null
  buildingCount: number
  sampleBuildings: string[]
  /** How city/state were resolved — for logs / evals. */
  locationSource: PortfolioLocationSource
}

/** Demo OR buildings — used only when the landlord has no user-entered locations. */
export const DEMO_BUILDING_META: Record<string, { city: string; state: string }> = {
  "Oakwood Apartments": { city: "Portland", state: "OR" },
  "Pine Ridge": { city: "Portland", state: "OR" },
  "Cedar Court": { city: "Beaverton", state: "OR" },
  "Maple Heights": { city: "Hillsboro", state: "OR" },
  "Birch Tower": { city: "Portland", state: "OR" },
  "Willow Park": { city: "Gresham", state: "OR" },
}

export function slugifyCity(city: string): string {
  return city
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
}

export function parseStateCityFromAddress(
  address: string,
): { city: string; state: string } | null {
  // "812 Oakwood Ave, Portland, OR 97214"
  const m = address.match(/,\s*([^,]+),\s*([A-Z]{2})\b/i)
  if (!m) return null
  return { city: m[1].trim(), state: m[2].trim().toUpperCase() }
}

/** Collect city/state from onboarding property rows (top-level or draft). */
export function collectFromOnboardingProperties(
  properties: unknown,
): Array<{ city: string; state: string; name: string }> {
  if (!Array.isArray(properties)) return []
  const out: Array<{ city: string; state: string; name: string }> = []
  for (const raw of properties) {
    if (!raw || typeof raw !== "object") continue
    const row = raw as Record<string, unknown>
    const name = typeof row.name === "string" ? row.name.trim() : ""
    const city = typeof row.city === "string" ? row.city.trim() : ""
    const state = typeof row.state === "string" ? row.state.trim().toUpperCase() : ""
    if (city && state.length === 2) {
      out.push({ city, state, name: name || city })
      continue
    }
    const street =
      typeof row.streetAddress === "string"
        ? row.streetAddress
        : typeof row.address === "string"
          ? row.address
          : ""
    const zip = typeof row.zipCode === "string" ? row.zipCode : ""
    const parsed = parseStateCityFromAddress(
      [street, city, state, zip].filter(Boolean).join(", "),
    )
    if (parsed) out.push({ ...parsed, name: name || parsed.city })
  }
  return out
}

export function majorityJurisdiction(
  locations: Array<{ city: string; state: string }>,
): { stateCode: string | null; cityLabel: string | null; citySlug: string | null } {
  const stateCounts = new Map<string, number>()
  const cityCounts = new Map<string, { n: number; label: string; state: string }>()
  for (const loc of locations) {
    stateCounts.set(loc.state, (stateCounts.get(loc.state) ?? 0) + 1)
    const key = `${loc.state}:${loc.city.toLowerCase()}`
    const prev = cityCounts.get(key)
    cityCounts.set(key, {
      n: (prev?.n ?? 0) + 1,
      label: loc.city,
      state: loc.state,
    })
  }

  let stateCode: string | null = null
  let bestState = 0
  for (const [st, n] of stateCounts) {
    if (n > bestState) {
      bestState = n
      stateCode = st
    }
  }

  let cityLabel: string | null = null
  let citySlug: string | null = null
  let bestCity = 0
  for (const meta of cityCounts.values()) {
    if (stateCode && meta.state !== stateCode) continue
    if (meta.n > bestCity) {
      bestCity = meta.n
      cityLabel = meta.label
      citySlug = slugifyCity(meta.label)
    }
  }

  return { stateCode, cityLabel, citySlug }
}

/**
 * Resolve primary jurisdiction for legal/structured filters.
 * Never invents OR/Portland for landlords who entered their own city/state.
 */
export async function resolvePortfolioJurisdiction(
  supabase: SupabaseClient,
  landlordId: string,
): Promise<PortfolioJurisdiction> {
  const buildings = new Set<string>()
  const locations: Array<{ city: string; state: string }> = []
  let locationSource: PortfolioLocationSource = "none"

  const { data: onboarding } = await supabase
    .from("landlord_onboarding")
    .select("properties, draft_state")
    .eq("landlord_id", landlordId)
    .maybeSingle()

  // Primary: top-level properties column (where the wizard persists user input).
  for (const row of collectFromOnboardingProperties(onboarding?.properties)) {
    if (row.name) buildings.add(row.name)
    locations.push({ city: row.city, state: row.state })
  }
  // Fallback: older drafts that nested properties inside draft_state.
  const draft =
    onboarding?.draft_state && typeof onboarding.draft_state === "object"
      ? (onboarding.draft_state as Record<string, unknown>)
      : null
  for (const row of collectFromOnboardingProperties(draft?.properties)) {
    if (row.name) buildings.add(row.name)
    locations.push({ city: row.city, state: row.state })
  }
  if (locations.length > 0) locationSource = "onboarding_properties"

  const { data: units } = await supabase
    .from("units")
    .select("building, city, state")
    .eq("landlord_id", landlordId)
    .limit(200)

  for (const u of units ?? []) {
    const building = typeof u.building === "string" ? u.building.trim() : ""
    if (building) buildings.add(building)
    const city = typeof u.city === "string" ? u.city.trim() : ""
    const state = typeof u.state === "string" ? u.state.trim().toUpperCase() : ""
    if (city && state.length === 2) {
      locations.push({ city, state })
      if (locationSource === "none") locationSource = "units"
    }
  }

  // Demo building map only when this landlord has zero user-entered locations.
  if (locations.length === 0) {
    for (const building of buildings) {
      const demo = DEMO_BUILDING_META[building]
      if (demo) locations.push(demo)
    }
    if (locations.length > 0) locationSource = "demo_buildings"
  }

  const voted = majorityJurisdiction(locations)

  return {
    stateCode: voted.stateCode,
    citySlug: voted.citySlug,
    cityLabel: voted.cityLabel,
    buildingCount: buildings.size,
    sampleBuildings: [...buildings].slice(0, 8),
    locationSource,
  }
}
