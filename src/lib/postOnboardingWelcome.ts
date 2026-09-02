import { getActiveLandlordId } from '@/lib/activeLandlord'
import { isLimitedAlpha1Landlord } from '@shared/landlordCapabilities'

const SEEN_KEY_PREFIX = 'ulo.postOnboardingWelcomeSeen.'

function seenKey(landlordId: string): string {
  return `${SEEN_KEY_PREFIX}${landlordId}`
}

function hasSeenWelcome(landlordId: string): boolean {
  try {
    return window.localStorage.getItem(seenKey(landlordId)) === '1'
  } catch {
    return false
  }
}

/** Limited Alpha 1 sees the Figma all-set screen once after setup, until Get Started. */
export function shouldShowLimitedAlphaPostOnboardingWelcome(
  onboardingCompleted: boolean,
  landlordId: string = getActiveLandlordId(),
): boolean {
  return (
    onboardingCompleted &&
    isLimitedAlpha1Landlord(landlordId) &&
    !hasSeenWelcome(landlordId)
  )
}

export function markLimitedAlphaPostOnboardingWelcomeSeen(
  landlordId: string = getActiveLandlordId(),
): void {
  if (!isLimitedAlpha1Landlord(landlordId)) return
  try {
    window.localStorage.setItem(seenKey(landlordId), '1')
  } catch {
    // private mode
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
