/**
 * Canonical property records for Ask Ulo — loads from `properties` table.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"

export type AskUloPropertyRecord = {
  id: string
  name: string
  streetAddress: string | null
  city: string | null
  state: string | null
  zipCode: string | null
  propertyType: string | null
  yearBuilt: number | null
  unitCount: number | null
  latitude: number | null
  longitude: number | null
}

export type PropertyPlace = {
  name: string
  city: string
  state: string
}

function asRecord(row: Record<string, unknown>): AskUloPropertyRecord {
  const lat = row.latitude
  const lng = row.longitude
  return {
    id: String(row.id ?? ""),
    name: String(row.name ?? "").trim(),
    streetAddress: typeof row.street_address === "string" ? row.street_address.trim() : null,
    city: typeof row.city === "string" ? row.city.trim() : null,
    state: typeof row.state === "string" ? row.state.trim().toUpperCase() : null,
    zipCode: typeof row.zip_code === "string" ? row.zip_code.trim() : null,
    propertyType: typeof row.property_type === "string" ? row.property_type.trim() : null,
    yearBuilt: typeof row.year_built === "number" ? row.year_built : null,
    unitCount: typeof row.unit_count === "number" ? row.unit_count : null,
    latitude: typeof lat === "number" && Number.isFinite(lat) ? lat : null,
    longitude: typeof lng === "number" && Number.isFinite(lng) ? lng : null,
  }
}

export function formatPropertyAddressLine(record: AskUloPropertyRecord): string | null {
  const parts = [
    record.streetAddress?.trim(),
    [record.city, record.state].filter(Boolean).join(", "),
    record.zipCode?.trim(),
  ].filter(Boolean)
  return parts.length > 0 ? parts.join(" ") : null
}

export function propertyRecordToPlace(record: AskUloPropertyRecord): PropertyPlace | null {
  if (!record.name || !record.city || !record.state || record.state.length !== 2) {
    return null
  }
  return { name: record.name, city: record.city, state: record.state }
}

export function matchPropertyByName(
  records: readonly AskUloPropertyRecord[],
  query: string,
): AskUloPropertyRecord | null {
  const q = query.trim().toLowerCase()
  if (!q) return null
  const exact = records.find((r) => r.name.toLowerCase() === q)
  if (exact) return exact
  return (
    records.find(
      (r) => q.includes(r.name.toLowerCase()) || r.name.toLowerCase().includes(q),
    ) ?? null
  )
}

export function matchPropertyNameInText(
  records: readonly AskUloPropertyRecord[],
  corpus: string,
): string | null {
  const q = corpus.toLowerCase()
  for (const record of records) {
    if (q.includes(record.name.toLowerCase())) return record.name
  }
  return null
}

export function propertyPlacesFromRecords(
  records: readonly AskUloPropertyRecord[],
): PropertyPlace[] {
  const out: PropertyPlace[] = []
  const seen = new Set<string>()
  for (const record of records) {
    const place = propertyRecordToPlace(record)
    if (!place) continue
    const key = place.name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(place)
  }
  return out
}

export async function loadLandlordPropertyRecords(
  supabase: SupabaseClient,
  landlordId: string,
): Promise<AskUloPropertyRecord[]> {
  const trimmed = landlordId.trim()
  if (!trimmed) return []

  const { data, error } = await supabase
    .from("properties")
    .select(
      "id, name, street_address, city, state, zip_code, property_type, year_built, unit_count, latitude, longitude",
    )
    .eq("landlord_id", trimmed)
    .order("name")
    .limit(200)

  if (error) {
    console.error("[ask_ulo/propertyRecords] load failed", error.message)
    return []
  }

  return (data ?? [])
    .map((row) => asRecord(row as Record<string, unknown>))
    .filter((r) => r.name.length > 0)
}
