import { getActiveLandlordId } from '@/lib/activeLandlord'
import { CORE_VENDOR_TRADES } from '@/lib/propertyHealth/calculatePropertyHealth'
import {
  isLeaseImportTestLandlord,
  isLimitedAlphaLandlord,
  isTemporarySharedAlphaLineLandlord,
} from '@shared/landlordCapabilities'
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
  /** Still missing. Counted in the setup percentage. */
  remaining: number
  /** Plain-language leftover line under the task. Empty when nothing is left. */
  detail: string | null
}

export type SetupSuccessProgress = {
  items: SetupSuccessItemState[]
  doneCount: number
  total: number
  /** Filled units across residents, vendors, trades, and properties. */
  completedUnits: number
  /** Units that can be filled. */
  unitTotal: number
}

type SetupResident = { phone?: string | null; activationStatus?: string | null }

function welcomeWasSent(resident: SetupResident): boolean {
  const status = (resident.activationStatus ?? '').trim().toLowerCase()
  return status !== '' && status !== 'not_started'
}

export function welcomeTextsComplete(residents: SetupResident[]): boolean {
  return residents.some(welcomeWasSent)
}

/** Residents who have not been sent a welcome text yet. */
export function residentsMissingWelcomeText(residents: SetupResident[]): number {
  return residents.filter((resident) => !welcomeWasSent(resident)).length
}

