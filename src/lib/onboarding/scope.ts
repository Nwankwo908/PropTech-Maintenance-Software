/**
 * Onboarding landlord scope guards — New Landlord (empty) only.
 */
import {
  EMPTY_LANDLORD_ID,
  getActiveLandlordId,
  getActiveLandlordKind,
} from '@/lib/activeLandlord'

export function isOnboardingLandlordAccount(
  landlordId: string = getActiveLandlordId(),
): boolean {
  return landlordId === EMPTY_LANDLORD_ID || getActiveLandlordKind() === 'empty'
}

/** Fail closed: onboarding mutations must never write to demo/default landlords. */
export function requireOnboardingLandlord(
  landlordId: string = getActiveLandlordId(),
): { ok: true; landlordId: string } | { ok: false; error: string } {
  if (!isOnboardingLandlordAccount(landlordId)) {
    return {
      ok: false,
      error:
        'Wrong landlord scope — switch to New Landlord (empty) before onboarding. Demo and Ulo Operations data stays isolated.',
    }
  }
  if (landlordId !== EMPTY_LANDLORD_ID) {
    return {
      ok: false,
      error: 'Wrong landlord scope — onboarding only writes to the New Landlord account.',
    }
  }
  return { ok: true, landlordId }
}
