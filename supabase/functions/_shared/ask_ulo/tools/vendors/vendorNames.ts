/**
 * Resolve display names for landlord vendors (canonical column is `name`).
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"

export function vendorDisplayName(row: {
  name?: string | null
  business_name?: string | null
  company_name?: string | null
}): string | null {
  const candidates = [row.business_name, row.company_name, row.name]
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim()
  }
  return null
}

/**
 * Load vendor display names by id. Uses `name` (vendors table schema) — do not
 * select non-existent columns or PostgREST returns an empty error result.
 */
export async function loadVendorNameById(
  supabase: SupabaseClient,
  input: { landlordId?: string | null; vendorIds: string[] },
): Promise<Map<string, string>> {
  const nameById = new Map<string, string>()
  const landlordId = input.landlordId?.trim() || null
  const ids = [...new Set(input.vendorIds.filter(Boolean))]
  if (ids.length === 0) return nameById

  let query = supabase.from("vendors").select("id, name").in("id", ids)
  if (landlordId) query = query.eq("landlord_id", landlordId)

  const { data, error } = await query

  if (error) {
    console.error("[ask_ulo/vendorNames]", error.message)
    return nameById
  }

  for (const v of data ?? []) {
    if (typeof v.id !== "string") continue
    const name = vendorDisplayName(v)
    if (name) nameById.set(v.id, name)
  }

  return nameById
}
