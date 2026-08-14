/**
 * Persist onboarding properties and unit inventory.
 */
import { ensureUnitsInDb } from '@/api/unitVacancy'
import {
  DEMO_LANDLORD_ID,
  getActiveLandlordId,
  getActiveLandlordKind,
} from '@/lib/activeLandlord'
import { getErrorMessage, getOnboardingErrorMessage, isUniqueViolation } from '@/lib/errorMessage'
import {
  deletePropertiesByNames,
  ensureProperty,
  linkUnitsToProperty,
} from '@/lib/properties'
import { normalizeBuildingKey, normalizeUnitLabel } from '@/lib/propertyHealth'
import { deleteResidentsForLandlord } from '@/lib/residentDeletion'
import { supabase } from '@/lib/supabase'
import { requireOnboardingLandlord } from '../scope'
import type { OnboardingProperty } from '../types'

export function generateUnitLabels(count: number): string[] {
  const labels: string[] = []
  for (let i = 1; i <= count; i++) {
    labels.push(String(100 + i))
  }
  return labels
}

export function uniqueOnboardingUnitLabels(labels: Iterable<string>): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of labels) {
    const label = String(raw ?? '').trim()
    if (!label) continue
    const key = normalizeUnitLabel(label)
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(label)
  }
  return out
}

/** Prefer extracted / saved labels. Only invent 101…N when the property has no inventory yet. */
export function resolveOnboardingUnitLabels(
  property: Pick<OnboardingProperty, 'unitCount' | 'unitLabels'>,
  existingLabels: string[] = [],
): string[] {
  const explicit = uniqueOnboardingUnitLabels(property.unitLabels ?? [])
  if (explicit.length > 0) return explicit
  const existing = uniqueOnboardingUnitLabels(existingLabels)
  if (existing.length > 0) return existing
  const count = Number.isFinite(property.unitCount) ? Math.max(0, Math.round(property.unitCount)) : 0
  return generateUnitLabels(count)
}

/** Distinct unit numbers from a rent roll / extraction for one property. */
export function collectExtractedUnitLabels(input: {
  propertyName: string
  otherPropertyNames?: string[]
  units?: Array<{ label?: string; building?: string; selected?: boolean }>
  residents?: Array<{ unit?: string; building?: string; selected?: boolean }>
  leases?: Array<{ unit?: string; building?: string; selected?: boolean }>
}): string[] {
  const propertyKey = normalizeBuildingKey(input.propertyName).toLowerCase()
  const otherKeys = new Set(
    (input.otherPropertyNames ?? [])
      .map((name) => normalizeBuildingKey(name).toLowerCase())
      .filter((key) => key && key !== propertyKey && key !== 'portfolio'),
  )

  const matchesThis = (building: string | undefined) => {
    const trimmed = (building ?? '').trim()
    if (!trimmed) return true
    if (!propertyKey || propertyKey === 'portfolio') return true
    return normalizeBuildingKey(trimmed).toLowerCase() === propertyKey
  }
  const matchesOther = (building: string | undefined) => {
    const trimmed = (building ?? '').trim()
    if (!trimmed) return false
    return otherKeys.has(normalizeBuildingKey(trimmed).toLowerCase())
  }

  const labels: string[] = []
  const consider = (building: string | undefined, label: string | undefined, selected?: boolean) => {
    if (selected === false) return
    const trimmedLabel = (label ?? '').trim()
    if (!trimmedLabel) return
    if (matchesOther(building)) return
    if (matchesThis(building) || otherKeys.size === 0) labels.push(trimmedLabel)
  }

  for (const unit of input.units ?? []) {
    consider(unit.building, unit.label, unit.selected)
  }
  for (const resident of input.residents ?? []) {
    consider(resident.building, resident.unit, resident.selected)
  }
  for (const lease of input.leases ?? []) {
    consider(lease.building, lease.unit, lease.selected)
  }
  return uniqueOnboardingUnitLabels(labels)
}

/** Unit options derived from onboarding properties (matches inventory written to `units`). */
export function listOnboardingUnitOptions(
  properties: OnboardingProperty[],
): Array<{ building: string; unitLabel: string; value: string }> {
  const options: Array<{ building: string; unitLabel: string; value: string }> = []
  for (const property of properties) {
    const building = property.name.trim()
    if (!building) continue
    for (const unitLabel of resolveOnboardingUnitLabels(property)) {
      options.push({
        building,
        unitLabel,
        value: `${building}::${unitLabel}`,
      })
    }
  }
  return options
}

