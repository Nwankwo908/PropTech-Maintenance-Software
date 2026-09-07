import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { analytics } from './index'
import {
  captureAttributionFromLocation,
  getStoredAttribution,
  parseUtmParams,
} from './attribution'
import { shouldMaskClarityDom } from './clarityMasking'
import { isAnalyticsEnabled, isProductionAnalyticsHost } from './isAnalyticsEnabled'
import {
  pickClarityTags,
  pickIdentifyContext,
  sanitizeAnalyticsProperties,
  sanitizeEventName,
  sanitizePageLocation,
  sanitizePagePath,
} from './sanitize'

describe('isProductionAnalyticsHost', () => {
  it('allows the Ulo production hosts', () => {
    expect(isProductionAnalyticsHost('ulohome.io')).toBe(true)
    expect(isProductionAnalyticsHost('app.ulohome.io')).toBe(true)
    expect(isProductionAnalyticsHost('www.ulohome.io')).toBe(true)
  })

  it('rejects local, staging, and preview hosts', () => {
    expect(isProductionAnalyticsHost('localhost')).toBe(false)
    expect(isProductionAnalyticsHost('127.0.0.1')).toBe(false)
    expect(isProductionAnalyticsHost('ulo.vercel.app')).toBe(false)
    expect(isProductionAnalyticsHost('staging.ulohome.io')).toBe(false)
    expect(isProductionAnalyticsHost('preview.ulohome.io')).toBe(false)
    expect(isProductionAnalyticsHost('dev.ulohome.io')).toBe(false)
  })
})

describe('isAnalyticsEnabled', () => {
  it('is off in Vite non-production (dev / unit tests)', () => {
    expect(isAnalyticsEnabled()).toBe(false)
  })
})

describe('sanitizeAnalyticsProperties', () => {
  it('drops PII keys and values', () => {
    const clean = sanitizeAnalyticsProperties({
      email: 'a@b.com',
      phone: '555-123-4567',
      name: 'EJ',
      address: '123 Main St',
      resident: 'tenant-1',
      vendor: 'Jl Tech',
      acquisition_source: 'biggerpockets',
      property_count: 3,
      note: 'hello a@b.com',
    })
    expect(clean).toEqual({
      acquisition_source: 'biggerpockets',
      property_count: 3,
    })
  })

  it('keeps anonymous UUIDs', () => {
    expect(
      sanitizeAnalyticsProperties({
        anonymous_id: '11111111-1111-4111-8111-111111111111',
      }),
    ).toEqual({
      anonymous_id: '11111111-1111-4111-8111-111111111111',
    })
  })
})

describe('sanitizeEventName and page path', () => {
  it('normalizes event names', () => {
    expect(sanitizeEventName('Signup Completed')).toBe('signup_completed')
    expect(sanitizeEventName('')).toBeNull()
  })

  it('strips query strings from page paths', () => {
    expect(sanitizePagePath('/admin?email=a@b.com')).toBe('/admin')
  })

  it('builds page locations without query or hash', () => {
    expect(
      sanitizePageLocation('/admin/residents?utm_source=biggerpockets&email=a@b.com#top', 'https://app.ulohome.io'),
    ).toBe('https://app.ulohome.io/admin/residents')
  })
})

describe('pickIdentifyContext', () => {
  it('keeps only anonymous id and acquisition fields', () => {
    expect(
      pickIdentifyContext({
        anonymous_id: '11111111-1111-4111-8111-111111111111',
        email: 'hidden@ulo.test',
        acquisition_source: 'biggerpockets',
        landlord_name: 'Kendo',
      }),
    ).toEqual({
      anonymous_id: '11111111-1111-4111-8111-111111111111',
      acquisition_source: 'biggerpockets',
    })
  })
})

