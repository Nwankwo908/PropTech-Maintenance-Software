import { describe, expect, it } from 'vitest'
import {
  normalizeThumbtackUtmSource,
  resolveThumbtackRequestFlowUrl,
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
    ).toBe('https://thumbtack.com/embed/request-flow?x=1&utm_source=cma-ulohome')
  })

  it('builds an embed URL from search and category ids', () => {
    expect(
      resolveThumbtackRequestFlowUrl({
        searchId: 's1',
        categoryId: 'c1',
        utmSource: 'ulo',
      }),
    ).toBe(
      'https://www.thumbtack.com/embed/request-flow?category_pk=c1&project_pk=s1&utm_source=cma-ulohome',
    )
  })
})
