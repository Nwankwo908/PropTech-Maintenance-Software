import { describe, expect, it } from 'vitest'
import { buildLandlordAttributionPayload } from './persistLandlordAttribution'

describe('buildLandlordAttributionPayload', () => {
  it('maps first and latest touches onto landlord columns', () => {
    expect(
      buildLandlordAttributionPayload({
        firstTouch: {
          source: 'biggerpockets',
          medium: 'referral',
          capturedAt: '2026-09-01T12:00:00.000Z',
        },
        latestTouch: {
          source: 'google',
          medium: 'cpc',
          campaign: 'spring',
          capturedAt: '2026-09-07T12:00:00.000Z',
        },
      }),
    ).toEqual({
      acquisition_source: 'biggerpockets',
      acquisition_medium: 'referral',
      acquisition_first_touch_at: '2026-09-01T12:00:00.000Z',
      latest_acquisition_source: 'google',
      latest_acquisition_medium: 'cpc',
      latest_acquisition_campaign: 'spring',
      latest_acquisition_content: null,
      latest_acquisition_term: null,
      acquisition_latest_touch_at: '2026-09-07T12:00:00.000Z',
    })
  })

  it('returns null when there is nothing to persist', () => {
    expect(buildLandlordAttributionPayload({ firstTouch: {}, latestTouch: {} })).toBeNull()
  })
})
