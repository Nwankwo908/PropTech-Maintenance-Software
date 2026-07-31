/**
 * Resolve / upsert canonical properties rows for Edge Functions.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"

export type EnsurePropertyParams = {
  landlordId: string
  name: string
  streetAddress?: string | null
  city?: string | null
  state?: string | null
  zipCode?: string | null
  propertyType?: string | null
  managerName?: string | null
  managerPhone?: string | null
  unitCount?: number | null
  yearBuilt?: number | null
}

/** Upsert properties by landlord + name; returns stable properties.id. */
export async function ensureProperty(
  supabase: SupabaseClient,
  params: EnsurePropertyParams,
): Promise<string | null> {
  const name = params.name.trim()
  if (!params.landlordId || !name) return null

  const { data, error } = await supabase.rpc("ensure_property", {
    p_landlord_id: params.landlordId,
    p_name: name,
    p_street_address: params.streetAddress?.trim() || null,
    p_city: params.city?.trim() || null,
    p_state: params.state?.trim() || null,
    p_zip_code: params.zipCode?.trim() || null,
    p_property_type: params.propertyType?.trim() || null,
    p_manager_name: params.managerName?.trim() || null,
    p_manager_phone: params.managerPhone?.trim() || null,
    p_unit_count: params.unitCount ?? null,
    p_year_built: params.yearBuilt ?? null,
  })

  if (error || data == null) {
    console.error("[ensure_property]", error)
    return null
  }
  return String(data)
}

/**
 * Resolve property_id for a unit / building.
 * Prefers units.property_id, then properties lookup, then ensure + derive.
 */
export async function resolvePropertyId(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    unitId?: string | null
    building?: string | null
    propertyId?: string | null
  },
): Promise<string | null> {
  if (params.propertyId?.trim()) return params.propertyId.trim()

  let building = params.building?.trim() || null
  let fromUnit: string | null = null

  if (params.unitId) {
    const { data: unit } = await supabase
      .from("units")
      .select("property_id, building")
      .eq("id", params.unitId)
      .maybeSingle()

    if (unit?.property_id) {
      fromUnit = String(unit.property_id)
    }
    if (!building && unit?.building != null) {
      building = String(unit.building)
    }
  }

  if (fromUnit) return fromUnit

  if (building) {
    const { data: prop } = await supabase
      .from("properties")
      .select("id")
      .eq("landlord_id", params.landlordId)
      .ilike("name", building)
      .limit(1)
      .maybeSingle()

    if (prop?.id) return String(prop.id)

    return await ensureProperty(supabase, {
      landlordId: params.landlordId,
      name: building,
    })
  }

  // Fallback: deterministic synthetic id (default building bucket).
  const { data, error } = await supabase.rpc("derive_property_id", {
    p_landlord_id: params.landlordId,
    p_building: "",
  })
  if (error || data == null) return null
  return String(data)
}
