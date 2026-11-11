/**
 * Browser admin Edge calls send the signed-in user access token.
 * The anon key is only the Supabase apikey. It is not the caller's identity.
 * Do not read an admin secret from the Vite env here. That value would be shipped in the JS bundle.
 */

import { supabase } from '@/lib/supabase'

export const ADMIN_EDGE_SIGN_IN_HINT = 'Sign in required for this admin action.'

/** @deprecated The browser no longer holds an admin secret. Kept so older call sites still compile. */
export function getAdminEdgeSecret(): string | undefined {
  return 'session'
}

/** @deprecated Use the signed-in session. Throws only when this helper is called without a label path that already checked the session. */
export function requireAdminEdgeSecret(featureLabel = 'Admin'): string {
  void featureLabel
  return 'session'
}

function warnIfAdminEdgeHostMismatch(url: string): void {
  if (!import.meta.env.DEV) return
  const base = import.meta.env.VITE_SUPABASE_URL?.trim()
  if (!base) return
  try {
    const u = new URL(url)
    const b = new URL(base.replace(/\/$/, ''))
    if (u.hostname !== b.hostname) {
      console.warn(
        '[admin edge] function URL host differs from VITE_SUPABASE_URL — wrong project ref often causes Failed to fetch.',
        { edgeHost: u.hostname, supabaseHost: b.hostname },
      )
    }
  } catch {
    console.warn('[admin edge] function URL is not valid:', url)
  }
}

export async function fetchAdminEdgeFunction(
  url: string,
  init: RequestInit,
): Promise<Response> {
  warnIfAdminEdgeHostMismatch(url)
  try {
    return await fetch(url, init)
  } catch (e) {
    if (e instanceof TypeError) {
      const u = url.trim()
      throw new TypeError(
        `Failed to reach ${u}: ${e.message}. Check DevTools → Network for a failed OPTIONS (CORS) or DNS error; copy the function URL from Supabase Dashboard (same project as VITE_SUPABASE_URL); redeploy admin Edge functions after CORS changes.`,
      )
    }
    throw e
  }
}

/**
 * Headers for an admin Edge call. `legacySecret` is ignored so a leftover
 * argument cannot be attached to the request.
 */
export async function adminEdgeInvokeHeaders(
  _legacySecret?: string,
): Promise<Record<string, string>> {
  const anon =
    typeof import.meta !== 'undefined' &&
    import.meta.env?.VITE_SUPABASE_ANON_KEY != null
      ? String(import.meta.env.VITE_SUPABASE_ANON_KEY).trim()
      : ''
  if (!supabase) {
    throw new Error(ADMIN_EDGE_SIGN_IN_HINT)
  }
  const { data } = await supabase.auth.getSession()
  const accessToken = data.session?.access_token?.trim() || ''
  if (!accessToken) {
    throw new Error(ADMIN_EDGE_SIGN_IN_HINT)
  }
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-ulo-access-token': accessToken,
  }
  if (anon) {
    headers.apikey = anon
    headers.Authorization = `Bearer ${anon}`
  }
  return headers
}

export function formatAdminEdgeUnauthorizedError(base: string): string {
  return `${base} (401): Sign in again. This action uses your account, not a shared admin secret.`
}