describe('Clarity tags and DOM masking', () => {
  it('allows only acquisition tags', () => {
    expect(
      pickClarityTags({
        acquisition_source: 'biggerpockets',
        email: 'hidden@ulo.test',
        name: 'EJ',
        description: 'Kitchen sink leaking, tenant Jane at 555-123-4567',
        anonymous_id: '11111111-1111-4111-8111-111111111111',
      }),
    ).toEqual({ acquisition_source: 'biggerpockets' })
  })

  it('leaves marketing pages unmasked and masks operational screens', () => {
    expect(shouldMaskClarityDom('/')).toBe(false)
    expect(shouldMaskClarityDom('/privacy')).toBe(false)
    expect(shouldMaskClarityDom('/admin/login')).toBe(true)
    expect(shouldMaskClarityDom('/admin/residents')).toBe(true)
    expect(shouldMaskClarityDom('/admin/communication')).toBe(true)
    expect(shouldMaskClarityDom('/request')).toBe(true)
    expect(shouldMaskClarityDom('/pay/rent')).toBe(true)
    expect(shouldMaskClarityDom('/invoice/abc')).toBe(true)
    expect(shouldMaskClarityDom('/v/token')).toBe(true)
    expect(shouldMaskClarityDom('/w/token')).toBe(true)
  })
})

function installMemoryWindow() {
  const data = new Map<string, string>()
  const localStorage = {
    getItem: (key: string) => data.get(`local:${key}`) ?? null,
    setItem: (key: string, value: string) => {
      data.set(`local:${key}`, value)
    },
    removeItem: (key: string) => {
      data.delete(`local:${key}`)
    },
    clear: () => {
      for (const key of [...data.keys()]) {
        if (key.startsWith('local:')) data.delete(key)
      }
    },
  }
  const sessionStorage = {
    getItem: (key: string) => data.get(`session:${key}`) ?? null,
    setItem: (key: string, value: string) => {
      data.set(`session:${key}`, value)
    },
    removeItem: (key: string) => {
      data.delete(`session:${key}`)
    },
    clear: () => {
      for (const key of [...data.keys()]) {
        if (key.startsWith('session:')) data.delete(key)
      }
    },
  }
  ;(globalThis as { window?: unknown }).window = {
    localStorage,
    sessionStorage,
    location: { search: '', pathname: '/', hostname: 'localhost' },
  }
}

describe('attribution', () => {
  beforeEach(() => {
    installMemoryWindow()
  })

  afterEach(() => {
    delete (globalThis as { window?: unknown }).window
  })

  it('parses allowlisted UTM values', () => {
    expect(
      parseUtmParams(
        '?utm_source=biggerpockets&utm_medium=referral&utm_campaign=2026_landlord_launch&email=nope@x.com',
      ),
    ).toEqual({
      source: 'biggerpockets',
      medium: 'referral',
      campaign: '2026_landlord_launch',
    })
  })

  it('never overwrites first-touch and updates latest-touch for a new campaign', () => {
    captureAttributionFromLocation('?utm_source=biggerpockets&utm_medium=referral')
    const firstWrite = getStoredAttribution()
    captureAttributionFromLocation('?utm_source=google&utm_medium=cpc&utm_campaign=spring')
    const stored = getStoredAttribution()
    expect(stored.firstTouch.source).toBe('biggerpockets')
    expect(stored.firstTouch.medium).toBe('referral')
    expect(stored.firstTouch.capturedAt).toBe(firstWrite.firstTouch.capturedAt)
    expect(stored.latestTouch.source).toBe('google')
    expect(stored.latestTouch.campaign).toBe('spring')
    expect(stored.latestTouch.capturedAt).toBeTruthy()
  })

  it('does not bump latest-touch when the same UTM set is seen again', () => {
    captureAttributionFromLocation('?utm_source=biggerpockets&utm_campaign=launch')
    const first = getStoredAttribution()
    captureAttributionFromLocation('?utm_source=biggerpockets&utm_campaign=launch')
    const second = getStoredAttribution()
    expect(second.latestTouch.capturedAt).toBe(first.latestTouch.capturedAt)
  })

  it('does not create first-touch from a URL without UTMs', () => {
    captureAttributionFromLocation('?code=oauth-redirect&email=a@b.com')
    expect(getStoredAttribution()).toEqual({ firstTouch: {}, latestTouch: {} })
  })
})

describe('analytics facade', () => {
  it('never throws when disabled', () => {
    expect(() => analytics.initialize()).not.toThrow()
    expect(() => analytics.pageView('/admin')).not.toThrow()
    expect(() => analytics.track('signup_started', { email: 'a@b.com' })).not.toThrow()
    expect(() => analytics.identifyAnonymousContext({ name: 'EJ' })).not.toThrow()
    expect(analytics.getAttribution()).toEqual(
      expect.objectContaining({
        firstTouch: expect.any(Object),
        latestTouch: expect.any(Object),
      }),
    )
  })
})
