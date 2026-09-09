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
  isRetiredLandlordAccountId,
  LIMITED_ALPHA_1_LANDLORD_ID,
  LIMITED_ALPHA_2_LANDLORD_ID,
} from '@shared/landlordCapabilities'

export {
  EMPTY_LANDLORD_ID,
  FULL_ALPHA_LANDLORD_ID,
  LIMITED_ALPHA_1_LANDLORD_ID,
  LIMITED_ALPHA_2_LANDLORD_ID,
}

export const DEFAULT_LANDLORD_ID = LIMITED_ALPHA_1_LANDLORD_ID

export const DEMO_LANDLORD_ID = 'de300000-0000-4000-8000-000000000001'

export const LIMITED_ALPHA_1_LOGIN_EMAIL = 'limitedalpha1@ulohome.io'
export const LIMITED_ALPHA_2_LOGIN_EMAIL = 'limitedalpha2@ulohome.io'

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

const EMAIL_TO_LANDLORD_ID: Record<string, string> = {
  'ceorentalsnj@gmail.com': LIMITED_ALPHA_1_LANDLORD_ID,
  'iokafor0@gmail.com': LIMITED_ALPHA_2_LANDLORD_ID,
  'moreceo@gmail.com': LIMITED_ALPHA_2_LANDLORD_ID,
  'nyshaunbrown@gmail.com': LIMITED_ALPHA_2_LANDLORD_ID,
  [LIMITED_ALPHA_1_LOGIN_EMAIL]: LIMITED_ALPHA_1_LANDLORD_ID,
  [LIMITED_ALPHA_2_LOGIN_EMAIL]: LIMITED_ALPHA_2_LANDLORD_ID,
  'demo@ulohome.io': DEMO_LANDLORD_ID,
}

const OVERRIDE_STORAGE_KEY = 'ulo.adminActiveLandlord'

/** Landlord bound to the signed-in account email (null for staff logins). */
let sessionLandlordId: string | null = null

function canonicalizeLandlordId(landlordId: string): string {
  if (isRetiredLandlordAccountId(landlordId)) return LIMITED_ALPHA_1_LANDLORD_ID
  return landlordId
}

export function setSessionLandlordFromEmail(email: string | null | undefined): void {
  const normalized = email?.trim().toLowerCase() ?? ''
  sessionLandlordId = EMAIL_TO_LANDLORD_ID[normalized] ?? null
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
  const seeded = EMAIL_TO_LANDLORD_ID[normalized]
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
 * Precedence: account-bound landlord (login email) → testing override → default.
 */
export function getActiveLandlordId(): string {
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
 * admin load (public /demo entry + staff switcher). Session-bound emails still win.
 */
export function prepareDemoLandlordScope(): void {
  try {
    window.localStorage.setItem(OVERRIDE_STORAGE_KEY, DEMO_LANDLORD_ID)
  } catch {
    // localStorage unavailable (private mode)
  }
}

/**
 * Switch the active account for testing (staff logins only) and reload so all
 * dashboards refetch under the new scope.
 */
export function setActiveLandlordOverride(landlordId: string | null): void {
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
