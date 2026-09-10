import type { Session } from '@supabase/supabase-js'
import {
  isPortalAdminEmailAllowed,
  isStaffAdminEmail,
  loginIdToAdminEmail,
} from '@shared/admin/staffAllowlist'
import { emailFromAuthUser } from '@shared/authUserEmail'
import { supabase } from '@/lib/supabase'
import { getErrorMessage } from '@/lib/errorMessage'
import { landlordIdForPortalMemberEmail } from '@/lib/landlordPortalMembers'
import { markAdminGoogleOAuthIntent, adminGoogleOAuthRedirectTo } from '@/lib/googleIdentitySignIn'

export { ADMIN_LOGIN_EMAIL_DOMAIN, normalizeAdminEmail } from '@shared/admin/staffAllowlist'

export const ADMIN_ACCESS_DENIED_MESSAGE =
  'This account is not authorized to access the admin portal.'

export function loginIdToEmail(loginId: string): string {
  return loginIdToAdminEmail(loginId)
}

export function isAdminEmailAllowed(loginIdOrEmail: string): boolean {
  return isPortalAdminEmailAllowed(loginIdOrEmail) || isStaffAdminEmail(loginIdOrEmail)
}

export async function isAdminEmailAllowedAsync(loginIdOrEmail: string): Promise<boolean> {
  if (isAdminEmailAllowed(loginIdOrEmail)) return true
  return Boolean(await landlordIdForPortalMemberEmail(loginIdToEmail(loginIdOrEmail)))
}

export async function isAdminSessionAllowed(session: Session | null): Promise<boolean> {
  const email = emailFromAuthSession(session)
  if (!email) return false
  return isAdminEmailAllowedAsync(email)
}

/** Email on the Auth user: `email`, then Google identity / metadata (id-token sign-in). */
export function emailFromAuthSession(session: Session | null): string {
  return emailFromAuthUser(session?.user ?? null)
}

export async function getAdminSession(timeoutMs = 4000): Promise<Session | null> {
  if (!supabase) return null
  try {
    const result = await Promise.race([
      supabase.auth.getSession(),
      new Promise<{ data: { session: null } }>((resolve) => {
        window.setTimeout(() => resolve({ data: { session: null } }), timeoutMs)
      }),
    ])
    return result.data.session
  } catch {
    return null
  }
}

async function assertAdminEmailAllowed(loginId: string): Promise<void> {
  if (!(await isAdminEmailAllowedAsync(loginId))) {
    throw new Error(ADMIN_ACCESS_DENIED_MESSAGE)
  }
}

const SERVICE_UNAVAILABLE =
  "We can't reach the server right now. Please try again in a moment."

export async function signInAdmin(loginId: string, password: string): Promise<void> {
  if (!supabase) throw new Error(SERVICE_UNAVAILABLE)
  await assertAdminEmailAllowed(loginId)
  const email = loginIdToEmail(loginId)
  const { error } = await supabase.auth.signInWithPassword({
    email,
    password: password.trim(),
  })
  if (error) {
    throw new Error(getErrorMessage(error, 'Could not sign in. Check your details and try again.'))
  }
}

export async function sendAdminEmailOtp(loginId: string): Promise<void> {
  if (!supabase) throw new Error(SERVICE_UNAVAILABLE)
  await assertAdminEmailAllowed(loginId)
  const email = loginIdToEmail(loginId)
  // First-time allowlisted testers have no auth.users row yet. OTP must create it.
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: true },
  })
  if (error) {
    throw new Error(getErrorMessage(error, 'Could not send a sign-in code. Please try again.'))
  }
}

export async function verifyAdminEmailOtp(loginId: string, token: string): Promise<void> {
  if (!supabase) throw new Error(SERVICE_UNAVAILABLE)
  await assertAdminEmailAllowed(loginId)
  const email = loginIdToEmail(loginId)
  const { error } = await supabase.auth.verifyOtp({
    email,
    token: token.replace(/\s/g, '').trim(),
    type: 'email',
  })
  if (error) {
    const mapped = getErrorMessage(error, "That code didn’t work. Please try again.")
    throw new Error(
      mapped === "You don't have permission to do that."
        ? "That code didn’t work. Please try again."
        : mapped,
    )
  }
}

export async function startAdminGoogleOAuthRedirect(): Promise<void> {
  if (!supabase) throw new Error(SERVICE_UNAVAILABLE)
  const host = window.location.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (host === 'ulohome.io' || host === 'app.ulohome.io') {
    markAdminGoogleOAuthIntent()
    window.location.assign('https://www.ulohome.io/admin/login?google=1')
    return
  }
  markAdminGoogleOAuthIntent()
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: adminGoogleOAuthRedirectTo(window.location.origin),
      skipBrowserRedirect: true,
      queryParams: { prompt: 'select_account' },
    },
  })
  if (error || !data.url) {
    throw new Error(getErrorMessage(error, 'Could not continue with that sign-in option.'))
  }
  window.location.assign(data.url)
}

export async function signInAdminWithOAuth(provider: 'google' | 'apple'): Promise<void> {
  if (!supabase) throw new Error(SERVICE_UNAVAILABLE)
  if (provider === 'google') markAdminGoogleOAuthIntent()
  const { error } = await supabase.auth.signInWithOAuth({
    provider,
    options: { redirectTo: adminGoogleOAuthRedirectTo(window.location.origin) },
  })
  if (error) {
    throw new Error(getErrorMessage(error, 'Could not continue with that sign-in option.'))
  }
}

export async function signOutAdmin(): Promise<void> {
  if (!supabase) return
  try {
    await Promise.race([
      supabase.auth.signOut(),
      new Promise<void>((resolve) => {
        window.setTimeout(resolve, 3000)
      }),
    ])
  } catch {
    // Ignore so a hung auth lock cannot trap the login screen.
  }
}
