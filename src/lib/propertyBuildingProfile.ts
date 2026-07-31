import { getErrorMessage } from '@/lib/errorMessage'
/**
 * Building-level profile (year built) for Property Details + asset age fallbacks.
 */
import { getActiveLandlordId } from '@/lib/activeLandlord'
import { supabase } from '@/lib/supabase'

export type PropertyBuildingProfile = {
  yearBuilt: number | null
  updatedAt: string | null
}

export const EMPTY_BUILDING_PROFILE: PropertyBuildingProfile = {
  yearBuilt: null,
  updatedAt: null,
}

function localStorageKey(building: string): string {
  const landlordId = getActiveLandlordId()
  const key = building.trim().toLowerCase().replace(/\s+/g, '-')
  return `ulo.propertyBuildingProfile.${landlordId}.${key}`
}

export function loadPropertyBuildingProfileLocal(building: string): PropertyBuildingProfile {
  try {
    const raw = window.localStorage.getItem(localStorageKey(building))
    if (!raw) return { ...EMPTY_BUILDING_PROFILE }
    const parsed = JSON.parse(raw) as { yearBuilt?: unknown; updatedAt?: unknown }
    const year =
      typeof parsed.yearBuilt === 'number' && Number.isFinite(parsed.yearBuilt)
        ? parsed.yearBuilt
        : null
    return {
      yearBuilt: year != null && year >= 1800 && year <= 2100 ? year : null,
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : null,
    }
  } catch {
    return { ...EMPTY_BUILDING_PROFILE }
  }
}

function saveLocal(building: string, profile: PropertyBuildingProfile): void {
  try {
    window.localStorage.setItem(localStorageKey(building), JSON.stringify(profile))
  } catch {
    // private mode
  }
}

export async function loadPropertyBuildingProfile(
  building: string,
): Promise<PropertyBuildingProfile> {
  const landlordId = getActiveLandlordId()
  const local = loadPropertyBuildingProfileLocal(building)
  if (!supabase || !landlordId || !building.trim()) return local

  const { data, error } = await supabase
    .from('property_building_profiles')
    .select('year_built, updated_at')
    .eq('landlord_id', landlordId)
    .eq('building', building.trim())
    .maybeSingle()

  if (error || !data) return local
  const year =
    typeof data.year_built === 'number' && Number.isFinite(data.year_built)
      ? data.year_built
      : null
  const next: PropertyBuildingProfile = {
    yearBuilt: year != null && year >= 1800 && year <= 2100 ? year : null,
    updatedAt: typeof data.updated_at === 'string' ? data.updated_at : null,
  }
  saveLocal(building, next)
  return next
}

export async function savePropertyBuildingProfile(
  building: string,
  yearBuilt: number | null,
): Promise<PropertyBuildingProfile> {
  const landlordId = getActiveLandlordId()
  const next: PropertyBuildingProfile = {
    yearBuilt:
      yearBuilt != null && Number.isFinite(yearBuilt) && yearBuilt >= 1800 && yearBuilt <= 2100
        ? Math.round(yearBuilt)
        : null,
    updatedAt: new Date().toISOString(),
  }
  saveLocal(building, next)

  if (!supabase || !landlordId || !building.trim()) return next

  const { error } = await supabase.from('property_building_profiles').upsert(
    {
      landlord_id: landlordId,
      building: building.trim(),
      year_built: next.yearBuilt,
      updated_at: next.updatedAt,
    },
    { onConflict: 'landlord_id,building' },
  )

  if (error) {
    console.error('[property-building-profile] save', error.message)
    throw new Error(getErrorMessage(error, 'Something went wrong. Please try again.'))
  }
  return next
}

/** Age in whole years derived from build year (null if invalid). */
export function ageYearsFromBuildYear(yearBuilt: number | null, asOf = new Date()): number | null {
  if (yearBuilt == null || !Number.isFinite(yearBuilt)) return null
  const age = asOf.getFullYear() - Math.round(yearBuilt)
  if (age < 0 || age > 200) return null
  return age
}
