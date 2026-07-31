/**
 * Official Ulo public app URL builder for the dashboard client.
 *
 * Prefer these helpers over concatenating window.location.origin + path.
 */

export const DEFAULT_ULO_APP_ORIGIN = 'https://app.ulohome.io'

/** Normalize a host or URL into `https://…` with no trailing slash. */
export function normalizeAppOrigin(raw: string | null | undefined): string {
  const t = (raw ?? '').trim().replace(/\/$/, '')
  if (!t) return ''
  if (/^https?:\/\//i.test(t)) return t
  return `https://${t}`
}

/**
 * Public app origin for absolute links.
 * Browser → current origin; else VITE_APP_URL / default.
 */
export function uloAppOrigin(): string {
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin.replace(/\/$/, '')
  }
  const fromEnv = normalizeAppOrigin(import.meta.env.VITE_APP_URL as string | undefined)
  if (fromEnv) return fromEnv
  return DEFAULT_ULO_APP_ORIGIN
}

function joinOriginPath(origin: string, path: string): string {
  const base = origin.replace(/\/$/, '')
  const p = path.startsWith('/') ? path : `/${path}`
  if (!base) return p
  return `${base}${p}`
}

export type RentPaymentLinkParams = {
  runId: string
  residentId: string
  billingPeriod: string
  amountDue: number
  query?: Record<string, string | number | boolean | null | undefined>
}

/** Named public app routes (absolute when origin is known). */
export const uloAppUrl = {
  absolute(path: string, origin: string = uloAppOrigin()): string {
    return joinOriginPath(origin, path)
  },

  /** Relative path only (for React Router). */
  path(path: string): string {
    return path.startsWith('/') ? path : `/${path}`
  },

  vendorVerification(token: string, absolute = true): string {
    const path = `/v/${encodeURIComponent(token.trim())}`
    return absolute ? joinOriginPath(uloAppOrigin(), path) : path
  },

  rentPayment(params: RentPaymentLinkParams, absolute = true): string {
    const url = new URL(
      joinOriginPath(absolute ? uloAppOrigin() : 'https://placeholder.local', '/pay/rent'),
    )
    url.searchParams.set('run', params.runId)
    url.searchParams.set('resident', params.residentId)
    url.searchParams.set('period', params.billingPeriod)
    url.searchParams.set('amount', String(params.amountDue))
    if (params.query) {
      for (const [key, value] of Object.entries(params.query)) {
        if (value == null) continue
        url.searchParams.set(key, String(value))
      }
    }
    if (!absolute) return `${url.pathname}${url.search}`
    return url.toString()
  },

  workOrder(token: string, absolute = false): string {
    const path = `/w/${encodeURIComponent(token.trim())}`
    return absolute ? joinOriginPath(uloAppOrigin(), path) : path
  },

  estimate(token: string, absolute = false): string {
    const path = `/estimate/${encodeURIComponent(token.trim())}`
    return absolute ? joinOriginPath(uloAppOrigin(), path) : path
  },

  invoice(token: string, absolute = false): string {
    const path = `/invoice/${encodeURIComponent(token.trim())}`
    return absolute ? joinOriginPath(uloAppOrigin(), path) : path
  },

  upload(token: string, absolute = false): string {
    const path = `/upload/${encodeURIComponent(token.trim())}`
    return absolute ? joinOriginPath(uloAppOrigin(), path) : path
  },

  admin(path = '', absolute = true): string {
    const trimmed = path.trim()
    const suffix = !trimmed
      ? '/admin'
      : trimmed.startsWith('/admin')
        ? trimmed.startsWith('/')
          ? trimmed
          : `/${trimmed}`
        : `/admin/${trimmed.replace(/^\//, '')}`
    return absolute ? joinOriginPath(uloAppOrigin(), suffix) : suffix
  },
}
