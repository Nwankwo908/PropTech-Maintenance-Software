import { getActiveLandlordId } from '@/lib/activeLandlord'
import { isLimitedAlphaLandlord } from '@shared/landlordCapabilities'

const SEEN_KEY_PREFIX = 'ulo.postOnboardingWelcomeSeen.'

function seenKey(landlordId: string): string {
  return `${SEEN_KEY_PREFIX}${landlordId}`
}

export function hasSeenLimitedAlphaPostOnboardingWelcome(
  landlordId: string = getActiveLandlordId(),
): boolean {
  try {
    return window.localStorage.getItem(seenKey(landlordId)) === '1'
  } catch {
    return false
  }
}

/** Limited Alpha sees the all-set screen on the onboarding route until Get Started. */
export function shouldShowLimitedAlphaPostOnboardingWelcome(
  onboardingCompleted: boolean,
  landlordId: string = getActiveLandlordId(),
): boolean {
  return (
    onboardingCompleted &&
    isLimitedAlphaLandlord(landlordId) &&
    !hasSeenLimitedAlphaPostOnboardingWelcome(landlordId)
  )
}

/**
 * After setup is complete, keep the landlord on All Set until Get Started writes
 * `ulo.postOnboardingWelcomeSeen.<landlordId>`. Do not let them browse Overview
 * (or any other admin route) while that flag is missing — otherwise the Get set
 * up for success card never appears.
 */
export function shouldForcePostOnboardingWelcomeRoute(params: {
  onboardingCompleted: boolean
  onOnboardingRoute: boolean
  landlordId?: string
}): boolean {
  if (params.onOnboardingRoute) return false
  return shouldShowLimitedAlphaPostOnboardingWelcome(
    params.onboardingCompleted,
    params.landlordId,
  )
}

export function markLimitedAlphaPostOnboardingWelcomeSeen(
  landlordId: string = getActiveLandlordId(),
): void {
  const candidates = [landlordId.trim(), getActiveLandlordId().trim()]
  const ids = new Set(candidates.filter((id) => isLimitedAlphaLandlord(id)))
  for (const id of ids) {
    try {
      window.localStorage.setItem(seenKey(id), '1')
    } catch {
      // private mode
    }
  }
}

export function clearLimitedAlphaPostOnboardingWelcomeSeen(
  landlordId: string = getActiveLandlordId(),
): void {
  try {
    window.localStorage.removeItem(seenKey(landlordId))
  } catch {
    // private mode
  }
}