function unitInventoryKey(unitLabel: string, building: string | null | undefined): string {
  // Match units_landlord_label_building_unique_idx coalesce(building, '') semantics.
  return `${unitLabel.trim().toLowerCase()}::${String(building ?? '').trim().toLowerCase()}`
}

function buildOnboardingUnitInventory(
  properties: OnboardingProperty[],
): Array<{
  unitLabel: string
  building: string
  city: string | null
  state: string | null
  zipCode: string | null
}> {
  const units: Array<{
    unitLabel: string
    building: string
    city: string | null
    state: string | null
    zipCode: string | null
  }> = []
  for (const property of properties) {
    const building = property.name.trim()
    if (!building) continue
    const city = property.city.trim() || null
    const state = property.state.trim() || null
    const zipCode = property.zipCode.trim() || null
    for (const label of resolveOnboardingUnitLabels(property)) {
      units.push({ unitLabel: label, building, city, state, zipCode })
    }
  }
  return units
}

export async function deleteUnitsByIds(unitIds: string[]): Promise<{ ok: boolean; error?: string }> {
  if (!supabase || unitIds.length === 0) {
    return { ok: true }
  }

  const { error: occupancyError } = await supabase.from('occupancy').delete().in('unit_id', unitIds)
  if (occupancyError) {
    return { ok: false, error: getErrorMessage(occupancyError, 'Something went wrong. Please try again.') }
  }

  const { error: unitError } = await supabase.from('units').delete().in('id', unitIds)
  if (unitError) {
    return { ok: false, error: getErrorMessage(unitError, 'Something went wrong. Please try again.') }
  }

  return { ok: true }
}

/** Remove portfolio buildings (units, occupancy, and residents scoped to each building name). */
export async function deleteLandlordBuildings(
  buildingNames: string[],
  landlordId: string = getActiveLandlordId(),
): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) {
    return { ok: false, error: 'We can\'t reach the server right now. Please try again in a moment.' }
  }
  // Demo showcase portfolio is seed-backed — never wipe it from the properties grid.
  if (getActiveLandlordKind() === 'demo' || landlordId === DEMO_LANDLORD_ID) {
    return { ok: false, error: 'Demo properties can’t be deleted.' }
  }
  if (buildingNames.length === 0) {
    return { ok: true }
  }

  const selected = new Set(buildingNames.map((name) => normalizeBuildingKey(name)))

  const { data: unitRows, error: unitLoadError } = await supabase
    .from('units')
    .select('id, building')
    .eq('landlord_id', landlordId)

  if (unitLoadError) {
    return { ok: false, error: getErrorMessage(unitLoadError, 'Something went wrong. Please try again.') }
  }

  const unitIds = (unitRows ?? [])
    .filter((row) => selected.has(normalizeBuildingKey(String((row as { building?: string | null }).building))))
    .map((row) => String((row as { id: string }).id))

  const removedUnits = await deleteUnitsByIds(unitIds)
  if (!removedUnits.ok) {
    return removedUnits
  }

  const { data: residentRows, error: residentLoadError } = await supabase
    .from('users')
    .select('id, building')
    .eq('landlord_id', landlordId)

  if (residentLoadError) {
    return { ok: false, error: getErrorMessage(residentLoadError, 'Something went wrong. Please try again.') }
  }

  const residentIds = (residentRows ?? [])
    .filter((row) => selected.has(normalizeBuildingKey(String((row as { building?: string | null }).building))))
    .map((row) => String((row as { id: string }).id))

  if (residentIds.length > 0) {
    const removedResidents = await deleteResidentsForLandlord({
      landlordId,
      residentIds,
    })
    if (!removedResidents.ok) {
      return { ok: false, error: removedResidents.error }
    }
  }

  const removedProperties = await deletePropertiesByNames({
    landlordId,
    names: buildingNames,
  })
  if (!removedProperties.ok) {
    return removedProperties
  }

  return { ok: true }
}

