/**
 * Google sign-in so the account picker shows the OAuth client name / ulohome.io
 * instead of *.supabase.co.
 *
 * Production uses a same-origin redirect to /auth/callback.
 * Localhost cannot rely on Google Cloud redirect URIs (Vite hops ports, and
 * Console changes often never match). Local sign-in opens a popup that returns
 * through the already-registered https://www.ulohome.io/auth/callback, which
 * posts the id_token back to the dev tab.
 */

export const GOOGLE_OAUTH_NONCE_KEY = 'ulo.googleOAuthNonce'
export const GOOGLE_OAUTH_CSRF_KEY = 'ulo.googleOAuthCsrf'
export const GOOGLE_OAUTH_RESULT_TYPE = 'ulo.googleOAuthResult'
export const PRODUCTION_GOOGLE_AUTH_CALLBACK = 'https://www.ulohome.io/auth/callback'

export const GOOGLE_OAUTH_BRIDGE_ORIGINS = [
  'https://www.ulohome.io',
  'https://ulohome.io',
  'https://app.ulohome.io',
] as const

export function googleOAuthClientId(): string {
  return (import.meta.env.VITE_GOOGLE_OAUTH_CLIENT_ID as string | undefined)?.trim() ?? ''
}

export function buildGoogleIdTokenAuthUrl(params: {
  clientId: string
  redirectUri: string
  nonce?: string
  state?: string
}): string {
  const query = new URLSearchParams({
    client_id: params.clientId,
    redirect_uri: params.redirectUri,
    response_type: 'id_token',
    response_mode: 'fragment',
    scope: 'openid email profile',
    prompt: 'select_account',
  })
  if (params.nonce) query.set('nonce', params.nonce)
  if (params.state) query.set('state', params.state)
  return `https://accounts.google.com/o/oauth2/v2/auth?${query.toString()}`
}

export function isLocalGoogleHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase()
  return host === 'localhost' || host === '127.0.0.1' || host === '::1'
}

function isPrivateLanHostname(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '')
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) return true
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(host)) return true
  const m = /^172\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(host)
  if (!m) return false
  const second = Number(m[1])
  return second >= 16 && second <= 31
}

export function isAllowedLocalReturnOrigin(origin: string): boolean {
  try {
    const url = new URL(origin)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
    return isLocalGoogleHost(url.hostname) || isPrivateLanHostname(url.hostname)
  } catch {
    return false
  }
}

export function shouldUseBrandedGoogleIdToken(origin: string): boolean {
  return !isAllowedLocalReturnOrigin(origin)
}

/** Google Cloud redirect URI required for supabase.auth.signInWithOAuth. */
export function supabaseGoogleOAuthCallbackUri(
  supabaseUrl: string = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? '',
): string {
  const base = supabaseUrl.trim().replace(/\/$/, '')
  if (!base) return ''
  return `${base}/auth/v1/callback`
}

export function googleAuthCallbackUri(origin: string = window.location.origin): string {
  return `${origin.replace(/\/$/, '')}/auth/callback`
}

/** Original nonce for Supabase; GSI puts the SHA-256 of this value in the ID token. */
export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function storeGoogleOAuthNonce(nonce: string): void {
  try {
    window.sessionStorage.setItem(GOOGLE_OAUTH_NONCE_KEY, nonce)
  } catch {
    /* ignore */
  }
}

/** Redirect URI sent to Google. Local always uses production so Console localhost URIs are not required. */
export function googleSignInRedirectUri(origin: string = window.location.origin): string {
  try {
    const url = new URL(origin.includes('://') ? origin : `http://${origin}`)
    if (isLocalGoogleHost(url.hostname) || isPrivateLanHostname(url.hostname)) {
      return PRODUCTION_GOOGLE_AUTH_CALLBACK
    }
  } catch {
    /* use origin below */
  }
  return googleAuthCallbackUri(origin)
}

