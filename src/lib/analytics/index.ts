import {
  attributionToEventProps,
  captureAttributionFromLocation,
  getOrCreateAnonymousId,
  getStoredAttribution,
  type AttributionSnapshot,
} from './attribution'
import { clarityIdentifyAnonymous, claritySetApprovedTags, initClarity } from './clarity'
import { ga4PageView, ga4SetAnonymousUserId, ga4SetUserProperties, ga4Track, initGa4 } from './ga4'
import { isAnalyticsEnabled } from './isAnalyticsEnabled'
import {
  pickIdentifyContext,
  sanitizeAnalyticsProperties,
  sanitizeEventName,
  sanitizePagePath,
  type AnalyticsProperties,
} from './sanitize'

function swallow(run: () => void): void {
  try {
    run()
  } catch {
    /* analytics must never affect the app */
  }
}

let initialized = false
let lastPageViewPath: string | null = null

function initialize(): void {
  swallow(() => {
    captureAttributionFromLocation()
    if (!isAnalyticsEnabled()) return
    if (initialized) return
    initialized = true
    initGa4()
    initClarity()
    identifyAnonymousContext()
  })
}

function pageView(pathname?: string): void {
  swallow(() => {
    // Store allowlisted UTMs locally. Never send location.search to GA4.
    captureAttributionFromLocation()
    if (!isAnalyticsEnabled()) return
    if (!initialized) initialize()
    const path = sanitizePagePath(
      pathname ?? (typeof window !== 'undefined' ? window.location.pathname : '/'),
    )
    if (lastPageViewPath === path) return
    lastPageViewPath = path
    ga4PageView(path)
  })
}

function track(eventName: string, properties?: Record<string, unknown>): void {
  swallow(() => {
    if (!isAnalyticsEnabled()) return
    if (!initialized) initialize()
    const name = sanitizeEventName(eventName)
    if (!name) return
    const attribution = attributionToEventProps(getStoredAttribution().firstTouch)
    const merged = sanitizeAnalyticsProperties({
      ...attribution,
      ...(properties ?? {}),
    })
    ga4Track(name, merged)
  })
}

function identifyAnonymousContext(context?: Record<string, unknown>): void {
  swallow(() => {
    captureAttributionFromLocation()
    if (!isAnalyticsEnabled()) return
    if (!initialized) {
      initialized = true
      initGa4()
      initClarity()
    }
    const anonymousId = getOrCreateAnonymousId()
    const attribution = attributionToEventProps(getStoredAttribution().firstTouch)
    const props = pickIdentifyContext({
      ...(anonymousId ? { anonymous_id: anonymousId } : {}),
      ...attribution,
      ...(context ?? {}),
    })
    if (anonymousId) {
      ga4SetAnonymousUserId(anonymousId)
      clarityIdentifyAnonymous(anonymousId)
    }
    if (Object.keys(props).length > 0) {
      ga4SetUserProperties(props)
    }
    claritySetApprovedTags(attribution)
  })
}

function captureAttribution(): AttributionSnapshot {
  try {
    return captureAttributionFromLocation()
  } catch {
    return { firstTouch: {}, latestTouch: {} }
  }
}

function getAttribution(): AttributionSnapshot {
  try {
    captureAttributionFromLocation()
    return getStoredAttribution()
  } catch {
    return { firstTouch: {}, latestTouch: {} }
  }
}

export const analytics = {
  initialize,
  pageView,
  track,
  identifyAnonymousContext,
  getAttribution,
  captureAttribution,
}

export type { AttributionSnapshot, AttributionTouch } from './attribution'
export type { AnalyticsProperties } from './sanitize'
export { isAnalyticsEnabled } from './isAnalyticsEnabled'
