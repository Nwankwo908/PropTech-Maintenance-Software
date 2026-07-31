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
import { normalizeBuildingKey } from '@/lib/propertyHealth'
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

/** Unit options derived from onboarding properties (matches inventory written to `units`). */
export function listOnboardingUnitOptions(
  properties: OnboardingProperty[],
): Array<{ building: string; unitLabel: string; value: string }> {
  const options: Array<{ building: string; unitLabel: string; value: string }> = []
  for (const property of properties) {
    const building = property.name.trim()
    if (!building) continue
    for (const unitLabel of generateUnitLabels(property.unitCount)) {
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
    for (const label of generateUnitLabels(property.unitCount)) {
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

  const staleUnitIds = (existing ?? [])
    .filter((row) =>
      !desiredKeys.has(
        unitInventoryKey(
          String((row as { unit_label: string }).unit_label),
          (row as { building?: string | null }).building,
        ),
      ),
    )
    .map((row) => String((row as { id: string }).id))

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
): Promise<{ ok: boolean; error?: string }> {
  const scope = requireOnboardingLandlord(landlordId)
  if (!scope.ok) return scope

  if (properties.length === 0) {
    return { ok: false, error: 'Add at least one property.' }
  }

  const propertyIdByBuilding = new Map<string, string>()
  for (const property of properties) {
    const name = property.name.trim()
    if (!name) continue
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
      unitCount: property.unitCount,
    })
    if (!ensured.ok) return ensured
    propertyIdByBuilding.set(normalizeBuildingKey(name), ensured.propertyId)
    const linked = await linkUnitsToProperty({
      landlordId: scope.landlordId,
      propertyId: ensured.propertyId,
      buildingName: name,
    })
    if (!linked.ok) return linked
  }

  const units = buildOnboardingUnitInventory(properties).map((unit) => ({
    ...unit,
    propertyId: propertyIdByBuilding.get(normalizeBuildingKey(unit.building)) ?? null,
  }))
  if (units.length === 0) {
    return { ok: false, error: 'Each property needs at least one unit.' }
  }

  try {
    const registeredViaSms = await ensureUnitsInDb(units)
    if (registeredViaSms) {
      return syncOnboardingPropertyUnits(scope.landlordId, units)
    }
  } catch (e) {
    return {
      ok: false,
      error: getOnboardingErrorMessage(e, 'Couldn’t register units. Please try again.'),
    }
  }

  return syncOnboardingPropertyUnits(scope.landlordId, units)
}

export function createPropertyId(): string {
  return `prop-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}
