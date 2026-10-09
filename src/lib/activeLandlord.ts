/**
 * Active landlord account resolution.
 *
 * Every admin dashboard query is scoped to one landlord account:
 *  - limitedalpha1@ulohome.io  → Limited Alpha 1
 *  - limitedalpha2@ulohome.io  → Limited Alpha 2 (empty new-user onboarding)
 *  - ceorentalsnj@gmail.com    → Limited Alpha 1
 *  - iokafor0@gmail.com        → Limited Alpha 2
 *  - moreceo@gmail.com         → Limited Alpha 2
 *  - nyshaunbrown@gmail.com    → Limited Alpha 2
 *  - otbpictures12@gmail.com   → Limited Alpha 2
 *  - nwankwo908@gmail.com      → Limited Alpha 2
 *  - bfamiloni@gmail.com       → Limited Alpha 2
 *  - adesanmi.ogunfowora@gmail.com → Limited Alpha 2
 *  - braimahm@gmail.com        → Limited Alpha 2
 *  - demo@ulohome.io           → Demo Property Management (seeded showcase)
 *  - staff logins              → Limited Alpha 1, with a switcher for Demo and Limited Alpha 2
 *
 * Full Alpha and New Landlord are retired. Stale overrides and those ids
 * resolve to Limited Alpha 1.
 *
 * The login email mapping always wins over the switcher override, so demo data
 * can never leak into a real customer account or vice versa.
 *
 * Onboarding writes are fail-closed to Limited Alpha accounts
 * (see requireOnboardingLandlord). Wipe only from Reset onboarding.
 */

import {
  EMPTY_LANDLORD_ID,
  FULL_ALPHA_LANDLORD_ID,
  LIMITED_ALPHA_1_LANDLORD_ID,
  LIMITED_ALPHA_2_LANDLORD_ID,
} from '@shared/landlordCapabilities'
import {
  DEMO_LANDLORD_ID,
  LIMITED_ALPHA_1_LOGIN_EMAIL,
  LIMITED_ALPHA_2_LOGIN_EMAIL,
  canonicalizeLandlordId,
  seededLandlordIdForEmail,
} from '@shared/admin/landlordAccess'

export {
  EMPTY_LANDLORD_ID,
  FULL_ALPHA_LANDLORD_ID,
  LIMITED_ALPHA_1_LANDLORD_ID,
  LIMITED_ALPHA_2_LANDLORD_ID,
}

export const DEFAULT_LANDLORD_ID = LIMITED_ALPHA_1_LANDLORD_ID

export { DEMO_LANDLORD_ID, LIMITED_ALPHA_1_LOGIN_EMAIL, LIMITED_ALPHA_2_LOGIN_EMAIL }

/** Showcase move-out WO-D777 — stable id for lease-renewal kickoff demos. */
export const DEMO_MOVE_OUT_WO_D777_RUN_ID = 'd7770000-0000-4000-8000-000000000001'

export type LandlordAccountKind = 'default' | 'demo' | 'empty' | 'limited_alpha'

export type LandlordAccountOption = {
  kind: LandlordAccountKind
  id: string
  label: string
}

export const LANDLORD_ACCOUNT_OPTIONS: LandlordAccountOption[] = [
  { kind: 'limited_alpha', id: LIMITED_ALPHA_1_LANDLORD_ID, label: 'Limited Alpha 1' },
  { kind: 'limited_alpha', id: LIMITED_ALPHA_2_LANDLORD_ID, label: 'Limited Alpha 2' },
  { kind: 'demo', id: DEMO_LANDLORD_ID, label: 'Demo Property Management' },
]

/** True when this address is a seeded portal / Alpha login (not a company support email). */
export function isSeededLandlordLoginEmail(email: string | null | undefined): boolean {
  return seededLandlordIdForEmail(email) != null
}

const OVERRIDE_STORAGE_KEY = 'ulo.adminActiveLandlord'
/** Set when entering Demo via landing Try Demo (hides staff account switcher). */
const TRY_DEMO_VISITOR_KEY = 'ulo.tryDemoVisitor'
/** One-shot welcome modal after finishing the landing Try Demo flow. */
const TRY_DEMO_WELCOME_PENDING_KEY = 'ulo.tryDemoWelcomePending'
/** Set after the visitor dismisses the welcome so it does not reappear every route change. */
const TRY_DEMO_WELCOME_SEEN_KEY = 'ulo.tryDemoWelcomeSeen'

/** Landlord bound to the signed-in account email (null for staff logins). */
let sessionLandlordId: string | null = null

export function setSessionLandlordFromEmail(email: string | null | undefined): void {
  sessionLandlordId = seededLandlordIdForEmail(email)
}

/** Bind dashboard scope for seeded logins or saved team-member emails. */
export async function bindSessionLandlordFromEmail(
  email: string | null | undefined,
): Promise<void> {
  const normalized = email?.trim().toLowerCase() ?? ''
  if (!normalized) {
    sessionLandlordId = null
    return
  }
  const seeded = seededLandlordIdForEmail(normalized)
  if (seeded) {
    sessionLandlordId = seeded
    return
  }
  const { landlordIdForPortalMemberEmail } = await import('@/lib/landlordPortalMembers')
  const memberLandlordId = await landlordIdForPortalMemberEmail(normalized)
  sessionLandlordId = memberLandlordId ? canonicalizeLandlordId(memberLandlordId) : null
}

export function getSessionLandlordId(): string | null {
  return sessionLandlordId
}

function readOverride(): string | null {
  try {
    const value = window.localStorage.getItem(OVERRIDE_STORAGE_KEY)?.trim()
    if (!value) return null
    const canonical = canonicalizeLandlordId(value)
    return LANDLORD_ACCOUNT_OPTIONS.some((opt) => opt.id === canonical) ? canonical : null
  } catch {
    return null
  }
}

