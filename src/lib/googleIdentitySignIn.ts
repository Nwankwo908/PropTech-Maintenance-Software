/**
 * Google sign-in on the current app origin so the account picker shows
 * www.ulohome.io (or localhost) instead of *.supabase.co.
 *
 * Requires the same Google OAuth Web client as Auth → Providers → Google,
 * with Authorized redirect URIs for each app origin (see .env.example).
 */

export const GOOGLE_OAUTH_NONCE_KEY = 'ulo.googleOAuthNonce'

export function googleOAuthClientId(): string {
  return (import.meta.env.VITE_GOOGLE_OAUTH_CLIENT_ID as string | undefined)?.trim() ?? ''
}

export function buildGoogleIdTokenAuthUrl(params: {
  clientId: string
  redirectUri: string
  nonce: string
}): string {
  const query = new URLSearchParams({
    client_id: params.clientId,
    redirect_uri: params.redirectUri,
    response_type: 'id_token',
    response_mode: 'fragment',
    scope: 'openid email profile',
    nonce: params.nonce,
    prompt: 'select_account',
  })
  return `https://accounts.google.com/o/oauth2/v2/auth?${query.toString()}`
}

export function googleAuthCallbackUri(origin: string = window.location.origin): string {
  return `${origin.replace(/\/$/, '')}/auth/callback`
}

export function beginGoogleIdTokenSignIn(): boolean {
  const clientId = googleOAuthClientId()
  if (!clientId || typeof window === 'undefined') return false
  const nonce = crypto.randomUUID()
  try {
    window.sessionStorage.setItem(GOOGLE_OAUTH_NONCE_KEY, nonce)
  } catch {
    return false
  }
  window.location.assign(
    buildGoogleIdTokenAuthUrl({
      clientId,
      redirectUri: googleAuthCallbackUri(),
      nonce,
    }),
  )
  return true
}

export function readGoogleIdTokenFromHash(hash: string): string | null {
  const params = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash)
  const token = params.get('id_token')?.trim()
  return token || null
}

export function readGoogleOAuthErrorFromHash(hash: string): string | null {
  const params = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash)
  const error = params.get('error')?.trim()
  return error || null
}

export function takeStoredGoogleOAuthNonce(): string | null {
  if (typeof window === 'undefined') return null
  try {
    const nonce = window.sessionStorage.getItem(GOOGLE_OAUTH_NONCE_KEY)
    window.sessionStorage.removeItem(GOOGLE_OAUTH_NONCE_KEY)
    return nonce?.trim() || null
  } catch {
    return null
  }
}
