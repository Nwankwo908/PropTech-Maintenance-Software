import { getActiveLandlordId } from '@/lib/activeLandlord'
import { isLimitedAlpha1Landlord, LIMITED_ALPHA_1_LANDLORD_ID } from '@shared/landlordCapabilities'

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

/** Limited Alpha 1 sees the all-set screen on the onboarding route until Get Started. */
export function shouldShowLimitedAlphaPostOnboardingWelcome(
  onboardingCompleted: boolean,
  landlordId: string = getActiveLandlordId(),
): boolean {
  return (
    onboardingCompleted &&
    isLimitedAlpha1Landlord(landlordId) &&
    !hasSeenLimitedAlphaPostOnboardingWelcome(landlordId)
  )
}

export function markLimitedAlphaPostOnboardingWelcomeSeen(
  landlordId: string = getActiveLandlordId(),
): void {
  const candidates = [landlordId.trim(), getActiveLandlordId().trim()]
  const ids = new Set(candidates.filter((id) => isLimitedAlpha1Landlord(id)))
  if (ids.size > 0) ids.add(LIMITED_ALPHA_1_LANDLORD_ID)
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
