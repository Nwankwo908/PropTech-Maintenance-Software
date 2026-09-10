/**
 * Google sign-in so the account picker shows the OAuth client name / ulohome.io
 * instead of *.supabase.co.
 *
 * Production Google sign-in uses Supabase authorization-code OAuth (not
 * implicit id_token / GSI). Chrome otherwise posts grant_type=id_token and
 * gets 400 ("Google sign-in did not finish.").
 * Localhost still opens a popup that returns through www /auth/callback.
 */

export const GOOGLE_OAUTH_NONCE_KEY = 'ulo.googleOAuthNonce'
export const GOOGLE_OAUTH_CSRF_KEY = 'ulo.googleOAuthCsrf'
export const GOOGLE_OAUTH_RESULT_TYPE = 'ulo.googleOAuthResult'
export const ADMIN_GOOGLE_OAUTH_KEY = 'ulo.adminGoogleOAuth'
export const GOOGLE_SIGN_IN_POPUP_NAME = 'uloGoogleSignIn'
export const PRODUCTION_GOOGLE_AUTH_CALLBACK = 'https://www.ulohome.io/auth/callback'

const ULO_PRODUCTION_HOSTS = new Set(['ulohome.io', 'www.ulohome.io', 'app.ulohome.io'])

export const GOOGLE_OAUTH_BRIDGE_ORIGINS = [
  'https://www.ulohome.io',
  'https://ulohome.io',
  'https://app.ulohome.io',
] as const

export function googleOAuthClientId(): string {
  return (import.meta.env.VITE_GOOGLE_OAUTH_CLIENT_ID as string | undefined)?.trim() ?? ''
}

export function markAdminGoogleOAuthIntent(): void {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.setItem(ADMIN_GOOGLE_OAUTH_KEY, '1')
  } catch {
    /* ignore */
  }
}

export function hasAdminGoogleOAuthIntent(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.sessionStorage.getItem(ADMIN_GOOGLE_OAUTH_KEY) === '1'
  } catch {
    return false
  }
}

export function consumeAdminGoogleOAuthIntent(): boolean {
  const pending = hasAdminGoogleOAuthIntent()
  if (!pending) return false
  try {
    window.sessionStorage.removeItem(ADMIN_GOOGLE_OAUTH_KEY)
  } catch {
    /* ignore */
  }
  return true
}

/** True when Google/Supabase returned an auth code or id_token on this URL. */
export function isOAuthReturnUrl(search: string, hash: string): boolean {
  const returned = readGoogleOAuthReturnParams(search, hash)
  return Boolean(returned.code || returned.idToken)
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
  try {
    const host = window.location.hostname.replace(/^\[|\]$/g, '')
    const domain = ULO_PRODUCTION_HOSTS.has(host) ? '; Domain=.ulohome.io' : ''
    document.cookie = `${GOOGLE_OAUTH_NONCE_KEY}=${encodeURIComponent(nonce)}; Max-Age=600; Path=/${domain}; Secure; SameSite=Lax`
  } catch {
    /* ignore */
  }
}

function readGoogleOAuthNonceCookie(): string | null {
  if (typeof document === 'undefined') return null
  const parts = document.cookie.split(';')
  const prefix = `${GOOGLE_OAUTH_NONCE_KEY}=`
  for (const part of parts) {
    const trimmed = part.trim()
    if (!trimmed.startsWith(prefix)) continue
    try {
      return decodeURIComponent(trimmed.slice(prefix.length)).trim() || null
    } catch {
      return null
    }
  }
  return null
}

function clearGoogleOAuthNonceCookie(): void {
  try {
    document.cookie = `${GOOGLE_OAUTH_NONCE_KEY}=; Max-Age=0; Path=/`
    document.cookie = `${GOOGLE_OAUTH_NONCE_KEY}=; Max-Age=0; Path=/; Domain=.ulohome.io`
  } catch {
    /* ignore */
  }
}

/** Redirect URI sent to Google. Production always uses www so Console + Chrome agree. */
export function googleSignInRedirectUri(origin: string = window.location.origin): string {
  try {
    const url = new URL(origin.includes('://') ? origin : `http://${origin}`)
    if (isLocalGoogleHost(url.hostname) || isPrivateLanHostname(url.hostname)) {
      return PRODUCTION_GOOGLE_AUTH_CALLBACK
    }
    if (ULO_PRODUCTION_HOSTS.has(url.hostname)) {
      return PRODUCTION_GOOGLE_AUTH_CALLBACK
    }
  } catch {
    /* use origin below */
  }
  return googleAuthCallbackUri(origin)
}

