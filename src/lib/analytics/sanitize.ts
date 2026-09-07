const MAX_KEY_LEN = 40
const MAX_STRING_LEN = 100
const MAX_PROPS = 20

const BLOCKED_KEY_RE =
  /^(email|e-?mail|phone|mobile|tel|name|first_?name|last_?name|full_?name|address|street|unit|apartment|lease|ssn|password|token|secret|card|iban|routing|account_number|resident|vendor|tenant)$/i

const EMAIL_RE = /[^\s@]+@[^\s@]+\.[^\s@]+/
const PHONE_RE = /(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?){2}\d{4}/
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const ALLOWED_CONTEXT_KEYS = new Set([
  'anonymous_id',
  'acquisition_source',
  'acquisition_medium',
  'acquisition_campaign',
  'acquisition_content',
  'acquisition_term',
  'property_count',
  'unit_count',
  'job_type',
  'page_path',
])

/** Clarity custom tags — acquisition only. Never names, contacts, leases, payments, or ticket text. */
const ALLOWED_CLARITY_TAG_KEYS = new Set([
  'acquisition_source',
  'acquisition_medium',
  'acquisition_campaign',
  'acquisition_content',
  'acquisition_term',
])

export type AnalyticsProperties = Record<string, string | number | boolean>

function looksLikePiiValue(value: string): boolean {
  const t = value.trim()
  if (!t) return true
  if (UUID_RE.test(t)) return false
  if (EMAIL_RE.test(t)) return true
  if (PHONE_RE.test(t.replace(/\s/g, ''))) return true
  if (/\d{3,}\s+\w+/.test(t) && /\b(st|street|ave|avenue|rd|road|blvd|ln|dr|drive)\b/i.test(t)) {
    return true
  }
  return false
}

function sanitizeKey(key: string): string | null {
  const k = key.trim().slice(0, MAX_KEY_LEN)
  if (!k) return null
  if (BLOCKED_KEY_RE.test(k)) return null
  if (!/^[a-z][a-z0-9_]*$/i.test(k)) return null
  return k
}

function sanitizeValue(value: unknown): string | number | boolean | null {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (Math.abs(value) > 1e9) return null
    return value
  }
  if (typeof value === 'string') {
    const t = value.trim().slice(0, MAX_STRING_LEN)
    if (!t || looksLikePiiValue(t)) return null
    return t
  }
  return null
}

/** Drop PII keys/values. Unknown objects and arrays are omitted. */
export function sanitizeAnalyticsProperties(
  properties: Record<string, unknown> | null | undefined,
): AnalyticsProperties {
  const out: AnalyticsProperties = {}
  if (!properties || typeof properties !== 'object') return out
  let n = 0
  for (const [rawKey, rawVal] of Object.entries(properties)) {
    if (n >= MAX_PROPS) break
    const key = sanitizeKey(rawKey)
    if (!key) continue
    const value = sanitizeValue(rawVal)
    if (value == null) continue
    out[key] = value
    n += 1
  }
  return out
}

export function isAnonymousUuid(value: string | null | undefined): boolean {
  return Boolean(value && UUID_RE.test(value.trim()))
}

export function pickIdentifyContext(
  input: Record<string, unknown> | null | undefined,
): AnalyticsProperties {
  const clean = sanitizeAnalyticsProperties(input)
  const out: AnalyticsProperties = {}
  for (const [key, value] of Object.entries(clean)) {
    if (!ALLOWED_CONTEXT_KEYS.has(key)) continue
    if (key === 'anonymous_id' && typeof value === 'string' && !isAnonymousUuid(value)) continue
    out[key] = value
  }
  return out
}

export function pickClarityTags(
  input: Record<string, unknown> | null | undefined,
): Record<string, string> {
  const clean = sanitizeAnalyticsProperties(input)
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(clean)) {
    if (!ALLOWED_CLARITY_TAG_KEYS.has(key)) continue
    if (typeof value !== 'string') continue
    out[key] = value
  }
  return out
}

export function sanitizeEventName(name: string): string | null {
  const t = name.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 40)
  if (!t || !/^[a-z][a-z0-9_]*$/.test(t)) return null
  return t
}

export function sanitizePagePath(pathname: string): string {
  const path = pathname.trim() || '/'
  const withoutQuery = path.split('?')[0]?.split('#')[0] ?? '/'
  const collapsed = withoutQuery.replace(/\/{2,}/g, '/')
  return collapsed.slice(0, 200) || '/'
}

/** Origin + path only. Never include search, hash, or UTM query strings. */
export function sanitizePageLocation(
  pathname: string,
  origin?: string,
): string {
  const path = sanitizePagePath(pathname)
  const fallbackOrigin = 'https://ulohome.io'
  try {
    const rawOrigin =
      origin ?? (typeof window !== 'undefined' ? window.location.origin : fallbackOrigin)
    const url = new URL(rawOrigin)
    return `${url.origin}${path}`
  } catch {
    return `${fallbackOrigin}${path}`
  }
}
