/**
 * Onboarding resident ID allocation (ULO-#### style sequences).
 *
 * `users.resident_id` is globally unique. Scope onboarding IDs by landlord so
 * New Landlord never collides with Demo/Ulo `ONB-001` rows.
 */
import { getActiveLandlordId } from '@/lib/activeLandlord'
import { supabase } from '@/lib/supabase'
import { fetchOnboardingResidents } from './persist/residents'
import type { OnboardingResident } from './persist/residents'

export function onboardingResidentIdPrefix(landlordId: string): string {
  const compact = landlordId.replace(/-/g, '').slice(0, 8).toUpperCase()
  return `ONB${compact}`
}

export function parseOnboardingResidentSequence(
  residentId: string,
  landlordId?: string,
): number | null {
  const id = residentId.trim()
  if (!id) return null
  if (landlordId) {
    const prefix = `${onboardingResidentIdPrefix(landlordId)}-`
    if (id.toUpperCase().startsWith(prefix)) {
      const parsed = Number.parseInt(id.slice(prefix.length), 10)
      return Number.isFinite(parsed) ? parsed : null
    }
  }
  const legacy = Number.parseInt(id.replace(/^(ONB-|RES-)/i, ''), 10)
  return Number.isFinite(legacy) ? legacy : null
}

export function maxOnboardingResidentSequence(
  residents: OnboardingResident[],
  landlordId?: string,
): number {
  let max = 0
  for (const resident of residents) {
    const parsed = parseOnboardingResidentSequence(resident.residentId, landlordId)
    if (parsed != null) max = Math.max(max, parsed)
  }
  return max
}

export function nextOnboardingResidentIdFromSequence(
  sequence: number,
  landlordId: string = getActiveLandlordId(),
): string {
  return `${onboardingResidentIdPrefix(landlordId)}-${String(sequence).padStart(3, '0')}`
}

export async function nextOnboardingResidentId(
  landlordId: string = getActiveLandlordId(),
): Promise<string> {
  const residents = await fetchOnboardingResidents(landlordId)
  return nextOnboardingResidentIdFromSequence(
    maxOnboardingResidentSequence(residents, landlordId) + 1,
    landlordId,
  )
}

/** Next free landlord-scoped resident_id, checking DB so retries stay collision-free. */
export async function allocateOnboardingResidentId(
  landlordId: string = getActiveLandlordId(),
): Promise<string> {
  let seq = 0
  if (supabase) {
    const prefix = `${onboardingResidentIdPrefix(landlordId)}-`
    const { data, error } = await supabase
      .from('users')
      .select('resident_id')
      .like('resident_id', `${prefix}%`)
    if (error) {
      console.warn('[landlordOnboarding] allocate resident id', error.message)
    }
    for (const row of data ?? []) {
      const parsed = parseOnboardingResidentSequence(
        String((row as { resident_id?: string }).resident_id ?? ''),
        landlordId,
      )
      if (parsed != null) seq = Math.max(seq, parsed)
    }
  } else {
    seq = maxOnboardingResidentSequence(
      await fetchOnboardingResidents(landlordId),
      landlordId,
    )
  }
  return nextOnboardingResidentIdFromSequence(seq + 1, landlordId)
}
