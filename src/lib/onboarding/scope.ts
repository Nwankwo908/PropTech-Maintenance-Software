/**
 * Onboarding landlord scope guards — Limited Alpha accounts.
 */
import {
  isOnboardingLandlordId,
  ONBOARDING_LANDLORD_IDS,
} from '@shared/landlordCapabilities'
import { DEMO_LANDLORD_ID, getActiveLandlordId } from '@/lib/activeLandlord'

export { ONBOARDING_LANDLORD_IDS }

export type OnboardingLandlordId = (typeof ONBOARDING_LANDLORD_IDS)[number]

export function isOnboardingLandlordAccount(
  landlordId: string = getActiveLandlordId(),
): boolean {
  return isOnboardingLandlordId(landlordId)
}

/** Fail closed: onboarding mutations must never write to demo/showcase landlords. */
export function requireOnboardingLandlord(
  landlordId: string = getActiveLandlordId(),
): { ok: true; landlordId: string } | { ok: false; error: string } {
  if (landlordId === DEMO_LANDLORD_ID) {
    return {
      ok: false,
      error:
        'Wrong landlord scope — demo data is read-only. Switch to a Limited Alpha account before onboarding.',
    }
  }
  if (!isOnboardingLandlordAccount(landlordId)) {
    return {
      ok: false,
      error: 'Wrong landlord scope — onboarding only runs on Limited Alpha accounts.',
    }
  }
  return { ok: true, landlordId }
}