type GoogleOAuthStatePayload = {
  o?: string
  n?: string
}

function parseGoogleOAuthStatePayload(
  state: string | null | undefined,
): { csrf: string; o?: string; n?: string } | null {
  if (!state) return null
  const dot = state.indexOf('.')
  if (dot <= 0) return null
  const csrf = state.slice(0, dot)
  const raw = state.slice(dot + 1)
  try {
    const parsed = JSON.parse(atob(raw)) as GoogleOAuthStatePayload
    if (parsed && typeof parsed === 'object') {
      return {
        csrf,
        o: typeof parsed.o === 'string' ? parsed.o : undefined,
        n: typeof parsed.n === 'string' ? parsed.n : undefined,
      }
    }
  } catch {
    try {
      return { csrf, o: atob(raw) }
    } catch {
      return { csrf }
    }
  }
  return { csrf }
}

export function buildGoogleOAuthState(
  csrf: string,
  returnOrigin?: string | null,
  nonce?: string,
): string {
  const payload: GoogleOAuthStatePayload = {}
  if (returnOrigin) payload.o = returnOrigin
  if (nonce) payload.n = nonce
  return `${csrf}.${btoa(JSON.stringify(payload))}`
}

export function googleOAuthStateCsrf(state: string | null | undefined): string | null {
  return parseGoogleOAuthStatePayload(state)?.csrf ?? null
}

export function decodeGoogleOAuthReturnOrigin(state: string | null | undefined): string | null {
  const origin = parseGoogleOAuthStatePayload(state)?.o
  return origin && isAllowedLocalReturnOrigin(origin) ? origin : null
}

export function decodeGoogleOAuthNonce(state: string | null | undefined): string | null {
  const nonce = parseGoogleOAuthStatePayload(state)?.n?.trim()
  return nonce || null
}

/**
 * GSI One Tap / FedCM is unreliable on phones and consumes the tap gesture,
 * so a later redirect is blocked. Redirect in the same click instead.
 */
export function shouldUseImmediateGoogleRedirect(
  userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : '',
  maxTouchPoints = typeof navigator !== 'undefined' ? navigator.maxTouchPoints : 0,
  coarsePointer =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(pointer: coarse)').matches,
): boolean {
  if (/iPhone|iPad|iPod|Android|Mobile|webOS|Silk/i.test(userAgent)) return true
  if (maxTouchPoints > 1 && /Mac/i.test(userAgent)) return true
  return Boolean(coarsePointer)
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

export function storeGoogleOAuthState(returnOrigin: string | undefined, nonce: string): string {
  const csrf = crypto.randomUUID()
  window.sessionStorage.setItem(GOOGLE_OAUTH_CSRF_KEY, csrf)
  return buildGoogleOAuthState(csrf, returnOrigin, nonce)
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
    state: storeGoogleOAuthState(usePopup ? origin : undefined, nonce),
  })
  if (usePopup) {
    const popup = window.open(
      url,
      GOOGLE_SIGN_IN_POPUP_NAME,
      'width=500,height=740,menubar=no,toolbar=no',
    )
    if (!popup) return false
    return { mode: 'popup', popup }
  }
  window.location.assign(url)
  return { mode: 'redirect' }
}

function paramsFromSearchAndHash(search: string, hash: string): URLSearchParams {
  const merged = new URLSearchParams(
    search.startsWith('?') ? search.slice(1) : search,
  )
  const hashParams = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash)
  for (const [key, value] of hashParams.entries()) {
    merged.set(key, value)
  }
  return merged
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

