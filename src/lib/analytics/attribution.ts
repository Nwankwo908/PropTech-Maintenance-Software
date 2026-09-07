/**
 * Anonymous UTM attribution. Browser storage is the source until it is copied
 * onto public.landlords (account-level). Not stored on residents or waitlist.
 *
 * Keys:
 *   localStorage / sessionStorage `ulo_attr_first`
 *   localStorage / sessionStorage `ulo_attr_latest`
 *
 * First-touch is write-once. Latest-touch updates only when a new valid UTM
 * set arrives (different source/medium/campaign/content/term).
 */

export const ATTRIBUTION_FIRST_STORAGE_KEY = 'ulo_attr_first'
export const ATTRIBUTION_LATEST_STORAGE_KEY = 'ulo_attr_latest'
export const ANONYMOUS_ID_STORAGE_KEY = 'ulo_anon_id'

export const UTM_QUERY_KEYS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_content',
  'utm_term',
] as const

const TOUCH_FIELDS = ['source', 'medium', 'campaign', 'content', 'term'] as const

export type AttributionTouch = {
  source?: string
  medium?: string
  campaign?: string
  content?: string
  term?: string
  capturedAt?: string
}

export type AttributionSnapshot = {
  firstTouch: AttributionTouch
  latestTouch: AttributionTouch
}

const UTM_VALUE_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/i
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/

function emptySnapshot(): AttributionSnapshot {
  return { firstTouch: {}, latestTouch: {} }
}

function getBrowserStorage(kind: 'local' | 'session'): Storage | null {
  try {
    if (typeof window === 'undefined') return null
    return kind === 'local' ? window.localStorage : window.sessionStorage
  } catch {
    return null
  }
}

function sanitizeUtmValue(raw: string | null | undefined): string | undefined {
  const t = (raw ?? '').trim()
  if (!t || t.length > 64) return undefined
  if (/@/.test(t) || /\d{7,}/.test(t)) return undefined
  if (!UTM_VALUE_RE.test(t)) return undefined
  return t.toLowerCase()
}

function sanitizeCapturedAt(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined
  const t = raw.trim()
  if (!ISO_RE.test(t)) return undefined
  return t
}

export function parseUtmParams(search: string): AttributionTouch {
  const out: AttributionTouch = {}
  try {
    const params = new URLSearchParams(search.startsWith('?') ? search : `?${search}`)
    const source = sanitizeUtmValue(params.get('utm_source'))
    const medium = sanitizeUtmValue(params.get('utm_medium'))
    const campaign = sanitizeUtmValue(params.get('utm_campaign'))
    const content = sanitizeUtmValue(params.get('utm_content'))
    const term = sanitizeUtmValue(params.get('utm_term'))
    if (source) out.source = source
    if (medium) out.medium = medium
    if (campaign) out.campaign = campaign
    if (content) out.content = content
    if (term) out.term = term
  } catch {
    return {}
  }
  return out
}

export function hasAttributionTouch(touch: AttributionTouch | null | undefined): boolean {
  if (!touch) return false
  return TOUCH_FIELDS.some((field) => Boolean(touch[field]))
}

function campaignFingerprint(touch: AttributionTouch): string {
  return TOUCH_FIELDS.map((field) => touch[field] ?? '').join('|')
}

function stringField(rec: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = rec[key]
    if (typeof value === 'string') return value
  }
  return undefined
}

function parseStoredTouch(raw: string | null): AttributionTouch {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return {}
    const rec = parsed as Record<string, unknown>
    const source = sanitizeUtmValue(stringField(rec, 'source', 'utm_source'))
    const medium = sanitizeUtmValue(stringField(rec, 'medium', 'utm_medium'))
    const campaign = sanitizeUtmValue(stringField(rec, 'campaign', 'utm_campaign'))
    const content = sanitizeUtmValue(stringField(rec, 'content', 'utm_content'))
    const term = sanitizeUtmValue(stringField(rec, 'term', 'utm_term'))
    const out: AttributionTouch = {}
    if (source) out.source = source
    if (medium) out.medium = medium
    if (campaign) out.campaign = campaign
    if (content) out.content = content
    if (term) out.term = term
    const capturedAt = sanitizeCapturedAt(rec.capturedAt)
    if (capturedAt) out.capturedAt = capturedAt
    return out
  } catch {
    return {}
  }
}

