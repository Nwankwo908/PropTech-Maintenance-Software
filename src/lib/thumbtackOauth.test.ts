import { describe, expect, it } from 'vitest'
import {
  buildThumbtackAuthorizeUrl,
  DEFAULT_THUMBTACK_AUTH_URL,
  THUMBTACK_AUTH_CODE_SCOPES,
  thumbtackAuthCodeScope,
  thumbtackAuthorizationCodeClient,
  thumbtackOauthLogSafe,
  parseThumbtackAuthorizeRedirect,
  pickThumbtackOAuthTokens,
  normalizeThumbtackRedirectUri,
  THUMBTACK_REGISTERED_REDIRECT_URI,
} from '@shared/externalVendor/thumbtackOauth'
import { completeThumbtackOauthFromSearch, thumbtackJustConnected } from '@/lib/completeThumbtackOauth'
import { thumbtackOauthParamsFromSearch, uloAppUrl } from '@/lib/uloAppUrl'

describe('Thumbtack authorization_code helpers', () => {
  it('includes negotiation and message scopes plus offline_access', () => {
    const scope = thumbtackAuthCodeScope()
    for (const token of THUMBTACK_AUTH_CODE_SCOPES) {
      expect(scope).toContain(token)
    }
  })

  it('builds the partner authorize URL', () => {
    const url = new URL(
      buildThumbtackAuthorizeUrl({
        clientId: 'client-1',
        redirectUri: THUMBTACK_REGISTERED_REDIRECT_URI,
        state: 'state-token-abc',
      }),
    )
    expect(`${url.origin}${url.pathname}`).toBe(DEFAULT_THUMBTACK_AUTH_URL)
    expect(url.searchParams.get('client_id')).toBe('client-1')
    expect(url.searchParams.get('redirect_uri')).toBe(THUMBTACK_REGISTERED_REDIRECT_URI)
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('state')).toBe('state-token-abc')
    expect(url.searchParams.get('audience')).toBe('urn:partner-api')
    expect(url.searchParams.get('scope') ?? '').toContain('demand::negotiations.read')
    expect(url.searchParams.get('scope') ?? '').toContain('demand::messages.write')
    expect(url.searchParams.get('scope') ?? '').toContain('demand::messages.read')
    expect(url.searchParams.get('scope') ?? '').toContain('offline_access')
    expect(url.searchParams.get('scope') ?? '').not.toContain('demand::requests.write')
    expect(url.searchParams.get('scope') ?? '').not.toContain('demand::businesses/search.read')
    expect(url.searchParams.get('scope') ?? '').not.toContain('negotiations/messages.write')
  })

  it('drops the ungranted nested messages.write scope even if env extra still lists it', () => {
    const scope = thumbtackAuthCodeScope(
      'demand::requests.write demand::negotiations/messages.write demand::messages.write',
    )
    expect(scope).toContain('demand::messages.write')
    expect(scope).not.toContain('negotiations/messages.write')
    expect(scope).not.toContain('demand::requests.write')
  })

  it('reads code and state from /admin search', () => {
    expect(thumbtackOauthParamsFromSearch('?code=abc&state=12345678')).toEqual({
      code: 'abc',
      state: '12345678',
      error: null,
    })
    expect(thumbtackOauthParamsFromSearch('?error=access_denied&state=12345678')).toEqual({
      code: '',
      state: '12345678',
      error: 'access_denied',
    })
    expect(thumbtackOauthParamsFromSearch('?ticket=1')).toBeNull()
  })

  it('uses the registered Thumbtack redirect URI', () => {
    expect(uloAppUrl.thumbtackOauthCallback(false)).toBe(THUMBTACK_REGISTERED_REDIRECT_URI)
    expect(normalizeThumbtackRedirectUri('https://www.ulohome.io')).toBe(
      THUMBTACK_REGISTERED_REDIRECT_URI,
    )
  })

  it('treats /oauth/connect as a valid authorize redirect', () => {
    const ok = parseThumbtackAuthorizeRedirect('https://www.thumbtack.com/oauth/connect')
    expect(ok.ok).toBe(true)
    expect(ok.error).toBeNull()
    const bad = parseThumbtackAuthorizeRedirect(
      'https://www.thumbtack.com/oauth/error?error=invalid_request&error_description=The%20%27redirect_uri%27%20parameter%20does%20not%20match',
    )
    expect(bad.ok).toBe(false)
    expect(bad.error).toBe('invalid_request')
    expect(bad.errorDescription ?? '').toMatch(/redirect_uri/)
  })

  it('reads nested Thumbtack token payloads', () => {
    const tokens = pickThumbtackOAuthTokens({
      data: {
        access_token: 'access-1',
        refresh_token: 'refresh-1',
        expires_in: 3600,
        scope: 'demand::messages.write',
      },
    })
    expect(tokens.accessToken).toBe('access-1')
    expect(tokens.refreshToken).toBe('refresh-1')
    expect(tokens.expiresIn).toBe(3600)
  })

  it('surfaces thumbtack=error from the OAuth callback', async () => {
    const result = await completeThumbtackOauthFromSearch('?thumbtack=error')
    expect(result.handled).toBe(true)
    expect(result.error).toMatch(/Connect Thumbtack/)
  })

  it('detects a finished Thumbtack connect on the return URL', () => {
    expect(thumbtackJustConnected('?thumbtack=connected')).toBe(true)
    expect(thumbtackJustConnected('?thumbtack=error')).toBe(false)
    expect(thumbtackJustConnected('?ticket=1')).toBe(false)
  })

  it('does not use the search client for authorization_code', () => {
    expect(
      thumbtackAuthorizationCodeClient({
        messagingClientId: '',
        messagingClientSecret: 'secret',
      }),
    ).toBeNull()
    expect(
      thumbtackAuthorizationCodeClient({
        messagingClientId: '800b3ba-a106-4f35-a6d0-bba389abe5c7',
        messagingClientSecret: 'secret',
      }),
    ).toBeNull()
    expect(
      thumbtackAuthorizationCodeClient({
        messagingClientId: '00000000-0000-4000-8000-000000000001',
        messagingClientSecret: 'secret',
      }),
    ).toEqual({
      clientId: '00000000-0000-4000-8000-000000000001',
      clientSecret: 'secret',
    })
  })

  it('redacts secrets from OAuth log payloads', () => {
    const log = thumbtackOauthLogSafe({
      clientId: '00000000-0000-4000-8000-000000000001',
      searchClientId: '11111111-0000-4000-8000-000000000001',
      redirectUri: THUMBTACK_REGISTERED_REDIRECT_URI,
      status: 401,
      body: '{"error":"invalid_client","error_description":"unknown client"}',
      hasRefreshToken: false,
    })
    expect(log.client_id_prefix).toBe('00000000')
    expect(log.distinct_from_search).toBe(true)
    expect(log.error).toBe('invalid_client')
    expect(log.redirect_uri).toBe(THUMBTACK_REGISTERED_REDIRECT_URI)
  })
})
