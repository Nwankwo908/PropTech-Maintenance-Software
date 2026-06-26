import type { Session } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'

/**
 * When the login field has no `@`, it is treated as the local-part of this email
 * (create the user in Supabase Auth — e.g. admin@property-admin.auth.local).
 */
export const ADMIN_LOGIN_EMAIL_DOMAIN = 'property-admin.auth.local'

export const ADMIN_ACCESS_DENIED_MESSAGE =
  'This account is not authorized to access the admin portal.'

const ADMIN_ALLOWED_EMAILS = new Set([
  'emeka@ulohome.io',
  'osi@ulohome.io',
  // Landlord showcase accounts (see src/lib/activeLandlord.ts)
  'demo@ulohome.io',
  'newlandlord@ulohome.io',
])

export function loginIdToEmail(loginId: string): string {
  const t = loginId.trim().toLowerCase()
  if (!t) return t
  if (t.includes('@')) return loginId.trim()
  return `${t}@${ADMIN_LOGIN_EMAIL_DOMAIN}`
}

export function normalizeAdminEmail(loginId: string): string {
  return loginIdToEmail(loginId).trim().toLowerCase()
}

export function isAdminEmailAllowed(loginIdOrEmail: string): boolean {
  return ADMIN_ALLOWED_EMAILS.has(normalizeAdminEmail(loginIdOrEmail))
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

export async function signInAdmin(loginId: string, password: string): Promise<void> {
  if (!supabase) throw new Error('Supabase is not configured.')
  assertAdminEmailAllowed(loginId)
  const email = loginIdToEmail(loginId)
  const { error } = await supabase.auth.signInWithPassword({
    email,
    password: password.trim(),
  })
  if (error) throw new Error(error.message)
}

export async function sendAdminEmailOtp(loginId: string): Promise<void> {
  if (!supabase) throw new Error('Supabase is not configured.')
  assertAdminEmailAllowed(loginId)
  const email = loginIdToEmail(loginId)
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: false },
  })
  if (error) throw new Error(error.message)
}

export async function verifyAdminEmailOtp(loginId: string, token: string): Promise<void> {
  if (!supabase) throw new Error('Supabase is not configured.')
  assertAdminEmailAllowed(loginId)
  const email = loginIdToEmail(loginId)
  const { error } = await supabase.auth.verifyOtp({
    email,
    token: token.replace(/\s/g, '').trim(),
    type: 'email',
  })
  if (error) throw new Error(error.message)
}

export async function signInAdminWithOAuth(provider: 'google' | 'apple'): Promise<void> {
  if (!supabase) throw new Error('Supabase is not configured.')
  const { error } = await supabase.auth.signInWithOAuth({
    provider,
    options: { redirectTo: `${window.location.origin}/auth/callback` },
  })
  if (error) throw new Error(error.message)
}

export async function signOutAdmin(): Promise<void> {
  if (!supabase) return
  await supabase.auth.signOut()
}