function readTouchFromStore(key: string): AttributionTouch {
  const local = parseStoredTouch(getBrowserStorage('local')?.getItem(key) ?? null)
  if (hasAttributionTouch(local)) return local
  const session = parseStoredTouch(getBrowserStorage('session')?.getItem(key) ?? null)
  if (hasAttributionTouch(session)) {
    persistTouch(key, session, { overwrite: false })
    return session
  }
  return {}
}

function persistTouch(
  key: string,
  touch: AttributionTouch,
  options: { overwrite: boolean },
): void {
  if (!hasAttributionTouch(touch)) return
  const payload = JSON.stringify(touch)
  for (const kind of ['local', 'session'] as const) {
    try {
      const store = getBrowserStorage(kind)
      if (!store) continue
      if (!options.overwrite) {
        const existing = parseStoredTouch(store.getItem(key))
        if (hasAttributionTouch(existing)) continue
      }
      store.setItem(key, payload)
    } catch {
      /* private mode / quota */
    }
  }
}

function stampTouch(touch: AttributionTouch, capturedAt: string): AttributionTouch {
  return { ...touch, capturedAt }
}

/**
 * Inspect the current URL (or an explicit search string) and persist
 * first-touch / latest-touch. Safe before authentication.
 */
export function captureAttributionFromLocation(
  search: string = typeof window !== 'undefined' ? window.location.search : '',
): AttributionSnapshot {
  try {
    const incoming = parseUtmParams(search)
    const existingFirst = readTouchFromStore(ATTRIBUTION_FIRST_STORAGE_KEY)
    const existingLatest = readTouchFromStore(ATTRIBUTION_LATEST_STORAGE_KEY)

    // Rule 1: first-touch is write-once. Never overwrite a stored first campaign.
    if (!hasAttributionTouch(existingFirst) && hasAttributionTouch(incoming)) {
      persistTouch(
        ATTRIBUTION_FIRST_STORAGE_KEY,
        stampTouch(incoming, new Date().toISOString()),
        { overwrite: false },
      )
    }

    if (hasAttributionTouch(incoming)) {
      const sameCampaign =
        hasAttributionTouch(existingLatest) &&
        campaignFingerprint(incoming) === campaignFingerprint(existingLatest)
      if (!sameCampaign) {
        persistTouch(
          ATTRIBUTION_LATEST_STORAGE_KEY,
          stampTouch(incoming, new Date().toISOString()),
          { overwrite: true },
        )
      }
    }

    return {
      firstTouch: readTouchFromStore(ATTRIBUTION_FIRST_STORAGE_KEY),
      latestTouch: readTouchFromStore(ATTRIBUTION_LATEST_STORAGE_KEY),
    }
  } catch {
    return emptySnapshot()
  }
}

export function getStoredAttribution(): AttributionSnapshot {
  try {
    return {
      firstTouch: readTouchFromStore(ATTRIBUTION_FIRST_STORAGE_KEY),
      latestTouch: readTouchFromStore(ATTRIBUTION_LATEST_STORAGE_KEY),
    }
  } catch {
    return emptySnapshot()
  }
}

export function getOrCreateAnonymousId(): string | null {
  try {
    const local = getBrowserStorage('local')
    const existing = local?.getItem(ANONYMOUS_ID_STORAGE_KEY)?.trim()
    if (existing && /^[0-9a-f-]{36}$/i.test(existing)) return existing
    const id = crypto.randomUUID()
    local?.setItem(ANONYMOUS_ID_STORAGE_KEY, id)
    return id
  } catch {
    return null
  }
}

export function attributionToEventProps(touch: AttributionTouch): Record<string, string> {
  const props: Record<string, string> = {}
  if (touch.source) props.acquisition_source = touch.source
  if (touch.medium) props.acquisition_medium = touch.medium
  if (touch.campaign) props.acquisition_campaign = touch.campaign
  if (touch.content) props.acquisition_content = touch.content
  if (touch.term) props.acquisition_term = touch.term
  return props
}

/** Capture from the URL, then return the stored first/latest snapshot for account persist. */
export function snapshotForAccountPersist(): AttributionSnapshot {
  return captureAttributionFromLocation()
}
