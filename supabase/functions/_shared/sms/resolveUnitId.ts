/**
 * Resolve a units.id UUID from roster unit label + optional building.
 * Shared by identity linking and conversation backfill — never store the
 * label string in unit_id.
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

export async function resolveUnitIdForLandlord(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    unitLabel: string | null | undefined
    building?: string | null | undefined
  },
): Promise<string | null> {
  const wanted = normalizeUnitLabelForMatch(params.unitLabel)
  if (!wanted || !params.landlordId.trim()) return null

  const { data, error } = await supabase
    .from("units")
    .select("id, unit_label, building")
    .eq("landlord_id", params.landlordId)
    .limit(800)

  if (error) {
    console.error("[resolveUnitIdForLandlord]", error.message)
    return null
  }

  const matches = ((data ?? []) as Array<{
    id: string
    unit_label: string | null
    building: string | null
  }>).filter((row) => normalizeUnitLabelForMatch(row.unit_label) === wanted)

  if (matches.length === 0) return null
  if (matches.length === 1) return matches[0]!.id

  const buildingHint = (params.building ?? "").trim().toLowerCase()
  if (!buildingHint) return matches[0]!.id

  const narrowed = matches.filter((row) => {
    const b = (row.building ?? "").trim().toLowerCase()
    if (!b) return false
    return (
      b.includes(buildingHint) ||
      buildingHint.includes(b) ||
      buildingHint.split(/\s+/).some((tok) => tok.length >= 3 && b.includes(tok))
    )
  })
  return (narrowed[0] ?? matches[0])!.id
}
