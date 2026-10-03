/**
 * Resolve a units.id UUID from roster unit label + optional building.
 * Shared by identity linking and conversation backfill — never store the
 * label string in unit_id.
 *
 * Fail closed when the label is ambiguous across properties. Never return
 * matches[0] for repeating labels like "1".
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"

/** Unit comparison: ignore case, labels, #, spaces, and punctuation. */
export function normalizeUnitLabelForMatch(v: string | null | undefined): string {
  let s = (v ?? "").trim().toLowerCase()
  s = s.replace(/#/g, "")
  s = s.replace(/\b(unit|apt|apartment|suite|ste)\b/g, "")
  s = s.replace(/[^a-z0-9]/g, "")
  return s
}

function normalizeBuildingHint(v: string | null | undefined): string {
  return (v ?? "").trim().toLowerCase()
}

function buildingLikelyMatches(rowBuilding: string | null, hint: string): boolean {
  const b = normalizeBuildingHint(rowBuilding)
  if (!b || !hint) return false
  if (b === hint || b.includes(hint) || hint.includes(b)) return true
  // Token match — ignore street suffixes so "Ave" does not collapse every address.
  const STREET = new Set([
    'ave',
    'avenue',
    'st',
    'street',
    'rd',
    'road',
    'dr',
    'drive',
    'ln',
    'lane',
    'blvd',
    'ct',
    'court',
    'pl',
    'place',
  ])
  const tokens = hint.split(/\s+/).filter((tok) => tok.length >= 3 && !STREET.has(tok))
  return tokens.length > 0 && tokens.every((tok) => b.includes(tok))
}

/**
 * Pick a unit id from already-loaded inventory rows.
 * Returns null when the label is missing, unmatched, or ambiguous.
 */
export function pickUnitIdFromInventoryRows(
  rows: Array<{ id: string; unit_label: string | null; building: string | null }>,
  params: {
    unitLabel: string | null | undefined
    building?: string | null | undefined
    /** When set, only consider units on this property. */
    propertyId?: string | null | undefined
  },
): string | null {
  const wanted = normalizeUnitLabelForMatch(params.unitLabel)
  if (!wanted) return null

  let matches = rows.filter((row) => normalizeUnitLabelForMatch(row.unit_label) === wanted)
  const propertyId = params.propertyId?.trim() || null
  if (propertyId) {
    matches = matches.filter((row) =>
      "property_id" in row
        ? String((row as { property_id?: string | null }).property_id ?? "") === propertyId
        : true,
    )
  }
  if (matches.length === 0) return null
  if (matches.length === 1) return matches[0]!.id

  const buildingHint = normalizeBuildingHint(params.building)
  if (!buildingHint) return null

  const narrowed = matches.filter((row) => buildingLikelyMatches(row.building, buildingHint))
  if (narrowed.length === 1) return narrowed[0]!.id
  return null
}

export async function resolveUnitIdForLandlord(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    unitLabel: string | null | undefined
    building?: string | null | undefined
    propertyId?: string | null | undefined
  },
): Promise<string | null> {
  const wanted = normalizeUnitLabelForMatch(params.unitLabel)
  if (!wanted || !params.landlordId.trim()) return null

  let query = supabase
    .from("units")
    .select("id, unit_label, building, property_id")
    .eq("landlord_id", params.landlordId)
    .limit(800)

  const propertyId = params.propertyId?.trim() || null
  if (propertyId) query = query.eq("property_id", propertyId)

  const { data, error } = await query

  if (error) {
    console.error("[resolveUnitIdForLandlord]", error.message)
    return null
  }

  return pickUnitIdFromInventoryRows(
    (data ?? []) as Array<{
      id: string
      unit_label: string | null
      building: string | null
      property_id?: string | null
    }>,
    {
      unitLabel: params.unitLabel,
      building: params.building,
      propertyId,
    },
  )
}
