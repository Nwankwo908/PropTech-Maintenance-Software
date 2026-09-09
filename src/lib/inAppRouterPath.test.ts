import { describe, expect, it } from 'vitest'
import {
  historyUrlOnLoopback,
  inAppRouterPath,
  localhostInAppClickPath,
  rewriteProductionUloHrefToPath,
  sameOriginHref,
} from './inAppRouterPath'

describe('inAppRouterPath', () => {
  it('keeps in-app admin paths', () => {
    expect(inAppRouterPath('/admin/properties/abc')).toBe('/admin/properties/abc')
    expect(
      inAppRouterPath('/admin/properties/abc?tab=details'),
    ).toBe('/admin/properties/abc?tab=details')
  })

  it('strips production origins so Router stays on the current host', () => {
    expect(inAppRouterPath('https://app.ulohome.io/admin/properties/abc')).toBe(
      '/admin/properties/abc',
    )
    expect(inAppRouterPath('https://www.ulohome.io/admin/properties/abc?tab=units')).toBe(
      '/admin/properties/abc?tab=units',
    )
    expect(inAppRouterPath('//app.ulohome.io/admin')).toBe('/admin')
  })

  it('does not treat a leading-slash path as protocol-relative', () => {
    expect(inAppRouterPath('/admin/properties//www.ulohome.io')).toBe(
      '/admin/properties//www.ulohome.io',
    )
  })

  it('builds hrefs on the current origin', () => {
    expect(sameOriginHref('/admin/properties/abc', 'http://localhost:5175')).toBe(
      'http://localhost:5175/admin/properties/abc',
    )
  })

  it('keeps www.ulohome.io property URLs on localhost', () => {
    expect(
      rewriteProductionUloHrefToPath(
        'https://www.ulohome.io/admin/properties/d38a52c1-3666-539f-83f8-aa7ef6c7c85b',
        'http://localhost:5175',
      ),
    ).toBe('/admin/properties/d38a52c1-3666-539f-83f8-aa7ef6c7c85b')
    expect(
      rewriteProductionUloHrefToPath('/admin/properties/abc', 'http://localhost:5175'),
    ).toBeNull()
    expect(
      rewriteProductionUloHrefToPath(
        'https://www.ulohome.io/admin/properties/abc',
        'http://192.168.1.247:5176',
      ),
    ).toBe('/admin/properties/abc')
    expect(
      rewriteProductionUloHrefToPath(
        'https://www.ulohome.io/admin/properties/abc',
        'https://www.ulohome.io',
      ),
    ).toBeNull()
  })

  it('intercepts relative admin hrefs on localhost', () => {
    expect(
      localhostInAppClickPath(
        '/admin/properties/d38a52c1-3666-539f-83f8-aa7ef6c7c85b',
        'http://localhost:5175',
      ),
    ).toBe('/admin/properties/d38a52c1-3666-539f-83f8-aa7ef6c7c85b')
  })

  it('rewrites production history URLs on localhost', () => {
    expect(
      historyUrlOnLoopback(
        'https://www.ulohome.io/admin/properties/d38a52c1-3666-539f-83f8-aa7ef6c7c85b',
        'http://localhost:5176',
      ),
    ).toBe('/admin/properties/d38a52c1-3666-539f-83f8-aa7ef6c7c85b')
  })
})
