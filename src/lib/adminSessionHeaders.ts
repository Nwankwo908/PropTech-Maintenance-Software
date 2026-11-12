import { supabase } from '@/lib/supabase'

export const ADMIN_SESSION_REQUIRED = 'Please sign in again to continue.'

/** User-session headers for the five F08 dashboard actions only. */
export async function adminSessionInvokeHeaders(): Promise<Record<string, string>> {
  if (!supabase) throw new Error(ADMIN_SESSION_REQUIRED)

  let accessToken: string
  try {
    const { data, error } = await supabase.auth.getSession()
    accessToken = data.session?.access_token?.trim() ?? ''
    if (error || !accessToken ||
      (data.session?.expires_at != null && data.session.expires_at <= Date.now() / 1000)) {
      throw new Error(ADMIN_SESSION_REQUIRED)
    }
  } catch {
    throw new Error(ADMIN_SESSION_REQUIRED)
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${accessToken}`,
  }
  const anon = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim()
  if (anon) headers.apikey = anon

  // Phase 1 only: old functions require this header. It never substitutes for
  // the session above. Disable the flag after all three new guards are live.
  if (import.meta.env.VITE_F08_LEGACY_ADMIN_COMPAT === 'true') {
    const legacySecret = import.meta.env.VITE_ADMIN_REASSIGN_SECRET?.trim()
    if (!legacySecret) throw new Error('Legacy rollout configuration is missing.')
    headers['x-admin-reassign-secret'] = legacySecret
  }
  return headers
}
