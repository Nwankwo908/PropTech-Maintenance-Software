import { isAnalyticsEnabled } from './isAnalyticsEnabled'
import { sanitizePageLocation, type AnalyticsProperties } from './sanitize'

export type Ga4PageViewPayload = {
  page_path: string
  page_location: string
  send_to: string
}

declare global {
  interface Window {
    dataLayer?: unknown[]
    gtag?: (...args: unknown[]) => void
  }
}

function measurementId(): string {
  return (import.meta.env.VITE_GA4_MEASUREMENT_ID ?? '').trim()
}

function loadGtag(id: string): void {
  if (typeof document === 'undefined') return
  if (document.querySelector(`script[data-ulo-ga4="${id}"]`)) return

  window.dataLayer = window.dataLayer ?? []
  window.gtag = function gtag(...args: unknown[]) {
    window.dataLayer?.push(args)
  }

  const script = document.createElement('script')
  script.async = true
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`
  script.dataset.uloGa4 = id
  document.head.appendChild(script)

  window.gtag('js', new Date())
  window.gtag('config', id, {
    send_page_view: false,
    anonymize_ip: true,
    allow_google_signals: false,
    allow_ad_personalization_signals: false,
    page_location: sanitizePageLocation(
      typeof window !== 'undefined' ? window.location.pathname : '/',
    ),
  })
}

export function initGa4(): void {
  if (!isAnalyticsEnabled()) return
  const id = measurementId()
  if (!id) return
  loadGtag(id)
}

export function buildGa4PageViewPayload(path: string): Ga4PageViewPayload | null {
  const id = measurementId()
  if (!id) return null
  return {
    page_path: path,
    page_location: sanitizePageLocation(path),
    send_to: id,
  }
}

export function ga4PageView(path: string): void {
  if (!isAnalyticsEnabled()) return
  if (!window.gtag) return
  const payload = buildGa4PageViewPayload(path)
  if (!payload) return
  window.gtag('event', 'page_view', payload)
}

export function ga4Track(eventName: string, properties: AnalyticsProperties): void {
  if (!isAnalyticsEnabled()) return
  if (!window.gtag) return
  window.gtag('event', eventName, properties)
}

export function ga4SetUserProperties(properties: AnalyticsProperties): void {
  if (!isAnalyticsEnabled()) return
  if (!window.gtag) return
  window.gtag('set', 'user_properties', properties)
}

export function ga4SetAnonymousUserId(anonymousId: string): void {
  if (!isAnalyticsEnabled()) return
  const id = measurementId()
  if (!id || !window.gtag) return
  window.gtag('config', id, {
    user_id: anonymousId,
    send_page_view: false,
    anonymize_ip: true,
    allow_google_signals: false,
    allow_ad_personalization_signals: false,
    page_location: sanitizePageLocation(
      typeof window !== 'undefined' ? window.location.pathname : '/',
    ),
  })
}
