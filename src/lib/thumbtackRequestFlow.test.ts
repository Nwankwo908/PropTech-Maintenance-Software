import { describe, expect, it } from 'vitest'
import {
  normalizeThumbtackUtmSource,
  resolveThumbtackRequestFlowUrl,
  resolveThumbtackServicePageEmbedUrl,
  THUMBTACK_SERVICE_PAGE_IFRAME_ID,
} from '@shared/externalVendor/thumbtackRequestFlow'

describe('resolveThumbtackRequestFlowUrl', () => {
  it('maps ulo / cma-ulo to the provisioned partner source', () => {
    expect(normalizeThumbtackUtmSource('ulo')).toBe('cma-ulohome')
    expect(normalizeThumbtackUtmSource('cma-ulo')).toBe('cma-ulohome')
    expect(normalizeThumbtackUtmSource('cma-ulohome')).toBe('cma-ulohome')
  })

  it('prefers the Request Flow widget URL and rewrites utm_source', () => {
    expect(
      resolveThumbtackRequestFlowUrl({
        requestFlowUrl: 'https://thumbtack.com/embed/request-flow?x=1&utm_source=cma-ulo',
        listingUrl: 'https://thumbtack.com/example',
        searchId: 's1',
        categoryId: 'c1',
      }),
    ).toBe(
      'https://thumbtack.com/embed/request-flow?x=1&utm_source=cma-ulohome&utm_medium=partnership',
    )
  })

  it('builds an embed URL from category + service_pk (official RF shape)', () => {
    expect(
      resolveThumbtackRequestFlowUrl({
        categoryId: 'c1',
        servicePk: '999',
        zipCode: '94107',
        utmSource: 'ulo',
      }),
    ).toBe(
      'https://thumbtack.com/embed/request-flow?category_pk=c1&service_pk=999&zip_code=94107&utm_source=cma-ulohome&utm_medium=partnership',
    )
  })

  it('falls back to project_pk from search id when service_pk is missing', () => {
    expect(
      resolveThumbtackRequestFlowUrl({
        searchId: 's1',
        categoryId: 'c1',
        utmSource: 'ulo',
      }),
    ).toBe(
      'https://thumbtack.com/embed/request-flow?category_pk=c1&project_pk=s1&utm_source=cma-ulohome&utm_medium=partnership',
    )
  })

  it('does not fall back to a public listing URL', () => {
    expect(
      resolveThumbtackRequestFlowUrl({
        listingUrl: 'https://www.thumbtack.com/ca/town/trade/name/service/999',
      }),
    ).toBeNull()
  })
})

describe('resolveThumbtackServicePageEmbedUrl', () => {
  it('rewrites an embed service-page URL with iframe_id and partner utm', () => {
    const url = resolveThumbtackServicePageEmbedUrl({
      listingUrl:
        'https://www.thumbtack.com/embed/service-page?category_pk=c1&service_pk=s1&utm_source=cma-ulo&iframe_id=REPLACE_THIS_ID_WITH_YOUR_IFRAME_ELEMENT_ID',
      iframeId: THUMBTACK_SERVICE_PAGE_IFRAME_ID,
    })
    expect(url).toContain('https://thumbtack.com/embed/service-page?')
    expect(url).toContain(`iframe_id=${THUMBTACK_SERVICE_PAGE_IFRAME_ID}`)
    expect(url).toContain('utm_source=cma-ulohome')
    expect(url).toContain('utm_medium=partnership')
    expect(url).not.toContain('REPLACE_THIS')
  })

  it('builds embed URL from providerRef + categoryId when listing is a public page', () => {
    const url = resolveThumbtackServicePageEmbedUrl({
      listingUrl: 'https://www.thumbtack.com/ca/town/trade/name/service/999',
      providerRef: '999',
      categoryId: 'c1',
      iframeId: THUMBTACK_SERVICE_PAGE_IFRAME_ID,
    })
    expect(url).toBe(
      `https://thumbtack.com/embed/service-page?category_pk=c1&service_pk=999&utm_source=cma-ulohome&utm_medium=partnership&iframe_id=${THUMBTACK_SERVICE_PAGE_IFRAME_ID}`,
    )
  })

  it('returns null for public pages without ids (cannot iframe)', () => {
    expect(
      resolveThumbtackServicePageEmbedUrl({
        listingUrl: 'https://www.thumbtack.com/ca/town/trade/name/service/only-path',
      }),
    ).toBeNull()
  })
})