export function buildGoogleOAuthState(csrf: string, returnOrigin: string): string {
  return `${csrf}.${btoa(returnOrigin)}`
}

export function googleOAuthStateCsrf(state: string | null | undefined): string | null {
  if (!state) return null
  const dot = state.indexOf('.')
  if (dot <= 0) return null
  return state.slice(0, dot)
}

export function decodeGoogleOAuthReturnOrigin(state: string | null | undefined): string | null {
  if (!state) return null
  const dot = state.indexOf('.')
  if (dot <= 0) return null
  try {
    const origin = atob(state.slice(dot + 1))
    return isAllowedLocalReturnOrigin(origin) ? origin : null
  } catch {
    return null
  }
}

type GoogleGsiNotification = {
  isNotDisplayed: () => boolean
  isSkippedMoment: () => boolean
  isDismissedMoment?: () => boolean
}

type GoogleGsiId = {
  initialize: (config: {
    client_id: string
    nonce?: string
    callback: (response: { credential?: string }) => void
    auto_select?: boolean
    cancel_on_tap_outside?: boolean
    use_fedcm_for_prompt?: boolean
  }) => void
  prompt: (momentListener?: (notification: GoogleGsiNotification) => void) => void
}

declare global {
  interface Window {
    google?: { accounts?: { id?: GoogleGsiId } }
  }
}

