import { getActiveLandlordId } from '@/lib/activeLandlord'
import { isLimitedAlpha1Landlord } from '@shared/landlordCapabilities'
import { hasSeenLimitedAlphaPostOnboardingWelcome } from '@/lib/postOnboardingWelcome'

export const SETUP_SUCCESS_TEST_DELIVERY_HASH = 'test-delivery'

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
    id: 'property_access',
    label: 'Set up property access',
    to: '/admin/properties',
  },
  {
    id: 'property_intelligence',
    label: 'Add property details',
    to: '/admin/properties',
  },
  {
    id: 'property_insurance',
    label: 'Add insurance details',
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
    to: `/admin/settings/operations/notifications#${SETUP_SUCCESS_TEST_DELIVERY_HASH}`,
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
  return residents.some((row) => {
    const status = (row.activationStatus ?? '').trim().toLowerCase()
    return status !== '' && status !== 'not_started'
  })
}

export function resolveSetupSuccessProgress(input: {
  residents: { phone?: string | null; activationStatus?: string | null }[]
  vendorCount: number
  /** Vendors with a verification invite started, verified, or onboarding overridden. */
  vendorOutreachStartedCount: number
  propertyAccessComplete: boolean
  propertyIntelligenceComplete: boolean
  propertyInsuranceComplete: boolean
  hasMaintenancePreferences: boolean
  maintenanceRequestCount: number
  hasTestDelivery?: boolean
}): SetupSuccessProgress {
  const doneById: Record<SetupSuccessItemId, boolean> = {
    welcome_texts: welcomeTextsComplete(input.residents),
    // Roster alone (e.g. onboarding import) is not enough — invite/override must start.
    verify_vendors: input.vendorOutreachStartedCount > 0,
    property_access: input.propertyAccessComplete,
    property_intelligence: input.propertyIntelligenceComplete,
    property_insurance: input.propertyInsuranceComplete,
    maintenance_prefs: input.hasMaintenancePreferences,
    test_request: Boolean(input.hasTestDelivery) || input.maintenanceRequestCount > 0,
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

/** Fired whenever setup-success checklist progress may have changed (same-tab). */
export const SETUP_SUCCESS_PROGRESS_CHANGED_EVENT = 'ulo:setup-success-progress-changed'

/** Hover guide: Overview health KPI points at the Profile setup nav item. */
export const PROFILE_SETUP_NAV_POINT_EVENT = 'ulo:profile-setup-nav-point'
export const PROFILE_SETUP_NAV_ATTR = 'data-ulo-profile-setup-nav'

export function setProfileSetupNavPointed(active: boolean): void {
  try {
    if (typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(
        new CustomEvent(PROFILE_SETUP_NAV_POINT_EVENT, { detail: { active } }),
      )
    }
  } catch {
    // jsdom / private mode
  }
}

function emitSetupSuccessCollapsedChange(): void {
  try {
    if (typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(new Event(SETUP_SUCCESS_COLLAPSED_EVENT))
    }
  } catch {
    // jsdom / private mode
  }
}

/** Tell Profile setup / Get set up hosts to reload percent (same-tab; `storage` does not fire). */
export function notifySetupSuccessProgressChanged(): void {
  try {
    if (typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(new Event(SETUP_SUCCESS_PROGRESS_CHANGED_EVENT))
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

const TEST_DELIVERY_KEY_PREFIX = 'ulo.setupSuccess.testDelivery.'

function testDeliveryKey(landlordId: string): string {
  return `${TEST_DELIVERY_KEY_PREFIX}${landlordId}`
}

export function isSetupSuccessTestDeliveryComplete(
  landlordId: string = getActiveLandlordId(),
): boolean {
  try {
    return window.localStorage.getItem(testDeliveryKey(landlordId)) === '1'
  } catch {
    return false
  }
}

/** Email or SMS Test delivery on Notifications — completes the setup-success test step. */
export function markSetupSuccessTestDeliveryComplete(
  landlordId: string = getActiveLandlordId(),
): void {
  try {
    window.localStorage.setItem(testDeliveryKey(landlordId), '1')
  } catch {
    // private mode
  }
  notifySetupSuccessProgressChanged()
}

export function clearSetupSuccessTestDelivery(
  landlordId: string = getActiveLandlordId(),
): void {
  try {
    window.localStorage.removeItem(testDeliveryKey(landlordId))
  } catch {
    // private mode
  }
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

/** Compact Profile setup row in the sidebar until every checklist step is done. */
export function shouldShowSetupSuccessNavHint(
  progress: SetupSuccessProgress,
  landlordId: string = getActiveLandlordId(),
): boolean {
  return (
    isLimitedAlpha1Landlord(landlordId) &&
    hasSeenLimitedAlphaPostOnboardingWelcome(landlordId) &&
    progress.doneCount < progress.total
  )
}

/** How long the green ↑ +N% flash stays under Profile setup after progress increases. */
export const SETUP_SUCCESS_NAV_GAIN_FLASH_MS = 4000

const NAV_PERCENT_KEY_PREFIX = 'ulo.setupSuccessNavPercent.'

function navPercentKey(landlordId: string): string {
  return `${NAV_PERCENT_KEY_PREFIX}${landlordId}`
}

export function readSetupSuccessNavPercentBaseline(
  landlordId: string = getActiveLandlordId(),
): number | null {
  try {
    const raw = window.localStorage.getItem(navPercentKey(landlordId))
    if (raw == null || raw === '') return null
    const n = Number(raw)
    return Number.isFinite(n) ? n : null
  } catch {
    return null
  }
}

export function writeSetupSuccessNavPercentBaseline(
  percent: number,
  landlordId: string = getActiveLandlordId(),
): void {
  try {
    window.localStorage.setItem(navPercentKey(landlordId), String(Math.max(0, Math.round(percent))))
  } catch {
    // private mode
  }
}

export function clearSetupSuccessNavPercentBaseline(
  landlordId: string = getActiveLandlordId(),
): void {
  try {
    window.localStorage.removeItem(navPercentKey(landlordId))
  } catch {
    // private mode
  }
}

/** Positive percent-point gain since the last baseline, or 0 if none. */
export function setupSuccessNavPercentGain(
  nextPercent: number,
  landlordId: string = getActiveLandlordId(),
): number {
  const prev = readSetupSuccessNavPercentBaseline(landlordId)
  if (prev == null) {
    writeSetupSuccessNavPercentBaseline(nextPercent, landlordId)
    return 0
  }
  const gain = Math.round(nextPercent) - Math.round(prev)
  if (gain > 0) {
    writeSetupSuccessNavPercentBaseline(nextPercent, landlordId)
    return gain
  }
  if (Math.round(nextPercent) !== Math.round(prev)) {
    writeSetupSuccessNavPercentBaseline(nextPercent, landlordId)
  }
  return 0
}
