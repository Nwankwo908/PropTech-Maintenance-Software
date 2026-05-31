import { supabase } from '@/lib/supabase'

/**
 * When the login field has no `@`, it is treated as the local-part of this email
 * (create the user in Supabase Auth — e.g. admin@property-admin.auth.local).
 */
export const ADMIN_LOGIN_EMAIL_DOMAIN = 'property-admin.auth.local'

export function loginIdToEmail(loginId: string): string {
  const t = loginId.trim().toLowerCase()
  if (!t) return t
  if (t.includes('@')) return loginId.trim()
  return `${t}@${ADMIN_LOGIN_EMAIL_DOMAIN}`
}

export async function signInAdmin(loginId: string, password: string): Promise<void> {
  if (!supabase) throw new Error('Supabase is not configured.')
  const email = loginIdToEmail(loginId)
  const { error } = await supabase.auth.signInWithPassword({
    email,
    password: password.trim(),
  })
  if (error) throw new Error(error.message)
}

export async function sendAdminEmailOtp(loginId: string): Promise<void> {
  if (!supabase) throw new Error('Supabase is not configured.')
  const email = loginIdToEmail(loginId)
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: true },
  })
  if (error) throw new Error(error.message)
}

export async function verifyAdminEmailOtp(loginId: string, token: string): Promise<void> {
  if (!supabase) throw new Error('Supabase is not configured.')
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
    options: { redirectTo: `${window.location.origin}/admin` },
  })
  if (error) throw new Error(error.message)
}

export async function signOutAdmin(): Promise<void> {
  if (!supabase) return
  await supabase.auth.signOut()
}