/**
 * Retired New Landlord sandbox id. Limited Alpha 1 is the live account.
 */
export function isEmptyOnboardingLandlordId(landlordId: string): boolean {
  return landlordId === EMPTY_LANDLORD_ID
}

/**
 * Resolve the landlord id all admin queries must scope to.
 * Precedence: landing Try Demo visitor → account-bound landlord (login email)
 * → testing override → default.
 */
export function getActiveLandlordId(): string {
  if (isTryDemoVisitor()) return DEMO_LANDLORD_ID
  return canonicalizeLandlordId(sessionLandlordId ?? readOverride() ?? DEFAULT_LANDLORD_ID)
}

export function getActiveLandlordKind(): LandlordAccountKind {
  const id = getActiveLandlordId()
  if (id === DEMO_LANDLORD_ID) return 'demo'
  if (id === EMPTY_LANDLORD_ID) return 'empty'
  if (id === LIMITED_ALPHA_1_LANDLORD_ID || id === LIMITED_ALPHA_2_LANDLORD_ID) {
    return 'limited_alpha'
  }
  return 'default'
}

export function getActiveLandlordLabel(): string {
  const id = getActiveLandlordId()
  return LANDLORD_ACCOUNT_OPTIONS.find((opt) => opt.id === id)?.label ?? 'Limited Alpha 1'
}

export function isDemoAccountActive(): boolean {
  return getActiveLandlordKind() === 'demo'
}

/**
 * Persist Demo Property Management as the active landlord scope for the next
 * admin load (public /demo entry + staff switcher).
 * Landing Try Demo uses prepareTryDemoLandlordScope so Demo wins over a
 * session-bound Alpha login for that visit.
 */
export function prepareDemoLandlordScope(): void {
  try {
    window.localStorage.setItem(OVERRIDE_STORAGE_KEY, DEMO_LANDLORD_ID)
  } catch {
    // localStorage unavailable (private mode)
  }
}

/** True when the current Demo session came from the landing Try Demo journey. */
export function isTryDemoVisitor(): boolean {
  try {
    return window.localStorage.getItem(TRY_DEMO_VISITOR_KEY) === '1'
  } catch {
    return false
  }
}

export function clearTryDemoVisitor(): void {
  try {
    window.localStorage.removeItem(TRY_DEMO_VISITOR_KEY)
  } catch {
    // ignore
  }
  // Do not clear welcome here — AuthGate may sign out a stale session during the
  // /demo → /admin hop before AdminLayout mounts. Welcome clears on dismiss / sign-out explicit.
}

/** True when the landing Try Demo welcome modal should show once. */
export function isTryDemoWelcomePending(): boolean {
  try {
    if (window.localStorage.getItem(TRY_DEMO_WELCOME_SEEN_KEY) === '1') return false
    if (window.localStorage.getItem(TRY_DEMO_WELCOME_PENDING_KEY) === '1') return true
    if (window.sessionStorage.getItem(TRY_DEMO_WELCOME_PENDING_KEY) === '1') return true
    // Fallback: any Try Demo visitor who has not dismissed welcome yet.
    return window.localStorage.getItem(TRY_DEMO_VISITOR_KEY) === '1'
  } catch {
    return false
  }
}

export function markTryDemoWelcomePending(): void {
  try {
    window.localStorage.setItem(TRY_DEMO_WELCOME_PENDING_KEY, '1')
    window.localStorage.removeItem(TRY_DEMO_WELCOME_SEEN_KEY)
  } catch {
    // localStorage unavailable
  }
  try {
    window.sessionStorage.setItem(TRY_DEMO_WELCOME_PENDING_KEY, '1')
  } catch {
    // ignore
  }
}

export function clearTryDemoWelcomePending(): void {
  try {
    window.localStorage.removeItem(TRY_DEMO_WELCOME_PENDING_KEY)
    window.localStorage.setItem(TRY_DEMO_WELCOME_SEEN_KEY, '1')
  } catch {
    // ignore
  }
  try {
    window.sessionStorage.removeItem(TRY_DEMO_WELCOME_PENDING_KEY)
  } catch {
    // ignore
  }
}

export function isTryDemoWelcomeSeen(): boolean {
  try {
    return window.localStorage.getItem(TRY_DEMO_WELCOME_SEEN_KEY) === '1'
  } catch {
    return false
  }
}

/**
 * Enter Demo from the landing Try Demo modal (final Next or Explore).
 * Hides the staff account switcher for this Demo visit.
 */
export function prepareTryDemoLandlordScope(): void {
  prepareDemoLandlordScope()
  try {
    window.localStorage.setItem(TRY_DEMO_VISITOR_KEY, '1')
  } catch {
    // localStorage unavailable (private mode)
  }
  markTryDemoWelcomePending()
}

/**
 * Switch the active account for testing (staff logins only) and reload so all
 * dashboards refetch under the new scope.
 */
export function setActiveLandlordOverride(landlordId: string | null): void {
  clearTryDemoVisitor()
  try {
    const next = landlordId ? canonicalizeLandlordId(landlordId) : DEFAULT_LANDLORD_ID
    if (!next || next === DEFAULT_LANDLORD_ID) {
      window.localStorage.removeItem(OVERRIDE_STORAGE_KEY)
      window.location.reload()
      return
    }

    window.localStorage.setItem(OVERRIDE_STORAGE_KEY, next)
  } catch {
    // localStorage unavailable (private mode) — switching silently unsupported
  }
  window.location.reload()
}
