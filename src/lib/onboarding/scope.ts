/**
 * Onboarding landlord scope guards — New Landlord, Limited Alpha 1, Full Alpha.
 */
import { LIMITED_ALPHA_1_LANDLORD_ID } from '@shared/landlordCapabilities'
import {
  DEFAULT_LANDLORD_ID,
  DEMO_LANDLORD_ID,
  EMPTY_LANDLORD_ID,
  getActiveLandlordId,
} from '@/lib/activeLandlord'

/** Landlord ids that run the setup wizard until onboarding_status = completed. */
export const ONBOARDING_LANDLORD_IDS = [
  EMPTY_LANDLORD_ID,
  LIMITED_ALPHA_1_LANDLORD_ID,
  DEFAULT_LANDLORD_ID,
] as const

export type OnboardingLandlordId = (typeof ONBOARDING_LANDLORD_IDS)[number]

export function isOnboardingLandlordAccount(
  landlordId: string = getActiveLandlordId(),
): boolean {
  return (ONBOARDING_LANDLORD_IDS as readonly string[]).includes(landlordId)
}

/** Fail closed: onboarding mutations must never write to demo/showcase landlords. */
export function requireOnboardingLandlord(
  landlordId: string = getActiveLandlordId(),
): { ok: true; landlordId: string } | { ok: false; error: string } {
  if (landlordId === DEMO_LANDLORD_ID) {
    return {
      ok: false,
      error:
        'Wrong landlord scope — demo data is read-only. Switch to Full Alpha, Limited Alpha 1, or New Landlord before onboarding.',
    }
  }
  if (!isOnboardingLandlordAccount(landlordId)) {
    return {
      ok: false,
      error:
        'Wrong landlord scope — onboarding only runs on Full Alpha, Limited Alpha 1, or New Landlord accounts.',
    }
  }
  return { ok: true, landlordId }
}
