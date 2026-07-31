import type { Session } from '@supabase/supabase-js'
import {
  ADMIN_LOGIN_EMAIL_DOMAIN,
  isPortalAdminEmailAllowed,
  loginIdToAdminEmail,
} from '@shared/admin/staffAllowlist'
import { supabase } from '@/lib/supabase'
import { getErrorMessage } from '@/lib/errorMessage'

export { ADMIN_LOGIN_EMAIL_DOMAIN, normalizeAdminEmail } from '@shared/admin/staffAllowlist'

export const ADMIN_ACCESS_DENIED_MESSAGE =
  'This account is not authorized to access the admin portal.'

export function loginIdToEmail(loginId: string): string {
  return loginIdToAdminEmail(loginId)
}

export function isAdminEmailAllowed(loginIdOrEmail: string): boolean {
  return isPortalAdminEmailAllowed(loginIdOrEmail)
}

export function isAdminSessionAllowed(session: Session | null): boolean {
  const email = session?.user?.email?.trim()
  if (!email) return false
  return isAdminEmailAllowed(email)
}

function assertAdminEmailAllowed(loginId: string): void {
  if (!isAdminEmailAllowed(loginId)) {
    throw new Error(ADMIN_ACCESS_DENIED_MESSAGE)
  }
}

const SERVICE_UNAVAILABLE =
  "We can't reach the server right now. Please try again in a moment."

export async function signInAdmin(loginId: string, password: string): Promise<void> {
  if (!supabase) throw new Error(SERVICE_UNAVAILABLE)
  assertAdminEmailAllowed(loginId)
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
  assertAdminEmailAllowed(loginId)
  const email = loginIdToEmail(loginId)
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: false },
  })
  if (error) {
    throw new Error(getErrorMessage(error, 'Could not send a sign-in code. Please try again.'))
  }
}

export async function verifyAdminEmailOtp(loginId: string, token: string): Promise<void> {
  if (!supabase) throw new Error(SERVICE_UNAVAILABLE)
  assertAdminEmailAllowed(loginId)
  const email = loginIdToEmail(loginId)
  const { error } = await supabase.auth.verifyOtp({
    email,
    token: token.replace(/\s/g, '').trim(),
    type: 'email',
  })
  if (error) {
    throw new Error(getErrorMessage(error, 'That code didn’t work. Please try again.'))
  }
}

export async function signInAdminWithOAuth(provider: 'google' | 'apple'): Promise<void> {
  if (!supabase) throw new Error(SERVICE_UNAVAILABLE)
  const { error } = await supabase.auth.signInWithOAuth({
    provider,
    options: { redirectTo: `${window.location.origin}/auth/callback` },
  })
  if (error) {
    throw new Error(getErrorMessage(error, 'Could not continue with that sign-in option.'))
  }
}

export async function signOutAdmin(): Promise<void> {
  if (!supabase) return
  await supabase.auth.signOut()
}
