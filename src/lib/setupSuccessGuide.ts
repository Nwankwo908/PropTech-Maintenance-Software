import { getActiveLandlordId } from '@/lib/activeLandlord'
import { isLimitedAlpha1Landlord } from '@shared/landlordCapabilities'
import type { SetupSuccessItemId } from '@/lib/setupSuccessChecklist'

export type SetupSuccessCheckboxGuidePage = 'vendors' | 'residents' | 'properties' | 'property_tab'

export const SETUP_SUCCESS_PROPERTY_TAB_GUIDE_MESSAGE =
  'Complete your property details to shift maintenance from reactive to proactive.'

export function setupCheckboxGuidePropertyTabState(): { setupCheckboxGuide: 'property_tab' } {
  return { setupCheckboxGuide: 'property_tab' }
}

const PENDING_KEY_PREFIX = 'ulo.setupSuccessCheckboxGuide.pending.'
const SEEN_KEY_PREFIX = 'ulo.setupSuccessCheckboxGuide.seen.'

function pendingKey(landlordId: string): string {
  return `${PENDING_KEY_PREFIX}${landlordId}`
}

function seenKey(page: SetupSuccessCheckboxGuidePage, landlordId: string): string {
  return `${SEEN_KEY_PREFIX}${page}.${landlordId}`
}

function pageForSetupItem(itemId: SetupSuccessItemId): SetupSuccessCheckboxGuidePage | null {
  if (itemId === 'welcome_texts') return 'residents'
  if (itemId === 'verify_vendors') return 'vendors'
  if (itemId === 'property_details') return 'properties'
  return null
}

/** Router state so the coachmark only runs after that Get set up card link. */
export function setupCheckboxGuideLinkState(
  itemId: SetupSuccessItemId,
): { setupCheckboxGuide: SetupSuccessCheckboxGuidePage } | undefined {
  const page = pageForSetupItem(itemId)
  if (!page) return undefined
  return { setupCheckboxGuide: page }
}

export function isSetupSuccessCheckboxGuideNavigation(
  state: unknown,
  page: SetupSuccessCheckboxGuidePage,
): boolean {
  if (!state || typeof state !== 'object') return false
  return (state as { setupCheckboxGuide?: string }).setupCheckboxGuide === page
}

/** After welcome texts or vendor verify, show the checkbox coachmark on that list. */
export function markSetupSuccessCheckboxGuidePending(
  itemId: SetupSuccessItemId,
  landlordId: string = getActiveLandlordId(),
): void {
  if (!isLimitedAlpha1Landlord(landlordId)) return
  const page = pageForSetupItem(itemId)
  if (!page) return
  try {
    window.localStorage.setItem(pendingKey(landlordId), page)
  } catch {
    // private mode
  }
}

export function shouldShowSetupSuccessCheckboxGuide(
  page: SetupSuccessCheckboxGuidePage,
  landlordId: string = getActiveLandlordId(),
): boolean {
  if (!isLimitedAlpha1Landlord(landlordId)) return false
  try {
    if (window.localStorage.getItem(seenKey(page, landlordId)) === '1') return false
    return window.localStorage.getItem(pendingKey(landlordId)) === page
  } catch {
    return false
  }
}

export function dismissSetupSuccessCheckboxGuide(
  page: SetupSuccessCheckboxGuidePage,
  landlordId: string = getActiveLandlordId(),
): void {
  try {
    window.localStorage.setItem(seenKey(page, landlordId), '1')
    window.localStorage.removeItem(pendingKey(landlordId))
  } catch {
    // private mode
  }
}

export function clearSetupSuccessCheckboxGuide(
  landlordId: string = getActiveLandlordId(),
): void {
  try {
    window.localStorage.removeItem(pendingKey(landlordId))
    for (const page of ['vendors', 'residents', 'properties', 'property_tab'] as const) {
      window.localStorage.removeItem(seenKey(page, landlordId))
    }
  } catch {
    // private mode
  }
}