function countLabel(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`
}

/** Leftover line under a setup task. Vendors list activation and missing trades separately. */
export function setupTaskDetail(input: {
  id: SetupSuccessItemId
  welcomeRemaining: number
  vendorsNeedingActivation: number
  tradesLeft: number
  propertiesLeft: number
}): string | null {
  if (input.id === 'welcome_texts') {
    return input.welcomeRemaining > 0
      ? `${countLabel(input.welcomeRemaining, 'resident', 'residents')} left`
      : null
  }
  if (input.id === 'verify_vendors') {
    const parts: string[] = []
    if (input.vendorsNeedingActivation > 0) {
      parts.push(
        input.vendorsNeedingActivation === 1
          ? '1 vendor needs activation'
          : `${input.vendorsNeedingActivation} vendors need activation`,
      )
    }
    if (input.tradesLeft > 0) {
      parts.push(
        input.tradesLeft === 1 ? '1 trade left to add' : `${input.tradesLeft} trades left to add`,
      )
    }
    return parts.length > 0 ? parts.join(', ') : null
  }
  if (
    input.id === 'property_access' ||
    input.id === 'property_intelligence' ||
    input.id === 'property_insurance'
  ) {
    return input.propertiesLeft > 0
      ? `${countLabel(input.propertiesLeft, 'property', 'properties')} left`
      : null
  }
  return null
}

function boundedCount(value: number, max: number): number {
  const count = Math.floor(value)
  if (!Number.isFinite(count)) return 0
  return Math.max(0, Math.min(max, count))
}

export function resolveSetupSuccessProgress(input: {
  residents: SetupResident[]
  vendorCount: number
  /** Vendors with a verification invite started, verified, or onboarding overridden. */
  vendorOutreachStartedCount: number
  /** Core trades with no vendor on the roster. */
  missingTradeCount?: number
  propertyCount?: number
  propertiesMissingAccess?: number
  propertiesMissingDetails?: number
  propertiesMissingInsurance?: number
  hasMaintenancePreferences: boolean
  maintenanceRequestCount: number
  hasTestDelivery?: boolean
}): SetupSuccessProgress {
  const residentTotal = input.residents.length
  const welcomeRemaining = residentsMissingWelcomeText(input.residents)
  const vendorTotal = Math.max(0, Math.floor(input.vendorCount))
  const vendorsInvited = boundedCount(input.vendorOutreachStartedCount, vendorTotal)
  const vendorsNotInvited = vendorTotal - vendorsInvited
  const tradeTotal = CORE_VENDOR_TRADES.length
  const tradesMissing = boundedCount(input.missingTradeCount ?? tradeTotal, tradeTotal)
  const propertyTotal = Math.max(0, Math.floor(input.propertyCount ?? 0))
  const accessMissing = boundedCount(input.propertiesMissingAccess ?? propertyTotal, propertyTotal)
  const detailsMissing = boundedCount(input.propertiesMissingDetails ?? propertyTotal, propertyTotal)
  const insuranceMissing = boundedCount(input.propertiesMissingInsurance ?? propertyTotal, propertyTotal)
  const preferencesDone = input.hasMaintenancePreferences
  const testDone = Boolean(input.hasTestDelivery) || input.maintenanceRequestCount > 0

  const remainingById: Record<SetupSuccessItemId, number> = {
    welcome_texts: welcomeRemaining,
    verify_vendors: vendorsNotInvited + tradesMissing,
    property_access: accessMissing,
    property_intelligence: detailsMissing,
    property_insurance: insuranceMissing,
    maintenance_prefs: preferencesDone ? 0 : 1,
    test_request: testDone ? 0 : 1,
  }
  const doneById: Record<SetupSuccessItemId, boolean> = {
    welcome_texts: residentTotal > 0 && welcomeRemaining === 0,
    verify_vendors: vendorTotal > 0 && vendorsNotInvited === 0 && tradesMissing === 0,
    property_access: propertyTotal > 0 && accessMissing === 0,
    property_intelligence: propertyTotal > 0 && detailsMissing === 0,
    property_insurance: propertyTotal > 0 && insuranceMissing === 0,
    maintenance_prefs: preferencesDone,
    test_request: testDone,
  }
  const propertiesLeftById: Record<SetupSuccessItemId, number> = {
    welcome_texts: 0,
    verify_vendors: 0,
    property_access: accessMissing,
    property_intelligence: detailsMissing,
    property_insurance: insuranceMissing,
    maintenance_prefs: 0,
    test_request: 0,
  }
  const items = SETUP_SUCCESS_ITEMS.map((item) => ({
    ...item,
    done: doneById[item.id],
    remaining: remainingById[item.id],
    detail: setupTaskDetail({
      id: item.id,
      welcomeRemaining,
      vendorsNeedingActivation: vendorsNotInvited,
      tradesLeft: tradesMissing,
      propertiesLeft: propertiesLeftById[item.id],
    }),
  }))
  const completedUnits =
    residentTotal -
    welcomeRemaining +
    vendorsInvited +
    (tradeTotal - tradesMissing) +
    (propertyTotal - accessMissing) +
    (propertyTotal - detailsMissing) +
    (propertyTotal - insuranceMissing) +
    (preferencesDone ? 1 : 0) +
    (testDone ? 1 : 0)
  const unitTotal = residentTotal + vendorTotal + tradeTotal + propertyTotal * 3 + 2
  return {
    items,
    doneCount: items.filter((item) => item.done).length,
    total: items.length,
    completedUnits,
    unitTotal,
  }
}

export function setupSuccessPercent(progress: SetupSuccessProgress): number {
  if (progress.unitTotal <= 0) return 0
  return Math.round((progress.completedUnits / progress.unitTotal) * 100)
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
const MINIMIZED_KEY_PREFIX = 'ulo.setupSuccessCardMinimized.'

function dismissedKey(landlordId: string): string {
  return `${DISMISSED_KEY_PREFIX}${landlordId}`
}

function minimizedKey(landlordId: string): string {
  return `${MINIMIZED_KEY_PREFIX}${landlordId}`
}

const COMPLETE_INFORMATION_PROMPT_KEY_PREFIX = 'ulo.setupSuccess.completeInformationPrompt.'

function completeInformationPromptKey(landlordId: string): string {
  return `${COMPLETE_INFORMATION_PROMPT_KEY_PREFIX}${landlordId}`
}

/** Properties page “Complete information” — show the access prompt on the setup card. */
export function markSetupSuccessCompleteInformationPrompt(
  landlordId: string = getActiveLandlordId(),
): void {
  try {
    window.sessionStorage.setItem(completeInformationPromptKey(landlordId), '1')
  } catch {
    // private mode
  }
}

export function isSetupSuccessCompleteInformationPrompt(
  landlordId: string = getActiveLandlordId(),
): boolean {
  try {
    return window.sessionStorage.getItem(completeInformationPromptKey(landlordId)) === '1'
  } catch {
    return false
  }
}

export function clearSetupSuccessCompleteInformationPrompt(
  landlordId: string = getActiveLandlordId(),
): void {
  try {
    window.sessionStorage.removeItem(completeInformationPromptKey(landlordId))
  } catch {
    // private mode
  }
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

/** Session-only hide after starting a checklist step — does not survive a full page refresh. */
export function isSetupSuccessCardMinimized(
  landlordId: string = getActiveLandlordId(),
): boolean {
  try {
    return window.sessionStorage.getItem(minimizedKey(landlordId)) === '1'
  } catch {
    return false
  }
}

export function isSetupSuccessCardHidden(
  landlordId: string = getActiveLandlordId(),
): boolean {
  return isSetupSuccessCardDismissed(landlordId) || isSetupSuccessCardMinimized(landlordId)
}

export function dismissSetupSuccessCard(
  landlordId: string = getActiveLandlordId(),
): void {
  try {
    window.localStorage.setItem(dismissedKey(landlordId), '1')
  } catch {
    // private mode
  }
  clearSetupSuccessCardMinimized(landlordId)
  emitSetupSuccessCollapsedChange()
}

/** Hide for this tab only (checklist row click). Refresh brings the card back. */
export function minimizeSetupSuccessCard(
  landlordId: string = getActiveLandlordId(),
): void {
  try {
    window.sessionStorage.setItem(minimizedKey(landlordId), '1')
  } catch {
    // private mode
  }
  emitSetupSuccessCollapsedChange()
}

export function clearSetupSuccessCardMinimized(
  landlordId: string = getActiveLandlordId(),
): void {
  try {
    window.sessionStorage.removeItem(minimizedKey(landlordId))
  } catch {
    // private mode
  }
}

export function clearSetupSuccessCardDismissed(
  landlordId: string = getActiveLandlordId(),
): void {
  try {
    window.localStorage.removeItem(dismissedKey(landlordId))
  } catch {
    // private mode
  }
  clearSetupSuccessCardMinimized(landlordId)
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

/**
 * Limited Alpha sees the card after Get Started.
 * Lease-import checks and the disposable maintenance-test account land on the
 * dashboard directly, so they do not need that flag.
 * Completing setup does not mark the checklist done.
 */
export function setupSuccessExperienceReady(
  landlordId: string = getActiveLandlordId(),
): boolean {
  if (isLimitedAlphaLandlord(landlordId)) {
    return hasSeenLimitedAlphaPostOnboardingWelcome(landlordId)
  }
  return isLeaseImportTestLandlord(landlordId) || isTemporarySharedAlphaLineLandlord(landlordId)
}

/** Profile setup card after setup, until every step is done or the card is closed. */
export function shouldShowSetupSuccessCard(
  progress: SetupSuccessProgress,
  landlordId: string = getActiveLandlordId(),
): boolean {
  return (
    setupSuccessExperienceReady(landlordId) &&
    !isSetupSuccessCardHidden(landlordId) &&
    progress.doneCount < progress.total
  )
}

/** Compact Profile setup row in the sidebar until every checklist step is done. */
export function shouldShowSetupSuccessNavHint(
  progress: SetupSuccessProgress,
  landlordId: string = getActiveLandlordId(),
): boolean {
  return setupSuccessExperienceReady(landlordId) && progress.doneCount < progress.total
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