/** iOS sometimes returns Google's fragment params on the query string instead. */
export function readGoogleOAuthReturnParams(
  search: string,
  hash: string,
): { idToken: string | null; error: string | null; state: string | null; code: string | null } {
  const params = paramsFromSearchAndHash(search, hash)
  return {
    idToken: params.get('id_token')?.trim() || null,
    error: params.get('error')?.trim() || null,
    state: params.get('state')?.trim() || null,
    code: params.get('code')?.trim() || null,
  }
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

export function googleOAuthPayloadFromHash(hash: string): GoogleOAuthBridgePayload | null {
  const error = readGoogleOAuthErrorFromHash(hash)
  const idToken = readGoogleIdTokenFromHash(hash)
  if (!error && !idToken) return null
  return {
    type: GOOGLE_OAUTH_RESULT_TYPE,
    idToken,
    error,
    state: readGoogleOAuthStateFromHash(hash),
  }
}

/** When Chrome severs window.opener, bounce the Google hash to the local tab. */
export function redirectGoogleOAuthHashToLocalReturn(
  hash: string,
  currentOrigin: string,
): string | null {
  const payload = googleOAuthPayloadFromHash(hash)
  if (!payload) return null
  const returnOrigin = decodeGoogleOAuthReturnOrigin(payload.state)
  if (!returnOrigin || returnOrigin === currentOrigin) return null
  const fragment = hash.startsWith('#') ? hash : `#${hash}`
  return `${returnOrigin}/auth/callback${fragment}`
}

export function publishGoogleOAuthBridgePayload(payload: GoogleOAuthBridgePayload): void {
  try {
    const channel = new BroadcastChannel(GOOGLE_OAUTH_RESULT_TYPE)
    channel.postMessage(payload)
    channel.close()
  } catch {
    /* ignore */
  }
}

function isAcceptedGoogleOAuthBridgeMessage(eventOrigin: string, listenerOrigin: string): boolean {
  return isTrustedGoogleBridgeOrigin(eventOrigin) || eventOrigin === listenerOrigin
}

function isGoogleOAuthBridgePayload(
  data: unknown,
  csrf: string | null,
): data is GoogleOAuthBridgePayload {
  if (!data || typeof data !== 'object') return false
  const payload = data as GoogleOAuthBridgePayload
  if (payload.type !== GOOGLE_OAUTH_RESULT_TYPE) return false
  return googleOAuthStateCsrf(payload.state) === csrf
}

export function handoffGoogleOAuthHashToOpener(
  opener: Window | null,
  hash: string,
): boolean {
  const payload = googleOAuthPayloadFromHash(hash)
  if (!payload) return false
  const returnOrigin = decodeGoogleOAuthReturnOrigin(payload.state)
  if (!returnOrigin) return false
  if (opener && !opener.closed) {
    opener.postMessage(payload, returnOrigin)
    return true
  }
  return false
}

export function waitForGoogleOAuthPopupResult(
  popup: Window,
  timeoutMs = 120_000,
): Promise<{ idToken: string | null; error: string | null; nonce: string | null }> {
  return new Promise((resolve, reject) => {
    let settled = false
    const csrf = window.sessionStorage.getItem(GOOGLE_OAUTH_CSRF_KEY)
    const listenerOrigin = window.location.origin
    const accept = (data: unknown) => {
      if (settled || !isGoogleOAuthBridgePayload(data, csrf)) return
      cleanup()
      resolve({
        idToken: data.idToken,
        error: data.error,
        nonce: decodeGoogleOAuthNonce(data.state),
      })
    }
    const onMessage = (event: MessageEvent) => {
      if (!isAcceptedGoogleOAuthBridgeMessage(event.origin, listenerOrigin)) return
      accept(event.data)
    }
    let channel: BroadcastChannel | null = null
    try {
      channel = new BroadcastChannel(GOOGLE_OAUTH_RESULT_TYPE)
      channel.onmessage = (event) => accept(event.data)
    } catch {
      channel = null
    }
    const poll = window.setInterval(() => {
      if (!popup.closed || settled) return
      window.clearInterval(poll)
      window.setTimeout(() => {
        if (settled) return
        cleanup()
        reject(new Error('Google sign-in was closed before it finished.'))
      }, 500)
    }, 400)
    const timer = window.setTimeout(() => {
      if (settled) return
      cleanup()
      reject(new Error('Google sign-in timed out. Try again.'))
    }, timeoutMs)
    function cleanup() {
      settled = true
      window.removeEventListener('message', onMessage)
      window.clearInterval(poll)
      window.clearTimeout(timer)
      try {
        channel?.close()
      } catch {
        /* ignore */
      }
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
  let fromSession: string | null = null
  try {
    fromSession = window.sessionStorage.getItem(GOOGLE_OAUTH_NONCE_KEY)
    window.sessionStorage.removeItem(GOOGLE_OAUTH_NONCE_KEY)
  } catch {
    fromSession = null
  }
  const fromCookie = readGoogleOAuthNonceCookie()
  clearGoogleOAuthNonceCookie()
  return fromSession?.trim() || fromCookie?.trim() || null
}
