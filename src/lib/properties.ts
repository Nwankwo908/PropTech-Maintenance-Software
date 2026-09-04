/**
 * Canonical properties table helpers.
 * Property id is stable across renames; display name lives in `properties.name`.
 */
import { getActiveLandlordId } from '@/lib/activeLandlord'
import { getErrorMessage } from '@/lib/errorMessage'
import { supabase } from '@/lib/supabase'

export type PropertyRecord = {
  id: string
  landlordId: string
  name: string
  streetAddress: string | null
  city: string | null
  state: string | null
  zipCode: string | null
  propertyType: string | null
  managerName: string | null
  managerPhone: string | null
  unitCount: number | null
  yearBuilt: number | null
}

export type EnsurePropertyInput = {
  landlordId?: string
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

function asRecord(row: Record<string, unknown>): PropertyRecord {
  return {
    id: String(row.id),
    landlordId: String(row.landlord_id),
    name: String(row.name ?? ''),
    streetAddress: typeof row.street_address === 'string' ? row.street_address : null,
    city: typeof row.city === 'string' ? row.city : null,
    state: typeof row.state === 'string' ? row.state : null,
    zipCode: typeof row.zip_code === 'string' ? row.zip_code : null,
    propertyType: typeof row.property_type === 'string' ? row.property_type : null,
    managerName: typeof row.manager_name === 'string' ? row.manager_name : null,
    managerPhone: typeof row.manager_phone === 'string' ? row.manager_phone : null,
    unitCount: typeof row.unit_count === 'number' ? row.unit_count : null,
    yearBuilt: typeof row.year_built === 'number' ? row.year_built : null,
  }
}

/** Deterministic properties.id for landlord + building name (matches DB derive_property_id). */
export async function derivePropertyId(
  landlordId: string,
  name: string,
): Promise<{ ok: true; propertyId: string } | { ok: false; error: string }> {
  if (!supabase) {
    return { ok: false, error: "We can't reach the server right now. Please try again in a moment." }
  }

  const trimmed = name.trim()
  if (!trimmed) {
    return { ok: false, error: 'Property name is required.' }
  }

  const { data, error } = await supabase.rpc('derive_property_id', {
    p_landlord_id: landlordId,
    p_building: trimmed,
  })

  if (error || data == null) {
    return {
      ok: false,
      error: getErrorMessage(error, "Couldn't resolve the property id."),
    }
  }

  return { ok: true, propertyId: String(data) }
}

export async function findPropertyByName(
  landlordId: string,
  name: string,
): Promise<{ ok: true; property: PropertyRecord | null } | { ok: false; error: string }> {
  if (!supabase) {
    return { ok: false, error: "We can't reach the server right now. Please try again in a moment." }
  }

  const trimmed = name.trim()
  if (!trimmed) {
    return { ok: true, property: null }
  }

  const { data, error } = await supabase
    .from('properties')
    .select(
      'id, landlord_id, name, street_address, city, state, zip_code, property_type, manager_name, manager_phone, unit_count, year_built',
    )
    .eq('landlord_id', landlordId)
    .ilike('name', trimmed)
    .limit(1)
    .maybeSingle()

  if (error) {
    return { ok: false, error: getErrorMessage(error, "Couldn't load the property.") }
  }

  return {
    ok: true,
    property: data ? asRecord(data as Record<string, unknown>) : null,
  }
}

export async function findPropertyById(
  landlordId: string,
  propertyId: string,
): Promise<{ ok: true; property: PropertyRecord | null } | { ok: false; error: string }> {
  if (!supabase) {
    return { ok: false, error: "We can't reach the server right now. Please try again in a moment." }
  }

  const id = propertyId.trim()
  if (!id) {
    return { ok: true, property: null }
  }

  const { data, error } = await supabase
    .from('properties')
    .select(
      'id, landlord_id, name, street_address, city, state, zip_code, property_type, manager_name, manager_phone, unit_count, year_built',
    )
    .eq('landlord_id', landlordId)
    .eq('id', id)
    .maybeSingle()

  if (error) {
    return { ok: false, error: getErrorMessage(error, "Couldn't load the property.") }
  }

  return {
    ok: true,
    property: data ? asRecord(data as Record<string, unknown>) : null,
  }
}

export function propertyRecordToAddressLine(property: PropertyRecord): string | null {
  const parts = [
    property.streetAddress?.trim(),
    [property.city, property.state].filter(Boolean).join(', '),
    property.zipCode?.trim(),
  ].filter(Boolean)
  return parts.length > 0 ? parts.join(' ') : null
}

/** Street, city, state, ZIP in the form Zillow search expects. */
export function zillowLookupAddressFromProperty(property: PropertyRecord): string | null {
  const street = property.streetAddress?.trim() ?? ''
  const city = property.city?.trim() ?? ''
  const state = property.state?.trim() ?? ''
  const zip = property.zipCode?.trim() ?? ''
  const cityState = city && state ? `${city}, ${state}` : city || state
  const tail = [cityState, zip].filter(Boolean).join(' ')
  if (street && tail) return `${street}, ${tail}`
  return propertyRecordToAddressLine(property)
}

/** Landlord-facing area only — no street address. */
export function propertyRecordToCityStateZip(
  property: Pick<PropertyRecord, 'city' | 'state' | 'zipCode'>,
): string | null {
  const city = property.city?.trim() ?? ''
  const state = property.state?.trim() ?? ''
  const zip = property.zipCode?.trim() ?? ''
  if (city && state && zip) return `${city}, ${state} ${zip}`
  if (city && state) return `${city}, ${state}`
  return null
}

export function cityStateZipForBuildingName(
  properties: readonly PropertyRecord[],
  building: string | null | undefined,
): string | null {
  const q = building?.trim().toLowerCase()
  if (!q) return null
  const match =
    properties.find((p) => p.name.trim().toLowerCase() === q) ??
    properties.find((p) => (p.streetAddress ?? '').trim().toLowerCase() === q)
  return match ? propertyRecordToCityStateZip(match) : null
}

/** Upsert a property row; returns the stable properties.id. */
export async function ensureProperty(
  input: EnsurePropertyInput,
): Promise<{ ok: true; propertyId: string } | { ok: false; error: string }> {
  if (!supabase) {
    return { ok: false, error: "We can't reach the server right now. Please try again in a moment." }
  }

  const name = input.name.trim()
  if (!name) {
    return { ok: false, error: 'Property name is required.' }
  }

  const landlordId = input.landlordId?.trim() || getActiveLandlordId()
  const { data, error } = await supabase.rpc('ensure_property', {
    p_landlord_id: landlordId,
    p_name: name,
    p_street_address: input.streetAddress?.trim() || null,
    p_city: input.city?.trim() || null,
    p_state: input.state?.trim() || null,
    p_zip_code: input.zipCode?.trim() || null,
    p_property_type: input.propertyType?.trim() || null,
    p_manager_name: input.managerName?.trim() || null,
    p_manager_phone: input.managerPhone?.trim() || null,
    p_unit_count: input.unitCount ?? null,
    p_year_built: input.yearBuilt ?? null,
  })

  if (error || data == null) {
    return {
      ok: false,
      error: getErrorMessage(error, "Couldn't save the property. Please try again."),
    }
  }

  return { ok: true, propertyId: String(data) }
}

/** Rename display name only — properties.id stays the same. */
export async function renameProperty(
  propertyId: string,
  newName: string,
): Promise<{ ok: true; propertyId: string } | { ok: false; error: string }> {
  if (!supabase) {
    return { ok: false, error: "We can't reach the server right now. Please try again in a moment." }
  }

  const { data, error } = await supabase.rpc('rename_property', {
    p_property_id: propertyId,
    p_new_name: newName.trim(),
  })

  if (error || data == null) {
    return {
      ok: false,
      error: getErrorMessage(error, "Couldn't rename the property. Please try again."),
    }
  }

  return { ok: true, propertyId: String(data) }
}

export async function listPropertiesForLandlord(
  landlordId: string = getActiveLandlordId(),
): Promise<{ ok: true; properties: PropertyRecord[] } | { ok: false; error: string }> {
  if (!supabase) {
    return { ok: false, error: "We can't reach the server right now. Please try again in a moment." }
  }

  const { data, error } = await supabase
    .from('properties')
    .select(
      'id, landlord_id, name, street_address, city, state, zip_code, property_type, manager_name, manager_phone, unit_count, year_built',
    )
    .eq('landlord_id', landlordId)
    .order('name', { ascending: true })

  if (error) {
    return { ok: false, error: getErrorMessage(error, "Couldn't load properties.") }
  }

  return {
    ok: true,
    properties: (data ?? []).map((row) => asRecord(row as Record<string, unknown>)),
  }
}

/** Link all units for a building name to a property_id (and keep building text in sync). */
export async function linkUnitsToProperty(params: {
  landlordId: string
  propertyId: string
  buildingName: string
}): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) {
    return { ok: false, error: "We can't reach the server right now. Please try again in a moment." }
  }

  const building = params.buildingName.trim()
  const { data: unitRows, error: loadError } = await supabase
    .from('units')
    .select('id, building, property_id')
    .eq('landlord_id', params.landlordId)

  if (loadError) {
    return { ok: false, error: getErrorMessage(loadError, "Couldn't link units to the property.") }
  }

  const buildingLower = building.toLowerCase()
  const unitIds = (unitRows ?? [])
    .filter((row) => {
      const raw = row as { id: string; building?: string | null; property_id?: string | null }
      if (raw.property_id === params.propertyId) return true
      const label = String(raw.building ?? '').trim()
      if (!label) return false
      const labelLower = label.toLowerCase()
      return labelLower === buildingLower || labelLower.startsWith(`${buildingLower} (`)
    })
    .map((row) => String((row as { id: string }).id))

  if (unitIds.length === 0) return { ok: true }

  const { error } = await supabase
    .from('units')
    .update({
      property_id: params.propertyId,
      building,
    })
    .in('id', unitIds)

  if (error) {
    return { ok: false, error: getErrorMessage(error, "Couldn't link units to the property.") }
  }

  return { ok: true }
}

export async function deletePropertiesByNames(params: {
  landlordId: string
  names: string[]
}): Promise<{ ok: boolean; error?: string }> {
  if (!supabase || params.names.length === 0) return { ok: true }

  const keys = params.names.map((n) => n.trim().toLowerCase()).filter(Boolean)
  const { data, error: loadError } = await supabase
    .from('properties')
    .select('id, name')
    .eq('landlord_id', params.landlordId)

  if (loadError) {
    return { ok: false, error: getErrorMessage(loadError, "Couldn't load properties.") }
  }

  const ids = (data ?? [])
    .filter((row) => keys.includes(String((row as { name?: string }).name ?? '').trim().toLowerCase()))
    .map((row) => String((row as { id: string }).id))

  if (ids.length === 0) return { ok: true }

  const { error } = await supabase.from('properties').delete().in('id', ids)
  if (error) {
    return { ok: false, error: getErrorMessage(error, "Couldn't delete properties.") }
  }

  return { ok: true }
}
