/** Core staff emails allowed for edge proxied-message admin auth. */
export const ADMIN_CORE_ALLOWED_EMAILS = [
  'emeka@ulohome.io',
  'osi@ulohome.io',
] as const

/** Demo / empty-onboarding landlord portal accounts (client admin login only). */
export const ADMIN_DEMO_ALLOWED_EMAILS = [
  'demo@ulohome.io',
  'newlandlord@ulohome.io',
  'limitedalpha1@ulohome.io',
] as const

/** Production landlord portal accounts (client admin login only). */
export const ADMIN_PRODUCTION_ALLOWED_EMAILS = [
  'ceorentalsnj@gmail.com',
] as const

export const ADMIN_LOGIN_EMAIL_DOMAIN = 'property-admin.auth.local'

const coreSet = new Set<string>(ADMIN_CORE_ALLOWED_EMAILS)
const portalSet = new Set<string>([
  ...ADMIN_CORE_ALLOWED_EMAILS,
  ...ADMIN_DEMO_ALLOWED_EMAILS,
  ...ADMIN_PRODUCTION_ALLOWED_EMAILS,
])

export function loginIdToAdminEmail(loginId: string): string {
  const t = loginId.trim().toLowerCase()
  if (!t) return t
  if (t.includes('@')) return loginId.trim()
  return `${t}@${ADMIN_LOGIN_EMAIL_DOMAIN}`
}

export function normalizeAdminEmail(loginIdOrEmail: string): string {
  return loginIdToAdminEmail(loginIdOrEmail).trim().toLowerCase()
}

/** Edge proxied SMS — core staff or `@property-admin.auth.local`. */
export function isStaffAdminEmail(email: string | null | undefined): boolean {
  const normalized = (email ?? '').trim().toLowerCase()
  if (!normalized) return false
  if (coreSet.has(normalized)) return true
  return normalized.endsWith(`@${ADMIN_LOGIN_EMAIL_DOMAIN}`)
}

/** Client admin portal — explicit allowlist (includes demo accounts). */
export function isPortalAdminEmailAllowed(loginIdOrEmail: string): boolean {
  return portalSet.has(normalizeAdminEmail(loginIdOrEmail))
}
