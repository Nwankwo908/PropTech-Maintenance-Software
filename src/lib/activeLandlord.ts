/**
 * Active landlord account resolution.
 *
 * Every admin dashboard query is scoped to one landlord account:
 *  - demo@ulohome.io        → Demo Property Management (seeded showcase data)
 *  - newlandlord@ulohome.io → New Landlord (empty state / onboarding)
 *  - staff logins           → default landlord (existing operational data),
 *                             with a dev account switcher override for testing.
 *
 * The login email mapping always wins over the switcher override, so demo data
 * can never leak into a real customer account or vice versa.
 *
 * Onboarding writes are fail-closed to EMPTY_LANDLORD_ID only (see
 * requireOnboardingLandlord). Switching to New Landlord always resets via
 * /admin/onboarding?reset=1 so prior fast-track imports cannot linger.
 */

export const DEFAULT_LANDLORD_ID =
  import.meta.env.VITE_DEFAULT_LANDLORD_ID?.trim() ||
  '068daf53-07e4-4493-bd7f-6106e3c8c62f'

export const DEMO_LANDLORD_ID = 'de300000-0000-4000-8000-000000000001'
export const EMPTY_LANDLORD_ID = 'de300000-0000-4000-8000-000000000002'

/** Showcase move-out WO-D777 — stable id for lease-renewal kickoff demos. */
export const DEMO_MOVE_OUT_WO_D777_RUN_ID = 'd7770000-0000-4000-8000-000000000001'

export type LandlordAccountKind = 'default' | 'demo' | 'empty'

export type LandlordAccountOption = {
  kind: LandlordAccountKind
  id: string
  label: string
}

export const LANDLORD_ACCOUNT_OPTIONS: LandlordAccountOption[] = [
  { kind: 'default', id: DEFAULT_LANDLORD_ID, label: 'Ulo Operations' },
  { kind: 'demo', id: DEMO_LANDLORD_ID, label: 'Demo Property Management' },
  { kind: 'empty', id: EMPTY_LANDLORD_ID, label: 'New Landlord (empty)' },
]

const EMAIL_TO_LANDLORD_ID: Record<string, string> = {
  'demo@ulohome.io': DEMO_LANDLORD_ID,
  'newlandlord@ulohome.io': EMPTY_LANDLORD_ID,
}

const OVERRIDE_STORAGE_KEY = 'ulo.adminActiveLandlord'

/** Landlord bound to the signed-in account email (null for staff logins). */
let sessionLandlordId: string | null = null

export function setSessionLandlordFromEmail(email: string | null | undefined): void {
  const normalized = email?.trim().toLowerCase() ?? ''
  sessionLandlordId = EMAIL_TO_LANDLORD_ID[normalized] ?? null
}

export function getSessionLandlordId(): string | null {
  return sessionLandlordId
}

function readOverride(): string | null {
  try {
    const value = window.localStorage.getItem(OVERRIDE_STORAGE_KEY)?.trim()
    if (!value) return null
    return LANDLORD_ACCOUNT_OPTIONS.some((opt) => opt.id === value) ? value : null
  } catch {
    return null
  }
}

/**
 * Resolve the landlord id all admin queries must scope to.
 * Precedence: account-bound landlord (login email) → testing override → default.
 */
export function getActiveLandlordId(): string {
  return sessionLandlordId ?? readOverride() ?? DEFAULT_LANDLORD_ID
}

export function getActiveLandlordKind(): LandlordAccountKind {
  const id = getActiveLandlordId()
  if (id === DEMO_LANDLORD_ID) return 'demo'
  if (id === EMPTY_LANDLORD_ID) return 'empty'
  return 'default'
}

export function isDemoAccountActive(): boolean {
  return getActiveLandlordKind() === 'demo'
}

/**
 * Switch the active account for testing (staff logins only) and reload so all
 * dashboards refetch under the new scope.
 */
export function setActiveLandlordOverride(landlordId: string | null): void {
  try {
    if (!landlordId || landlordId === DEFAULT_LANDLORD_ID) {
      window.localStorage.removeItem(OVERRIDE_STORAGE_KEY)
      window.location.reload()
      return
    }

    window.localStorage.setItem(OVERRIDE_STORAGE_KEY, landlordId)
    if (landlordId === EMPTY_LANDLORD_ID) {
      window.localStorage.removeItem(`ulo.landlordOnboarding.${EMPTY_LANDLORD_ID}`)
      window.location.assign('/admin/onboarding?reset=1')
      return
    }
  } catch {
    // localStorage unavailable (private mode) — switching silently unsupported
  }
  window.location.reload()
}
