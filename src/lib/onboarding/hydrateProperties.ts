/**
 * Hydrate onboarding property rows from the canonical properties table.
 */
import { listPropertiesForLandlord, type PropertyRecord } from '@/lib/properties'
import { normalizeBuildingKey } from '@/lib/propertyHealth'
import { supabase } from '@/lib/supabase'
import { uniqueOnboardingUnitLabels } from './persist/properties'
import type { OnboardingProperty } from './types'

export function propertyRecordToOnboardingProperty(row: PropertyRecord): OnboardingProperty {
  return {
    id: row.id,
    name: row.name,
    streetAddress: row.streetAddress ?? '',
    city: row.city ?? '',
    state: row.state ?? '',
    zipCode: row.zipCode ?? '',
    unitCount: row.unitCount != null && row.unitCount >= 1 ? row.unitCount : 1,
    propertyType: row.propertyType ?? undefined,
    propertyManagerName: row.managerName ?? undefined,
    propertyManagerPhone: row.managerPhone ?? undefined,
  }
}

/** Load portfolio properties for completed landlords (replaces onboarding JSON). */
export async function loadCanonicalOnboardingProperties(
  landlordId: string,
): Promise<OnboardingProperty[]> {
  const result = await listPropertiesForLandlord(landlordId)
  if (!result.ok) return []
  const properties = result.properties.map(propertyRecordToOnboardingProperty)
  if (!supabase || properties.length === 0) return properties

  const { data, error } = await supabase
    .from('units')
    .select('unit_label, building, property_id')
    .eq('landlord_id', landlordId)
  if (error) return properties

  return properties.map((property) => {
    const buildingKey = normalizeBuildingKey(property.name)
    const unitLabels = uniqueOnboardingUnitLabels(
      (data ?? [])
        .filter((row) => {
          const propertyId = String((row as { property_id?: string | null }).property_id ?? '')
          const building = String((row as { building?: string | null }).building ?? '')
          return propertyId === property.id || normalizeBuildingKey(building) === buildingKey
        })
        .map((row) => String((row as { unit_label?: string }).unit_label ?? '')),
    )
    return {
      ...property,
      unitLabels: unitLabels.length > 0 ? unitLabels : property.unitLabels,
      unitCount: Math.max(property.unitCount, unitLabels.length, 1),
    }
  })
}
