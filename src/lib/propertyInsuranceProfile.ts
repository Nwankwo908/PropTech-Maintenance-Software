/**
 * Property Details → Insurance, saved in `property_insurance_profiles` so every
 * device and teammate sees the same policy.
 *
 * The browser copy (localStorage) is kept as a cache and for the scanned binder
 * file, which is not stored in the database. A profile saved only in this
 * browser before the table existed is uploaded the first time it loads.
 */
import { getActiveLandlordId } from '@/lib/activeLandlord'
import { supabase } from '@/lib/supabase'

export type StoredInsuranceProfile = Record<string, unknown>

/** Fields that only make sense in this browser (the binder file itself). */
const BROWSER_ONLY_FIELDS = ['binderFileUrl'] as const

function buildingKey(building: string): string {
  return building.trim().toLowerCase().replace(/\s+/g, '-')
}

function localKey(landlordId: string, building: string): string {
  return `ulo.propertyInsurance.${landlordId}.${buildingKey(building)}`
}

function readLocal(landlordId: string, building: string): StoredInsuranceProfile | null {
  try {
    const raw = window.localStorage.getItem(localKey(landlordId, building))
    if (!raw) return null
    const parsed = JSON.parse(raw) as unknown
    return parsed && typeof parsed === 'object' ? (parsed as StoredInsuranceProfile) : null
  } catch {
    return null
  }
}

function writeLocal(landlordId: string, building: string, profile: StoredInsuranceProfile | null) {
  try {
    if (profile) window.localStorage.setItem(localKey(landlordId, building), JSON.stringify(profile))
    else window.localStorage.removeItem(localKey(landlordId, building))
  } catch {
    // Best-effort cache.
  }
}

/** The profile as saved to the database: browser-only fields removed. */
export function toDatabaseProfile(profile: StoredInsuranceProfile): StoredInsuranceProfile {
  const copy: StoredInsuranceProfile = { ...profile }
  for (const field of BROWSER_ONLY_FIELDS) delete copy[field]
  return copy
}

function text(profile: StoredInsuranceProfile | null | undefined, key: string): string {
  const value = profile?.[key]
  return typeof value === 'string' ? value.trim() : ''
}

/** A saved policy: carrier, policy number, or a scanned binder. */
export function insuranceProfileIsOnFile(profile: StoredInsuranceProfile | null | undefined): boolean {
  if (!profile || !text(profile, 'updatedAt')) return false
  return Boolean(text(profile, 'carrier') || text(profile, 'policyNumber') || text(profile, 'binderFileName'))
}

async function upsertRow(
  landlordId: string,
  building: string,
  propertyId: string | null,
  profile: StoredInsuranceProfile,
): Promise<boolean> {
  if (!supabase) return false
  const { error } = await supabase.from('property_insurance_profiles').upsert(
    {
      landlord_id: landlordId,
      building: building.trim(),
      property_id: propertyId,
      profile: toDatabaseProfile(profile),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'landlord_id,building' },
  )
  if (error) console.warn('[property-insurance] save failed', error.message)
  return !error
}

/**
 * Load the saved profile for a property. The database wins; the browser copy
 * contributes only the binder file. A browser-only profile is uploaded once.
 */
export async function loadPropertyInsuranceProfile(
  building: string,
  propertyId: string | null = null,
  landlordId: string = getActiveLandlordId(),
): Promise<StoredInsuranceProfile | null> {
  const name = building.trim()
  if (!name || !landlordId) return null
  const local = readLocal(landlordId, name)
  if (!supabase) return local

  const { data, error } = await supabase
    .from('property_insurance_profiles')
    .select('profile')
    .eq('landlord_id', landlordId)
    .eq('building', name)
    .maybeSingle()
  if (error) {
    console.warn('[property-insurance] load failed; using this browser’s copy', error.message)
    return local
  }

  const remote =
    data?.profile && typeof data.profile === 'object' ? (data.profile as StoredInsuranceProfile) : null
  if (remote) {
    const sameBinder = local && text(local, 'binderFileName') === text(remote, 'binderFileName')
    const merged: StoredInsuranceProfile = {
      ...remote,
      binderFileUrl: sameBinder ? (local?.binderFileUrl ?? null) : null,
    }
    writeLocal(landlordId, name, merged)
    return merged
  }

  if (local && insuranceProfileIsOnFile(local)) {
    await upsertRow(landlordId, name, propertyId, local)
  }
  return local
}

/** Save to the database and keep the browser copy (with the binder file) in sync. */
export async function savePropertyInsuranceProfile(
  building: string,
  propertyId: string | null,
  profile: StoredInsuranceProfile,
  landlordId: string = getActiveLandlordId(),
): Promise<{ savedToAccount: boolean }> {
  const name = building.trim()
  if (!name || !landlordId) return { savedToAccount: false }
  writeLocal(landlordId, name, profile)
  return { savedToAccount: await upsertRow(landlordId, name, propertyId, profile) }
}

export async function deletePropertyInsuranceProfile(
  building: string,
  landlordId: string = getActiveLandlordId(),
): Promise<{ deletedFromAccount: boolean }> {
  const name = building.trim()
  if (!name || !landlordId) return { deletedFromAccount: false }
  writeLocal(landlordId, name, null)
  if (!supabase) return { deletedFromAccount: false }
  const { error } = await supabase
    .from('property_insurance_profiles')
    .delete()
    .eq('landlord_id', landlordId)
    .eq('building', name)
  if (error) console.warn('[property-insurance] delete failed', error.message)
  return { deletedFromAccount: !error }
}

/** Property names with a saved policy on the account (for scoring and setup progress). */
export async function loadInsuredPropertyNames(
  landlordId: string = getActiveLandlordId(),
): Promise<string[]> {
  if (!supabase || !landlordId) return []
  const { data, error } = await supabase
    .from('property_insurance_profiles')
    .select('building, profile')
    .eq('landlord_id', landlordId)
    .limit(500)
  if (error || !data) return []
  return (data as Array<{ building: unknown; profile: unknown }>)
    .filter((row) =>
      insuranceProfileIsOnFile(
        row.profile && typeof row.profile === 'object' ? (row.profile as StoredInsuranceProfile) : null,
      ),
    )
    .map((row) => String(row.building ?? '').trim())
    .filter(Boolean)
}
