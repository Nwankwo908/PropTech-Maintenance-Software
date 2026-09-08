import { describe, expect, it } from 'vitest'
import {
  buildGoogleIdTokenAuthUrl,
  googleAuthCallbackUri,
  readGoogleIdTokenFromHash,
  readGoogleOAuthErrorFromHash,
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

  it('uses /auth/callback on the current origin', () => {
    expect(googleAuthCallbackUri('https://www.ulohome.io/')).toBe(
      'https://www.ulohome.io/auth/callback',
    )
  })

  it('reads the id token from the OAuth fragment', () => {
    expect(readGoogleIdTokenFromHash('#id_token=tok.en&authuser=0')).toBe('tok.en')
    expect(readGoogleOAuthErrorFromHash('#error=redirect_uri_mismatch')).toBe(
      'redirect_uri_mismatch',
    )
  })
})
