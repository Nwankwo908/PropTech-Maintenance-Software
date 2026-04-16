import type { SupabaseClient } from '@supabase/supabase-js'
import { supabase } from './supabase'

export type ResidentAuthPayload = {
  accessToken: string
  userId: string
}

/**
 * Proactive refresh then read session (Supabase client also auto-refreshes on getSession when configured).
 * Shared by getValidAccessToken / getValidResidentSubmitAuth.
 */
async function refreshAndGetSession(client: SupabaseClient) {
  await client.auth.refreshSession()
  return client.auth.getSession()
}

/**
 * Returns a non-empty access token after refresh, or throws.
 * Use before Edge Function calls so Authorization always carries a current JWT.
 */
export async function getValidAccessToken(client: SupabaseClient): Promise<string> {
  const { data, error } = await refreshAndGetSession(client)
  if (error || !data.session) throw new Error('No active session')
  const token = data.session.access_token?.trim()
  if (!token) throw new Error('No active session')
  return token
}

export type ValidResidentSubmitAuth = ResidentAuthPayload & {
  email: string | null
}

/**
 * Fresh session after refreshSession + getSession; includes email for form matching.
 */
export async function getValidResidentSubmitAuth(
  client: SupabaseClient,
): Promise<ValidResidentSubmitAuth> {
  const { data, error } = await refreshAndGetSession(client)
  if (error || !data.session?.user) throw new Error('No active session')
  const session = data.session
  const accessToken = session.access_token?.trim()
  const userId = session.user.id
  if (!accessToken || !userId?.trim()) throw new Error('No active session')
  return {
    accessToken,
    userId,
    email: session.user.email ?? null,
  }
}

/** Seconds before "Resend code" is enabled again after a send. */
export const OTP_RESEND_COOLDOWN_SECONDS = 60

/** Maps Supabase Auth errors to clearer copy for residents. */
function userFacingAuthError(raw: string): string {
  const m = raw.toLowerCase()
  if (
    m.includes('rate limit') ||
    m.includes('too many') ||
    m.includes('over_email_send_rate_limit') ||
    m.includes('email rate')
  ) {
    return 'Too many verification emails were sent from this app. Please wait a few minutes, then use Resend code or try again later. If you are testing, reduce how often you request a new code.'
  }
  return raw
}

/**
 * True when the email OTP gate should run and submit must send a user JWT to Edge.
 * In Vite dev, auth is skipped only when `VITE_MAINTENANCE_API_URL` is unset (local demo submit).
 * If the real submit Edge URL is configured, dev behaves like production so `Authorization` is not the anon key.
 */
export function isResidentAuthEnabled(): boolean {
  if (supabase === null) return false
  if (import.meta.env.DEV) {
    return Boolean(import.meta.env.VITE_MAINTENANCE_API_URL?.trim())
  }
  return true
}

/** Active Supabase session if any (no email check). Useful for follow-up actions after submit. */
export async function getCurrentResidentSession(): Promise<ResidentAuthPayload | null> {
  if (!supabase) return null
  const { data, error } = await supabase.auth.getSession()
  if (error || !data.session?.user) return null
  return {
    accessToken: data.session.access_token,
    userId: data.session.user.id,
  }
}

/**
 * Rotates the access token via the refresh token. Returns fresh credentials from
 * the refresh response (not a stale `getSession()` read).
 */
export async function refreshResidentSession(): Promise<ResidentAuthPayload | null> {
  if (!supabase) return null
  const { data, error } = await supabase.auth.refreshSession()
  if (error || !data.session?.user) {
    console.warn('[residentAuth] refreshSession:', error?.message)
    return null
  }
  return {
    accessToken: data.session.access_token,
    userId: data.session.user.id,
  }
}

/**
 * Ensures a valid access token for the signed-in user and that their email
 * matches `email` before calling Edge Functions or Auth `updateUser`.
 */
export async function ensureResidentAuthForEmail(
  email: string,
): Promise<ResidentAuthPayload | null> {
  if (!supabase) return null
  const want = email.trim().toLowerCase()
  const refreshed = await refreshResidentSession()
  if (refreshed) {
    const { data } = await supabase.auth.getSession()
    const em = data.session?.user?.email?.trim().toLowerCase()
    if (em === want) return refreshed
  }
  return getSessionMatchingEmail(email)
}

export async function getSessionMatchingEmail(
  email: string,
): Promise<ResidentAuthPayload | null> {
  if (!supabase) return null
  const { data, error } = await supabase.auth.getSession()
  if (error || !data.session?.user) return null
  const sessionEmail = data.session.user.email?.trim().toLowerCase()
  if (!sessionEmail || sessionEmail !== email.trim().toLowerCase()) return null
  return {
    accessToken: data.session.access_token,
    userId: data.session.user.id,
  }
}

/**
 * Sends an email OTP. No magic-link redirect — the app verifies with `verifyOtp`.
 * Dashboard: edit **Confirm signup** and **Magic link** templates to include `{{ .Token }}`
 * (global for all residents — see `supabase/AUTH_EMAIL_OTP.md` Option A).
 */
export async function sendEmailOtp(email: string): Promise<void> {
  if (!supabase) throw new Error('Sign-in is not configured.')
  const { error } = await supabase.auth.signInWithOtp({
    email: email.trim(),
    options: {
      shouldCreateUser: true,
      // Omit emailRedirectTo: not needed for in-app OTP and ties templates to link redirects.
    },
  })
  if (error) throw new Error(userFacingAuthError(error.message))
}

export async function verifyEmailOtpAndSignIn(
  email: string,
  token: string,
): Promise<ResidentAuthPayload> {
  if (!supabase) throw new Error('Sign-in is not configured.')
  const { data, error } = await supabase.auth.verifyOtp({
    email: email.trim(),
    token: token.replace(/\s/g, '').trim(),
    type: 'email',
  })
  if (error) throw new Error(userFacingAuthError(error.message))
  if (!data.session) throw new Error('No session after verification.')
  return {
    accessToken: data.session.access_token,
    userId: data.session.user.id,
  }
}

/** Stores resident fields on the Supabase user (JWT `user_metadata`) for your API to read. */
export async function syncResidentProfileMetadata(
  residentName: string,
  unit: string,
): Promise<void> {
  if (!supabase) return
  const { error } = await supabase.auth.updateUser({
    data: {
      resident_name: residentName.trim(),
      unit_number: unit.trim(),
    },
  })
  if (error) throw new Error(error.message)
}
