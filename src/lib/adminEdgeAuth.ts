/**
 * Client-side admin Edge auth — one path for VITE_ADMIN_REASSIGN_SECRET and
 * browser → hosted Supabase invoke headers.
 */

export const ADMIN_EDGE_SECRET_MISMATCH_HINT =
  'Edge ADMIN_REASSIGN_SECRET must match VITE_ADMIN_REASSIGN_SECRET for this project.'

export function getAdminEdgeSecret(): string | undefined {
  return import.meta.env.VITE_ADMIN_REASSIGN_SECRET?.trim() || undefined
}

export function requireAdminEdgeSecret(featureLabel = 'Admin'): string {
  const secret = getAdminEdgeSecret()
  if (!secret) {
    throw new Error(`${featureLabel}: missing VITE_ADMIN_REASSIGN_SECRET configuration`)
  }
  return secret
}

/** Dev-only: warn when an admin Edge URL host differs from VITE_SUPABASE_URL. */
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

/**
 * `fetch` for admin Edge URLs; turns opaque `TypeError: Failed to fetch` into
 * actionable text (CORS preflight, bad host, offline, extensions).
 */
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

/** Headers for admin-only Edge calls from the browser against hosted Supabase. */
export function adminEdgeInvokeHeaders(secret: string): Record<string, string> {
  const s = secret.trim()
  const anon =
    typeof import.meta !== 'undefined' &&
    import.meta.env?.VITE_SUPABASE_ANON_KEY != null
      ? String(import.meta.env.VITE_SUPABASE_ANON_KEY).trim()
      : ''
  const h: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-admin-reassign-secret': s,
  }
  if (anon) {
    h.apikey = anon
    h.Authorization = `Bearer ${anon}`
  } else {
    h.Authorization = `Bearer ${s}`
  }
  return h
}

export function formatAdminEdgeUnauthorizedError(base: string): string {
  return `${base} (401): Edge secret ADMIN_REASSIGN_SECRET must exactly match VITE_ADMIN_REASSIGN_SECRET for this project (trimmed; check Dashboard → Edge Functions → Secrets).`
}