/** Keep units that still have occupancy or a roster tenant — never drop people to shrink inventory. */
async function unitIdsSafeToRemove(
  landlordId: string,
  stale: Array<{ id: string; unitLabel: string; building: string | null }>,
): Promise<string[]> {
  if (!supabase || stale.length === 0) return []

  const staleIds = stale.map((row) => row.id)
  const { data: occupancyRows } = await supabase
    .from('occupancy')
    .select('unit_id')
    .in('unit_id', staleIds)
  const occupied = new Set(
    (occupancyRows ?? [])
      .map((row) => String((row as { unit_id?: string }).unit_id ?? ''))
      .filter(Boolean),
  )

  const { data: residentRows } = await supabase
    .from('users')
    .select('unit, building')
    .eq('landlord_id', landlordId)

  return stale
    .filter((unit) => {
      if (occupied.has(unit.id)) return false
      const unitKey = normalizeUnitLabel(unit.unitLabel)
      if (!unitKey) return true
      const buildingKey = normalizeBuildingKey(unit.building)
      return !(residentRows ?? []).some((row) => {
        if (normalizeUnitLabel(String((row as { unit?: string | null }).unit ?? '')) !== unitKey) {
          return false
        }
        const residentBuilding = String((row as { building?: string | null }).building ?? '').trim()
        if (!residentBuilding || !unit.building?.trim()) return true
        return normalizeBuildingKey(residentBuilding) === buildingKey
      })
    })
    .map((unit) => unit.id)
}

/** Replace landlord unit inventory with exactly the onboarding property list (no cross-session accumulation). */
async function syncOnboardingPropertyUnits(
  landlordId: string,
  units: Array<{
    unitLabel: string
    building: string | null
    propertyId?: string | null
    city?: string | null
    state?: string | null
    zipCode?: string | null
  }>,
): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) {
    return { ok: false, error: 'We can\'t reach the server right now. Please try again in a moment.' }
  }

  const desiredKeys = new Set(
    units.map((unit) => unitInventoryKey(unit.unitLabel, unit.building)),
  )

  const { data: existing, error: loadError } = await supabase
    .from('units')
    .select('id, unit_label, building')
    .eq('landlord_id', landlordId)

  if (loadError) {
    return { ok: false, error: getErrorMessage(loadError, 'Something went wrong. Please try again.') }
  }

  const staleRows = (existing ?? []).filter(
    (row) =>
      !desiredKeys.has(
        unitInventoryKey(
          String((row as { unit_label: string }).unit_label),
          (row as { building?: string | null }).building,
        ),
      ),
  )

  const staleUnitIds = await unitIdsSafeToRemove(
    landlordId,
    staleRows.map((row) => ({
      id: String((row as { id: string }).id),
      unitLabel: String((row as { unit_label: string }).unit_label),
      building: (row as { building?: string | null }).building ?? null,
    })),
  )

  const removed = await deleteUnitsByIds(staleUnitIds)
  if (!removed.ok) {
    return removed
  }

  const remainingRows = (existing ?? []).filter(
    (row) => !staleUnitIds.includes(String((row as { id: string }).id)),
  )
  const remainingKeys = new Set(
    remainingRows.map((row) =>
      unitInventoryKey(
        String((row as { unit_label: string }).unit_label),
        (row as { building?: string | null }).building,
      ),
    ),
  )

  // Refresh location on units that already exist for this property inventory.
  for (const unit of units) {
    const key = unitInventoryKey(unit.unitLabel, unit.building)
    if (!remainingKeys.has(key)) continue
    const match = remainingRows.find(
      (row) =>
        unitInventoryKey(
          String((row as { unit_label: string }).unit_label),
          (row as { building?: string | null }).building,
        ) === key,
    )
    if (!match) continue
    const { error: updateError } = await supabase
      .from('units')
      .update({
        city: unit.city?.trim() || null,
        state: unit.state?.trim() || null,
        zip_code: unit.zipCode?.trim() || null,
        property_id: unit.propertyId ?? null,
      })
      .eq('id', String((match as { id: string }).id))
    if (updateError) {
      return { ok: false, error: getErrorMessage(updateError, 'Something went wrong. Please try again.') }
    }
  }

  const toInsert = units.filter(
    (unit) => !remainingKeys.has(unitInventoryKey(unit.unitLabel, unit.building)),
  )
  if (toInsert.length === 0) {
    return { ok: true }
  }

  // Insert one-by-one so a single unique collision cannot fail the whole property step.
  for (const unit of toInsert) {
    const { error: insertError } = await supabase.from('units').insert({
      landlord_id: landlordId,
      unit_label: unit.unitLabel.trim(),
      building: unit.building?.trim() || null,
      property_id: unit.propertyId ?? null,
      city: unit.city?.trim() || null,
      state: unit.state?.trim() || null,
      zip_code: unit.zipCode?.trim() || null,
      status: 'inactive',
    })
    if (insertError && !isUniqueViolation(insertError)) {
      return {
        ok: false,
        error: getOnboardingErrorMessage(
          insertError,
          'Couldn’t register units. Please try again.',
        ),
      }
    }
  }

  return { ok: true }
}

