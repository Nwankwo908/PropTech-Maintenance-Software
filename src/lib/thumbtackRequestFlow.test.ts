import { describe, expect, it } from 'vitest'
import { resolveThumbtackRequestFlowUrl } from '@shared/externalVendor/thumbtackRequestFlow'

describe('resolveThumbtackRequestFlowUrl', () => {
  it('prefers the Request Flow widget URL', () => {
    expect(
      resolveThumbtackRequestFlowUrl({
        requestFlowUrl: 'https://thumbtack.com/embed/request-flow?x=1',
        listingUrl: 'https://thumbtack.com/example',
        searchId: 's1',
        categoryId: 'c1',
      }),
    ).toBe('https://thumbtack.com/embed/request-flow?x=1')
  })

  it('builds an embed URL from search and category ids', () => {
    expect(
      resolveThumbtackRequestFlowUrl({
        searchId: 's1',
        categoryId: 'c1',
        utmSource: 'ulo',
      }),
    ).toBe(
      'https://www.thumbtack.com/embed/request-flow?category_pk=c1&project_pk=s1&utm_source=cma-ulo',
    )
  })
})
