import { getActiveLandlordId } from '@/lib/activeLandlord'
import { isLimitedAlpha1Landlord } from '@shared/landlordCapabilities'
import type { SetupSuccessItemId } from '@/lib/setupSuccessChecklist'

export type SetupSuccessCheckboxGuidePage =
  | 'vendors'
  | 'residents'
  | 'properties'
  | 'property_tab'
  | 'test_delivery'

export const SETUP_SUCCESS_PROPERTY_TAB_GUIDE_MESSAGE =
  'Complete your property details to shift maintenance from reactive to proactive.'

export const SETUP_SUCCESS_TEST_DELIVERY_GUIDE_MESSAGE =
  'Select button to confirm your number is working'

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

function storageGet(key: string): string | null {
  try {
    const sessionValue = window.sessionStorage?.getItem(key)
    if (sessionValue) return sessionValue
  } catch {
    // private mode
  }
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function storageSet(key: string, value: string): void {
  try {
    window.sessionStorage?.setItem(key, value)
  } catch {
    // private mode
  }
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // private mode
  }
}

function storageRemove(key: string): void {
  try {
    window.sessionStorage?.removeItem(key)
  } catch {
    // private mode
  }
  try {
    window.localStorage.removeItem(key)
  } catch {
    // private mode
  }
}

function pageForSetupItem(itemId: SetupSuccessItemId): SetupSuccessCheckboxGuidePage | null {
  if (itemId === 'welcome_texts') return 'residents'
  if (itemId === 'verify_vendors') return 'vendors'
  if (itemId === 'property_details') return 'properties'
  if (itemId === 'test_request') return 'test_delivery'
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

export function markSetupSuccessCheckboxGuidePagePending(
  page: SetupSuccessCheckboxGuidePage,
  landlordId: string = getActiveLandlordId(),
): void {
  if (!isLimitedAlpha1Landlord(landlordId)) return
  storageSet(pendingKey(landlordId), page)
}

/** After a Get set up row is tapped, show the coachmark on the destination page. */
export function markSetupSuccessCheckboxGuidePending(
  itemId: SetupSuccessItemId,
  landlordId: string = getActiveLandlordId(),
): void {
  const page = pageForSetupItem(itemId)
  if (!page) return
  markSetupSuccessCheckboxGuidePagePending(page, landlordId)
}

export function shouldShowSetupSuccessCheckboxGuide(
  page: SetupSuccessCheckboxGuidePage,
  landlordId: string = getActiveLandlordId(),
): boolean {
  if (!isLimitedAlpha1Landlord(landlordId)) return false
  if (storageGet(seenKey(page, landlordId)) === '1') return false
  return storageGet(pendingKey(landlordId)) === page
}

/** Router state is dropped on some mobile navigations (portal sheet, iOS history). */
export function isSetupSuccessCheckboxGuideActive(
  state: unknown,
  page: SetupSuccessCheckboxGuidePage,
): boolean {
  return isSetupSuccessCheckboxGuideNavigation(state, page) || shouldShowSetupSuccessCheckboxGuide(page)
}

export function dismissSetupSuccessCheckboxGuide(
  page: SetupSuccessCheckboxGuidePage,
  landlordId: string = getActiveLandlordId(),
): void {
  storageSet(seenKey(page, landlordId), '1')
  storageRemove(pendingKey(landlordId))
}

export function clearSetupSuccessCheckboxGuide(
  landlordId: string = getActiveLandlordId(),
): void {
  storageRemove(pendingKey(landlordId))
  for (const page of ['vendors', 'residents', 'properties', 'property_tab', 'test_delivery'] as const) {
    storageRemove(seenKey(page, landlordId))
  }
}
