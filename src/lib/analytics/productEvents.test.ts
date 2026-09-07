import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  analyticsJobType,
  approvedProductEventProperties,
  resetProductEventOnceForTests,
  trackProductEvent,
  trackProductEventOnce,
} from './productEvents'

vi.mock('./index', () => ({
  analytics: {
    track: vi.fn(),
  },
}))

import { analytics } from './index'

describe('product event properties', () => {
  it('keeps only allowlisted trade slugs for job_type', () => {
    expect(analyticsJobType('plumbing')).toBe('plumbing')
    expect(analyticsJobType('HVAC')).toBe('hvac')
    expect(analyticsJobType('Kitchen sink is leaking')).toBeUndefined()
    expect(analyticsJobType('de300000-0000-4000-8000-000000000003')).toBeUndefined()
  })

  it('keeps approved counts and drops everything else', () => {
    expect(
      approvedProductEventProperties({
        property_count: 2,
        unit_count: 8,
        job_type: 'electrical',
      }),
    ).toEqual({
      property_count: 2,
      unit_count: 8,
      job_type: 'electrical',
    })
  })

  it('accepts waitlist and vendor_matched event names', () => {
    vi.mocked(analytics.track).mockClear()
    trackProductEvent('waitlist_joined')
    trackProductEvent('vendor_matched', { job_type: 'plumbing' })
    expect(analytics.track).toHaveBeenCalledWith('waitlist_joined', {})
    expect(analytics.track).toHaveBeenCalledWith('vendor_matched', { job_type: 'plumbing' })
  })
})

describe('trackProductEventOnce', () => {
  beforeEach(() => {
    const store = new Map<string, string>()
    vi.stubGlobal('sessionStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value)
      },
      removeItem: (key: string) => {
        store.delete(key)
      },
      clear: () => store.clear(),
      key: (index: number) => [...store.keys()][index] ?? null,
      get length() {
        return store.size
      },
    })
    vi.mocked(analytics.track).mockClear()
    resetProductEventOnceForTests()
  })

  afterEach(() => {
    resetProductEventOnceForTests()
    vi.unstubAllGlobals()
  })

  it('sends a product event once per key', () => {
    trackProductEventOnce('job_completed', 'ticket-1', { job_type: 'plumbing' })
    trackProductEventOnce('job_completed', 'ticket-1', { job_type: 'plumbing' })
    expect(analytics.track).toHaveBeenCalledTimes(1)
    expect(analytics.track).toHaveBeenCalledWith('job_completed', { job_type: 'plumbing' })
  })

  it('allows the same event for a different entity key', () => {
    trackProductEventOnce('property_added', 'property-a', { unit_count: 4 })
    trackProductEventOnce('property_added', 'property-b', { unit_count: 2 })
    expect(analytics.track).toHaveBeenCalledTimes(2)
  })
})
