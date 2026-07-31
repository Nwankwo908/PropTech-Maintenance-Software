/**
 * Hydrate onboarding property rows from the canonical properties table.
 */
import { listPropertiesForLandlord, type PropertyRecord } from '@/lib/properties'
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
  return result.properties.map(propertyRecordToOnboardingProperty)
}
