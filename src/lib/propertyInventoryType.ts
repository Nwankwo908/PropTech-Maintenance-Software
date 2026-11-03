import { getActiveLandlordId } from '@/lib/activeLandlord'
import {
  isOccupyingResidentStatus,
  normalizeBuildingKey,
  normalizeUnitLabel,
} from '@/lib/propertyHealth'
import { recordActivityLog } from '@/lib/recordActivityLog'
import { supabase } from '@/lib/supabase'
import { isSingleFamilyPropertyType } from '@shared/properties/propertyType'

/** Stored labels that mean "the house" rather than a separate home. */
const SENTINEL_UNIT_KEYS = new Set(['1', 'home'])

export type InventoryProperty = {
  id: string
  name: string
  streetAddress?: string | null
  propertyType: string | null
}

export type InventoryUnit = {
  propertyId?: string | null
  building?: string | null
  unitLabel: string
}

export type InventoryResident = {
  building?: string | null
  unit?: string | null
  status?: string | null
}

export type PropertyTypeCorrection = {
  propertyId: string
  propertyName: string
  streetAddress: string | null
  storedType: string | null
  propertyType: 'multifamily'
  unitCount: number
  unitLabels: string[]
}

function placeKey(value: string | null | undefined): string {
  return normalizeBuildingKey(value).toLowerCase()
}

/** A real unit label, or null for a blank / single-family sentinel ("1", "Home"). */
export function realInventoryUnitKey(label: string | null | undefined): string | null {
  const raw = (label ?? '').trim()
  if (!raw) return null
  const key = normalizeUnitLabel(raw)
  if (!key || SENTINEL_UNIT_KEYS.has(key)) return null
  return key
}

/** First-seen display labels for distinct real units. */
export function distinctRealUnitLabels(labels: Array<string | null | undefined>): string[] {
  const seen = new Map<string, string>()
  for (const label of labels) {
    const key = realInventoryUnitKey(label)
    if (!key || seen.has(key)) continue
    seen.set(key, (label ?? '').trim())
  }
  return [...seen.values()]
}

/**
 * Single-family (or blank) inventory with two or more real units is multifamily.
 * Condo, townhouse, and commercial stay as stored. Two people on the same
 * blank or sentinel unit stay single-family.
 */
export function correctedPropertyTypeFromLabels(
  storedType: string | null | undefined,
  labels: Array<string | null | undefined>,
): string | null {
  const stored = storedType?.trim() || null
  if (distinctRealUnitLabels(labels).length < 2) return stored
  if (stored && !isSingleFamilyPropertyType(stored)) return stored
  return 'multifamily'
}

function propertyPlaceKeys(property: InventoryProperty): Set<string> {
  const keys = new Set<string>()
  for (const value of [property.name, property.streetAddress]) {
    const key = placeKey(value)
    if (key && key !== 'portfolio') keys.add(key)
  }
  return keys
}

export function propertyTypeCorrectionsFromInventory(input: {
  properties: InventoryProperty[]
  units: InventoryUnit[]
  residents: InventoryResident[]
}): PropertyTypeCorrection[] {
  const corrections: PropertyTypeCorrection[] = []
  for (const property of input.properties) {
    const places = propertyPlaceKeys(property)
    const labels: string[] = []
    for (const unit of input.units) {
      const belongs =
        (unit.propertyId && unit.propertyId === property.id) ||
        places.has(placeKey(unit.building))
      if (belongs) labels.push(unit.unitLabel)
    }
    for (const resident of input.residents) {
      if (!isOccupyingResidentStatus(resident.status ?? '')) continue
      if (!places.has(placeKey(resident.building))) continue
      if (resident.unit) labels.push(resident.unit)
    }
    const unitLabels = distinctRealUnitLabels(labels)
    const nextType = correctedPropertyTypeFromLabels(property.propertyType, unitLabels)
    if (nextType !== 'multifamily') continue
    if ((property.propertyType ?? '').trim() === 'multifamily') continue
    corrections.push({
      propertyId: property.id,
      propertyName: property.name.trim() || 'This property',
      streetAddress: property.streetAddress?.trim() || null,
      storedType: property.propertyType?.trim() || null,
      propertyType: 'multifamily',
      unitCount: unitLabels.length,
      unitLabels,
    })
  }
  return corrections
}

export function correctedPropertyTypeForPlace(
  corrections: PropertyTypeCorrection[],
  input: {
    propertyId?: string | null
    building?: string | null
    storedType?: string | null
  },
): string | null {
  const propertyId = input.propertyId?.trim() || ''
  const building = placeKey(input.building)
  const match =
    corrections.find((correction) => propertyId && correction.propertyId === propertyId) ??
    corrections.find((correction) => {
      if (!building || building === 'portfolio') return false
      return (
        placeKey(correction.propertyName) === building ||
        placeKey(correction.streetAddress) === building
      )
    })
  return match?.propertyType ?? input.storedType ?? null
}

function unitListPhrase(labels: string[]): string {
  if (labels.length === 2) return `Units ${labels[0]} and ${labels[1]} are listed.`
  return `Units ${labels.slice(0, -1).join(', ')}, and ${labels[labels.length - 1]} are listed.`
}

const persistInflight = new Set<string>()

/** Save multifamily when a single-family row has two or more real units. */
export async function persistPropertyTypeCorrections(
  corrections: PropertyTypeCorrection[],
): Promise<string[]> {
  if (!supabase || corrections.length === 0) return []
  const landlordId = getActiveLandlordId()
  const updated: string[] = []
  for (const correction of corrections) {
    if (!correction.propertyId || persistInflight.has(correction.propertyId)) continue
    persistInflight.add(correction.propertyId)
    try {
      let query = supabase
        .from('properties')
        .update({
          property_type: 'multifamily',
          unit_count: correction.unitCount,
        })
        .eq('id', correction.propertyId)
        .eq('landlord_id', landlordId)
      query = correction.storedType
        ? query.eq('property_type', correction.storedType)
        : query.is('property_type', null)
      const { data, error } = await query.select('id')
      if (error || !data?.length) continue
      updated.push(correction.propertyId)
      const name = correction.propertyName
      await recordActivityLog({
        landlordId,
        eventType: 'property.type_corrected',
        source: 'automation',
        actorType: 'system',
        propertyId: correction.propertyId,
        metadata: {
          message: `${name} is a multifamily property. ${unitListPhrase(correction.unitLabels)}`,
        },
      })
    } finally {
      persistInflight.delete(correction.propertyId)
    }
  }
  return updated
}