export async function persistOnboardingProperties(
  properties: OnboardingProperty[],
  landlordId: string = getActiveLandlordId(),
): Promise<
  | { ok: true; properties: OnboardingProperty[] }
  | { ok: false; error: string }
> {
  const scope = requireOnboardingLandlord(landlordId)
  if (!scope.ok) return scope

  if (properties.length === 0) {
    return { ok: false, error: 'Add at least one property.' }
  }

  const existingUnitRows = supabase
    ? (
        await supabase
          .from('units')
          .select('unit_label, building, property_id')
          .eq('landlord_id', scope.landlordId)
      ).data ?? []
    : []
  const existingResidentRows = supabase
    ? (
        await supabase
          .from('users')
          .select('unit, building')
          .eq('landlord_id', scope.landlordId)
      ).data ?? []
    : []

  const propertyIdByBuilding = new Map<string, string>()
  const canonicalProperties: OnboardingProperty[] = []
  for (const property of properties) {
    const name = property.name.trim()
    if (!name) continue
    const buildingKey = normalizeBuildingKey(name)
    const existingLabels = [
      ...existingUnitRows
        .filter((row) => {
          const propertyId = String((row as { property_id?: string | null }).property_id ?? '')
          const building = String((row as { building?: string | null }).building ?? '')
          return (
            (property.id && propertyId === property.id) ||
            normalizeBuildingKey(building) === buildingKey
          )
        })
        .map((row) => String((row as { unit_label?: string }).unit_label ?? '')),
      ...existingResidentRows
        .filter((row) => {
          const building = String((row as { building?: string | null }).building ?? '')
          const unit = String((row as { unit?: string | null }).unit ?? '').trim()
          if (!unit) return false
          if (!building.trim()) return true
          return normalizeBuildingKey(building) === buildingKey
        })
        .map((row) => String((row as { unit?: string | null }).unit ?? '')),
    ]
    const unitLabels = resolveOnboardingUnitLabels(property, existingLabels)
    const unitCount = Math.max(property.unitCount || 0, unitLabels.length, 1)
    const ensured = await ensureProperty({
      landlordId: scope.landlordId,
      name,
      streetAddress: property.streetAddress,
      city: property.city,
      state: property.state,
      zipCode: property.zipCode,
      propertyType: property.propertyType,
      managerName: property.propertyManagerName,
      managerPhone: property.propertyManagerPhone,
      unitCount,
    })
    if (!ensured.ok) return ensured
    propertyIdByBuilding.set(buildingKey, ensured.propertyId)
    canonicalProperties.push({ ...property, id: ensured.propertyId, unitLabels, unitCount })
    const linked = await linkUnitsToProperty({
      landlordId: scope.landlordId,
      propertyId: ensured.propertyId,
      buildingName: name,
    })
    if (!linked.ok) return { ok: false, error: linked.error ?? 'Could not link units to the property.' }
  }

  const units = buildOnboardingUnitInventory(canonicalProperties).map((unit) => ({
    ...unit,
    propertyId: propertyIdByBuilding.get(normalizeBuildingKey(unit.building)) ?? null,
  }))
  if (units.length === 0) {
    return { ok: false, error: 'Each property needs at least one unit.' }
  }

  try {
    const registeredViaSms = await ensureUnitsInDb(units)
    if (registeredViaSms) {
      const synced = await syncOnboardingPropertyUnits(scope.landlordId, units)
      if (!synced.ok) return { ok: false, error: synced.error ?? 'Could not sync units.' }
      return { ok: true, properties: canonicalProperties }
    }
  } catch (e) {
    return {
      ok: false,
      error: getOnboardingErrorMessage(e, 'Couldn’t register units. Please try again.'),
    }
  }

  const synced = await syncOnboardingPropertyUnits(scope.landlordId, units)
  if (!synced.ok) return { ok: false, error: synced.error ?? 'Could not sync units.' }
  return { ok: true, properties: canonicalProperties }
}

/** Temporary wizard row id — replaced with properties.id on save. */
export function createPropertyId(): string {
  return `draft-${crypto.randomUUID()}`
}
