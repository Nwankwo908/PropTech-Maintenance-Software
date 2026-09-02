import { getActiveLandlordId } from '@/lib/activeLandlord'
import { isLimitedAlpha1Landlord } from '@shared/landlordCapabilities'
import { hasSeenLimitedAlphaPostOnboardingWelcome } from '@/lib/postOnboardingWelcome'

export const SETUP_SUCCESS_ITEMS = [
  {
    id: 'welcome_texts',
    label: 'Send residents their welcome texts',
    to: '/admin/residents',
  },
  {
    id: 'verify_vendors',
    label: 'Invite and verify vendors',
    to: '/admin/vendors',
  },
  {
    id: 'property_details',
    label: 'Property details',
    to: '/admin/properties',
  },
  {
    id: 'maintenance_prefs',
    label: 'Set maintenance preferences',
    to: '/admin/settings/operations/notifications',
  },
  {
    id: 'test_request',
    label: 'Submit a test maintenance request',
    to: '/request',
  },
] as const

export type SetupSuccessItemId = (typeof SETUP_SUCCESS_ITEMS)[number]['id']

export type SetupSuccessItemState = {
  id: SetupSuccessItemId
  label: string
  to: string
  done: boolean
}

export type SetupSuccessProgress = {
  items: SetupSuccessItemState[]
  doneCount: number
  total: number
}

export function welcomeTextsComplete(
  residents: { phone?: string | null; activationStatus?: string | null }[],
): boolean {
  const withPhone = residents.filter((row) => Boolean(row.phone?.trim()))
  if (withPhone.length === 0) return false
  return withPhone.every((row) => {
    const status = (row.activationStatus ?? '').trim().toLowerCase()
    return status !== '' && status !== 'not_started'
  })
}

export function resolveSetupSuccessProgress(input: {
  residents: { phone?: string | null; activationStatus?: string | null }[]
  vendorCount: number
  verifiedVendorCount: number
  propertyDetailsComplete: boolean
  hasMaintenancePreferences: boolean
  maintenanceRequestCount: number
}): SetupSuccessProgress {
  const doneById: Record<SetupSuccessItemId, boolean> = {
    welcome_texts: welcomeTextsComplete(input.residents),
    verify_vendors: input.vendorCount > 0 && input.verifiedVendorCount > 0,
    property_details: input.propertyDetailsComplete,
    maintenance_prefs: input.hasMaintenancePreferences,
    test_request: input.maintenanceRequestCount > 0,
  }
  const items = SETUP_SUCCESS_ITEMS.map((item) => ({
    ...item,
    done: doneById[item.id],
  }))
  return {
    items,
    doneCount: items.filter((item) => item.done).length,
    total: items.length,
  }
}

export function setupSuccessPercent(progress: SetupSuccessProgress): number {
  if (progress.total <= 0) return 0
  return Math.round((progress.doneCount / progress.total) * 100)
}

export const SETUP_SUCCESS_COLLAPSED_EVENT = 'ulo:setup-success-collapsed'

function emitSetupSuccessCollapsedChange(): void {
  try {
    if (typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(new Event(SETUP_SUCCESS_COLLAPSED_EVENT))
    }
  } catch {
    // jsdom / private mode
  }
}

const DISMISSED_KEY_PREFIX = 'ulo.setupSuccessCardDismissed.'

function dismissedKey(landlordId: string): string {
  return `${DISMISSED_KEY_PREFIX}${landlordId}`
}

export function isSetupSuccessCardDismissed(
  landlordId: string = getActiveLandlordId(),
): boolean {
  try {
    return window.localStorage.getItem(dismissedKey(landlordId)) === '1'
  } catch {
    return false
  }
}

export function dismissSetupSuccessCard(
  landlordId: string = getActiveLandlordId(),
): void {
  try {
    window.localStorage.setItem(dismissedKey(landlordId), '1')
  } catch {
    // private mode
  }
  emitSetupSuccessCollapsedChange()
}

export function clearSetupSuccessCardDismissed(
  landlordId: string = getActiveLandlordId(),
): void {
  try {
    window.localStorage.removeItem(dismissedKey(landlordId))
  } catch {
    // private mode
  }
  emitSetupSuccessCollapsedChange()
}

/** Limited Alpha 1 overlay after Get Started, until every step is done or the card is closed. */
export function shouldShowSetupSuccessCard(
  progress: SetupSuccessProgress,
  landlordId: string = getActiveLandlordId(),
): boolean {
  return (
    isLimitedAlpha1Landlord(landlordId) &&
    hasSeenLimitedAlphaPostOnboardingWelcome(landlordId) &&
    !isSetupSuccessCardDismissed(landlordId) &&
    progress.doneCount < progress.total
  )
}

/** Compact Get started row under Settings after the overlay is closed. */
export function shouldShowSetupSuccessNavHint(
  progress: SetupSuccessProgress,
  landlordId: string = getActiveLandlordId(),
): boolean {
  return (
    isLimitedAlpha1Landlord(landlordId) &&
    hasSeenLimitedAlphaPostOnboardingWelcome(landlordId) &&
    isSetupSuccessCardDismissed(landlordId) &&
    progress.doneCount < progress.total
  )
}