function loadGoogleGsiClient(): Promise<GoogleGsiId> {
  const existing = window.google?.accounts?.id
  if (existing) return Promise.resolve(existing)
  return new Promise((resolve, reject) => {
    const src = 'https://accounts.google.com/gsi/client'
    const onReady = () => {
      const client = window.google?.accounts?.id
      if (client) resolve(client)
      else reject(new Error('Google sign-in did not load.'))
    }
    const found = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`)
    if (found) {
      found.addEventListener('load', onReady, { once: true })
      found.addEventListener('error', () => reject(new Error('Could not load Google sign-in.')), {
        once: true,
      })
      return
    }
    const script = document.createElement('script')
    script.src = src
    script.async = true
    script.onload = onReady
    script.onerror = () => reject(new Error('Could not load Google sign-in.'))
    document.head.appendChild(script)
  })
}

/** Same-page Google Identity Services. Needs this origin in Authorized JavaScript origins. */
export async function requestGoogleIdTokenViaGsi(): Promise<string> {
  const clientId = googleOAuthClientId()
  if (!clientId || typeof window === 'undefined') {
    throw new Error('gsi_unavailable')
  }
  const nonce = crypto.randomUUID()
  storeGoogleOAuthNonce(nonce)
  const hashedNonce = await sha256Hex(nonce)
  const gsi = await loadGoogleGsiClient()
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (fn: () => void) => {
      if (settled) return
      settled = true
      fn()
    }
    gsi.initialize({
      client_id: clientId,
      nonce: hashedNonce,
      auto_select: false,
      cancel_on_tap_outside: true,
      use_fedcm_for_prompt: true,
      callback: (response) => {
        const token = response.credential?.trim()
        if (token) finish(() => resolve(token))
        else finish(() => reject(new Error('Google sign-in did not finish.')))
      },
    })
    gsi.prompt((notification) => {
      if (notification.isNotDisplayed() || notification.isSkippedMoment()) {
        finish(() => reject(new Error('gsi_unavailable')))
      }
    })
  })
}

export function storeGoogleOAuthState(returnOrigin: string): string {
  const csrf = crypto.randomUUID()
  window.sessionStorage.setItem(GOOGLE_OAUTH_CSRF_KEY, csrf)
  return buildGoogleOAuthState(csrf, returnOrigin)
}

export type GoogleIdTokenSignInStart =
  | { mode: 'popup'; popup: Window }
  | { mode: 'redirect' }
  | false

export function beginGoogleIdTokenSignIn(): GoogleIdTokenSignInStart {
  const clientId = googleOAuthClientId()
  if (!clientId || typeof window === 'undefined') return false
  const origin = window.location.origin
  const usePopup = isAllowedLocalReturnOrigin(origin)
  const nonce = crypto.randomUUID()
  storeGoogleOAuthNonce(nonce)
  const url = buildGoogleIdTokenAuthUrl({
    clientId,
    redirectUri: googleSignInRedirectUri(origin),
    nonce,
    state: usePopup ? storeGoogleOAuthState(origin) : undefined,
  })
  if (usePopup) {
    const popup = window.open(url, 'uloGoogleSignIn', 'width=500,height=740,menubar=no,toolbar=no')
    if (!popup) return false
    return { mode: 'popup', popup }
  }
  window.location.assign(url)
  return { mode: 'redirect' }
}

export function readGoogleOAuthStateFromHash(hash: string): string | null {
  const params = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash)
  return params.get('state')?.trim() || null
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

export function isTrustedGoogleBridgeOrigin(origin: string): boolean {
  return (GOOGLE_OAUTH_BRIDGE_ORIGINS as readonly string[]).includes(origin)
}

export type GoogleOAuthBridgePayload = {
  type: typeof GOOGLE_OAUTH_RESULT_TYPE
  idToken: string | null
  error: string | null
  state: string | null
}

export function handoffGoogleOAuthHashToOpener(
  opener: Window | null,
  hash: string,
): boolean {
  if (!opener || opener.closed) return false
  const error = readGoogleOAuthErrorFromHash(hash)
  const idToken = readGoogleIdTokenFromHash(hash)
  if (!error && !idToken) return false
  const state = readGoogleOAuthStateFromHash(hash)
  const returnOrigin = decodeGoogleOAuthReturnOrigin(state)
  if (!returnOrigin) return false
  const payload: GoogleOAuthBridgePayload = {
    type: GOOGLE_OAUTH_RESULT_TYPE,
    idToken,
    error,
    state,
  }
  opener.postMessage(payload, returnOrigin)
  return true
}

export function waitForGoogleOAuthPopupResult(
  popup: Window,
  timeoutMs = 120_000,
): Promise<{ idToken: string | null; error: string | null }> {
  return new Promise((resolve, reject) => {
    const csrf = window.sessionStorage.getItem(GOOGLE_OAUTH_CSRF_KEY)
    const onMessage = (event: MessageEvent) => {
      if (!isTrustedGoogleBridgeOrigin(event.origin)) return
      const data = event.data as GoogleOAuthBridgePayload | null
      if (!data || data.type !== GOOGLE_OAUTH_RESULT_TYPE) return
      if (googleOAuthStateCsrf(data.state) !== csrf) return
      cleanup()
      resolve({ idToken: data.idToken, error: data.error })
    }
    const poll = window.setInterval(() => {
      if (!popup.closed) return
      cleanup()
      reject(new Error('Google sign-in was closed before it finished.'))
    }, 400)
    const timer = window.setTimeout(() => {
      cleanup()
      reject(new Error('Google sign-in timed out. Try again.'))
    }, timeoutMs)
    function cleanup() {
      window.removeEventListener('message', onMessage)
      window.clearInterval(poll)
      window.clearTimeout(timer)
    }
    window.addEventListener('message', onMessage)
  })
}

export function googleIdTokenAuthErrorMessage(error: unknown): string | null {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === 'object' && error && 'message' in error
        ? String((error as { message?: unknown }).message ?? '')
        : typeof error === 'string'
          ? error
          : ''
  if (/unacceptable audience in id_token/i.test(raw)) {
    return 'This Google app is not allowed in Supabase yet. In Authentication → Providers → Google, add the Web client ID from VITE_GOOGLE_OAUTH_CLIENT_ID to Client IDs (comma-separated with the existing ID). Save, then try again.'
  }
  if (/nonce/i.test(raw)) {
    return 'Google sign-in could not be verified. Try again, or use email and a verification code.'
  }
  return null
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
