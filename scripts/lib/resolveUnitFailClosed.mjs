/**
 * Fail-closed unit resolution for Node remediation / seed scripts.
 * Mirrors supabase/functions/_shared/sms/resolveUnitId.ts —
 * never return matches[0] when unit labels collide across properties.
 */

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

export function normalizeUnitLabelForMatch(v) {
  let s = String(v ?? '')
    .trim()
    .toLowerCase()
  s = s.replace(/#/g, '')
  s = s.replace(/\b(unit|apt|apartment|suite|ste)\b/g, '')
  s = s.replace(/[^a-z0-9]/g, '')
  return s
}

function normalizeBuildingHint(v) {
  return String(v ?? '')
    .trim()
    .toLowerCase()
}

function buildingLikelyMatches(rowBuilding, hint) {
  const b = normalizeBuildingHint(rowBuilding)
  if (!b || !hint) return false
  if (b === hint || b.includes(hint) || hint.includes(b)) return true
  const tokens = hint.split(/\s+/).filter((tok) => tok.length >= 3 && !STREET.has(tok))
  return tokens.length > 0 && tokens.every((tok) => b.includes(tok))
}

/**
 * @param {Array<{ id: string, unit_label?: string | null, building?: string | null, property_id?: string | null }>} rows
 * @param {{ unitLabel?: string | null, building?: string | null, propertyId?: string | null }} params
 * @returns {string | null}
 */
export function pickUnitIdFromInventoryRows(rows, params) {
  const wanted = normalizeUnitLabelForMatch(params.unitLabel)
  if (!wanted) return null

  let matches = (rows ?? []).filter(
    (row) => normalizeUnitLabelForMatch(row.unit_label) === wanted,
  )
  const propertyId = params.propertyId?.trim?.() || params.propertyId || null
  if (propertyId) {
    matches = matches.filter((row) => String(row.property_id ?? '') === String(propertyId))
  }
  if (matches.length === 0) return null
  if (matches.length === 1) return matches[0].id

  const buildingHint = normalizeBuildingHint(params.building)
  if (!buildingHint) return null

  const narrowed = matches.filter((row) => buildingLikelyMatches(row.building, buildingHint))
  if (narrowed.length === 1) return narrowed[0].id
  return null
}

/**
 * Resolve a unit for a landlord. Prefer occupancy when residentId is known.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {{
 *   landlordId: string,
 *   unitLabel?: string | null,
 *   building?: string | null,
 *   propertyId?: string | null,
 *   residentId?: string | null,
 * }} params
 */
export async function resolveUnitFailClosed(supabase, params) {
  const landlordId = String(params.landlordId ?? '').trim()
  if (!landlordId) return null

  const residentId = params.residentId?.trim?.() || params.residentId || null
  if (residentId) {
    const { data: occ } = await supabase
      .from('occupancy')
      .select('unit_id')
      .eq('landlord_id', landlordId)
      .eq('resident_id', residentId)
      .eq('status', 'active')
      .limit(5)
    const unitIds = [...new Set((occ ?? []).map((row) => row.unit_id).filter(Boolean))]
    if (unitIds.length === 1) {
      const { data: unit } = await supabase
        .from('units')
        .select('id, unit_label, building, property_id')
        .eq('id', unitIds[0])
        .maybeSingle()
      if (unit?.id) return unit
    }
  }

  let query = supabase
    .from('units')
    .select('id, unit_label, building, property_id')
    .eq('landlord_id', landlordId)
    .limit(800)
  const propertyId = params.propertyId?.trim?.() || params.propertyId || null
  if (propertyId) query = query.eq('property_id', propertyId)

  const { data, error } = await query
  if (error) throw new Error(`units lookup: ${error.message}`)

  const id = pickUnitIdFromInventoryRows(data ?? [], {
    unitLabel: params.unitLabel,
    building: params.building,
    propertyId,
  })
  if (!id) return null
  return (data ?? []).find((row) => row.id === id) ?? null
}

/**
 * Assert ticket/run unit_id belongs to property_id.
 * @param {{ unit_id?: string | null, property_id?: string | null }} row
 * @param {{ id: string, property_id?: string | null } | null} unit
 */
export function assertUnitPropertyAgreement(row, unit) {
  if (!row?.unit_id || !row?.property_id) return
  if (!unit?.id) {
    throw new Error(`unit_id ${row.unit_id} not found — refuse write`)
  }
  if (unit.property_id && unit.property_id !== row.property_id) {
    throw new Error(
      `unit/property disagree (unit.property_id=${unit.property_id}, row.property_id=${row.property_id})`,
    )
  }
}
