import { VENDOR_TRADE_SLUGS } from '@/lib/vendorTrades'
import { analytics } from './index'

export const PRODUCT_EVENTS = [
  'waitlist_started',
  'waitlist_joined',
  'signup_started',
  'signup_completed',
  'property_added',
  'unit_added',
  'maintenance_request_started',
  'maintenance_request_completed',
  'job_created',
  'vendor_matched',
  'job_completed',
  'second_job_created',
  'repeat_usage',
] as const

export type ProductEventName = (typeof PRODUCT_EVENTS)[number]

export type ProductEventProperties = {
  property_count?: number
  unit_count?: number
  job_type?: string
}

const PRODUCT_EVENT_SET = new Set<string>(PRODUCT_EVENTS)
const SESSION_ONCE_PREFIX = 'ulo_ae_'
const claimedOnce = new Set<string>()

function isProductEventName(name: string): name is ProductEventName {
  return PRODUCT_EVENT_SET.has(name)
}

function finiteCount(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return undefined
  return Math.round(value)
}

/** Allowlisted trade slug only — never free-text descriptions. */
export function analyticsJobType(raw: string | null | undefined): string | undefined {
  if (typeof raw !== 'string') return undefined
  const slug = raw.trim().toLowerCase().replace(/[\s-]+/g, '_')
  if (!slug) return undefined
  if (!(VENDOR_TRADE_SLUGS as readonly string[]).includes(slug)) return undefined
  return slug
}

export function approvedProductEventProperties(
  properties?: ProductEventProperties | null,
): Record<string, string | number> {
  const out: Record<string, string | number> = {}
  if (!properties) return out
  const propertyCount = finiteCount(properties.property_count)
  const unitCount = finiteCount(properties.unit_count)
  const jobType = analyticsJobType(properties.job_type)
  if (propertyCount != null) out.property_count = propertyCount
  if (unitCount != null) out.unit_count = unitCount
  if (jobType) out.job_type = jobType
  return out
}

function claimOnce(onceKey: string, persistSession: boolean): boolean {
  if (claimedOnce.has(onceKey)) return false
  if (persistSession && typeof sessionStorage !== 'undefined') {
    try {
      const stored = `${SESSION_ONCE_PREFIX}${onceKey}`
      if (sessionStorage.getItem(stored)) {
        claimedOnce.add(onceKey)
        return false
      }
      sessionStorage.setItem(stored, '1')
    } catch {
      /* private mode / quota — memory claim still applies */
    }
  }
  claimedOnce.add(onceKey)
  return true
}

/** Test helper. */
export function resetProductEventOnceForTests(): void {
  claimedOnce.clear()
  if (typeof sessionStorage === 'undefined') return
  try {
    const keys: string[] = []
    for (let i = 0; i < sessionStorage.length; i += 1) {
      const key = sessionStorage.key(i)
      if (key?.startsWith(SESSION_ONCE_PREFIX)) keys.push(key)
    }
    for (const key of keys) sessionStorage.removeItem(key)
  } catch {
    /* ignore */
  }
}

/**
 * Fire a product event after a real business success.
 * `analytics.track` no-ops off production and always merges first-touch acquisition fields.
 */
export function trackProductEvent(
  eventName: ProductEventName,
  properties?: ProductEventProperties,
): void {
  if (!isProductEventName(eventName)) return
  analytics.track(eventName, approvedProductEventProperties(properties))
}

/**
 * Same as `trackProductEvent`, but only the first success for `onceKey` in this tab.
 * Use entity ids as keys locally — they are never sent to GA4.
 */
export function trackProductEventOnce(
  eventName: ProductEventName,
  onceKey: string,
  properties?: ProductEventProperties,
  options?: { persistSession?: boolean },
): void {
  const trimmed = onceKey.trim()
  if (!trimmed) return
  const key = `${eventName}:${trimmed}`
  if (!claimOnce(key, options?.persistSession !== false)) return
  trackProductEvent(eventName, properties)
}
