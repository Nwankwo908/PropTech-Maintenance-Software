import { describe, expect, it } from 'vitest'
import {
  buildGoogleIdTokenAuthUrl,
  buildGoogleOAuthState,
  decodeGoogleOAuthReturnOrigin,
  googleAuthCallbackUri,
  googleOAuthStateCsrf,
  googleSignInRedirectUri,
  handoffGoogleOAuthHashToOpener,
  isAllowedLocalReturnOrigin,
  isTrustedGoogleBridgeOrigin,
  PRODUCTION_GOOGLE_AUTH_CALLBACK,
  readGoogleIdTokenFromHash,
  readGoogleOAuthErrorFromHash,
  readGoogleOAuthStateFromHash,
  shouldUseBrandedGoogleIdToken,
  supabaseGoogleOAuthCallbackUri,
} from './googleIdentitySignIn'

describe('googleIdentitySignIn', () => {
  it('builds an auth URL that returns to the app origin, not supabase.co', () => {
    const url = buildGoogleIdTokenAuthUrl({
      clientId: 'abc.apps.googleusercontent.com',
      redirectUri: 'https://www.ulohome.io/auth/callback',
      nonce: 'nonce-1',
    })
    const parsed = new URL(url)
    expect(parsed.origin).toBe('https://accounts.google.com')
    expect(parsed.searchParams.get('redirect_uri')).toBe('https://www.ulohome.io/auth/callback')
    expect(parsed.searchParams.get('response_type')).toBe('id_token')
    expect(parsed.searchParams.get('nonce')).toBe('nonce-1')
  })

  it('builds the Supabase-hosted Google callback Google Cloud must allow', () => {
    expect(supabaseGoogleOAuthCallbackUri('https://mzpqwuizhiaczxcnmxbt.supabase.co')).toBe(
      'https://mzpqwuizhiaczxcnmxbt.supabase.co/auth/v1/callback',
    )
  })

  it('keeps branded Google id-token sign-in off localhost', () => {
    expect(shouldUseBrandedGoogleIdToken('http://localhost:5175')).toBe(false)
    expect(shouldUseBrandedGoogleIdToken('https://www.ulohome.io')).toBe(true)
  })

  it('uses /auth/callback on the current origin', () => {
    expect(googleAuthCallbackUri('https://www.ulohome.io/')).toBe(
      'https://www.ulohome.io/auth/callback',
    )
  })

  it('sends local Google redirects through production so Console localhost URIs are not required', () => {
    expect(googleSignInRedirectUri('http://localhost:5175')).toBe(PRODUCTION_GOOGLE_AUTH_CALLBACK)
    expect(googleSignInRedirectUri('http://127.0.0.1:5174/')).toBe(PRODUCTION_GOOGLE_AUTH_CALLBACK)
    expect(googleSignInRedirectUri('http://192.168.1.247:5175')).toBe(
      PRODUCTION_GOOGLE_AUTH_CALLBACK,
    )
    expect(googleSignInRedirectUri('https://www.ulohome.io')).toBe(
      'https://www.ulohome.io/auth/callback',
    )
  })

  it('encodes a local return origin in OAuth state', () => {
    const state = buildGoogleOAuthState('csrf-1', 'http://localhost:5175')
    expect(googleOAuthStateCsrf(state)).toBe('csrf-1')
    expect(decodeGoogleOAuthReturnOrigin(state)).toBe('http://localhost:5175')
    expect(decodeGoogleOAuthReturnOrigin(buildGoogleOAuthState('x', 'https://evil.example'))).toBe(
      null,
    )
  })

  it('allows only local return origins', () => {
    expect(isAllowedLocalReturnOrigin('http://localhost:5173')).toBe(true)
    expect(isAllowedLocalReturnOrigin('https://www.ulohome.io')).toBe(false)
  })

  it('trusts only Ulo production origins as the popup bridge', () => {
    expect(isTrustedGoogleBridgeOrigin('https://www.ulohome.io')).toBe(true)
    expect(isTrustedGoogleBridgeOrigin('http://localhost:5173')).toBe(false)
  })

  it('posts the Google hash back to a local opener', () => {
    const posted: { payload: unknown; origin: string }[] = []
    const opener = {
      closed: false,
      postMessage(payload: unknown, origin: string) {
        posted.push({ payload, origin })
      },
    }
    const state = buildGoogleOAuthState('csrf', 'http://localhost:5175')
    const ok = handoffGoogleOAuthHashToOpener(
      opener as unknown as Window,
      `#id_token=abc.def&state=${encodeURIComponent(state)}`,
    )
    expect(ok).toBe(true)
    expect(posted[0]?.origin).toBe('http://localhost:5175')
  })

  it('explains an audience mismatch from Supabase Auth', async () => {
    const { googleIdTokenAuthErrorMessage } = await import('./googleIdentitySignIn')
    expect(
      googleIdTokenAuthErrorMessage(
        new Error(
          'Unacceptable audience in id_token: [477116324616-552ki8k92qc275efv5sjjhqlkc1o1l83.apps.googleusercontent.com]',
        ),
      ),
    ).toMatch(/Client IDs/)
  })

  it('reads the id token and state from the OAuth fragment', () => {
    expect(readGoogleIdTokenFromHash('#id_token=tok.en&authuser=0')).toBe('tok.en')
    expect(readGoogleOAuthErrorFromHash('#error=redirect_uri_mismatch')).toBe(
      'redirect_uri_mismatch',
    )
    expect(readGoogleOAuthStateFromHash('#id_token=t&state=abc.def')).toBe('abc.def')
  })
})
