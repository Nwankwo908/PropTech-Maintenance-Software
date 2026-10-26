/**
 * Official Ulo public app URL builder for the dashboard client.
 *
 * Prefer these helpers over concatenating window.location.origin + path.
 */

import {
  findVendorTicketToken,
  isResidentRequestRefToken,
  isUuidTicketToken,
} from '../../shared/maintenance/findVendorLink'

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

  /**
   * Landlord 1-tap estimate approve/decline result (rendered by the SPA).
   * Edge Functions redirect here instead of returning HTML.
   */
  estimateDecisionResult(
    params: {
      status: 'approved' | 'rejected' | 'error'
      already?: boolean
      message?: string | null
    },
    absolute = true,
  ): string {
    const url = new URL(
      joinOriginPath(
        absolute ? uloAppOrigin() : 'https://placeholder.local',
        '/estimate-decision',
      ),
    )
    url.searchParams.set('status', params.status)
    if (params.already) url.searchParams.set('already', '1')
    if (params.message?.trim()) {
      url.searchParams.set('message', params.message.trim().slice(0, 280))
    }
    if (!absolute) return `${url.pathname}${url.search}`
    return url.toString()
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

  /**
   * Overview → Find External Vendor for a work order.
   * Pass `{ requestRef }` to use the short resident ref instead of the UUID.
   * The admin session still has to resolve that ref to the landlord's ticket.
   */
  findExternalVendor(
    ticketId: string,
    absoluteOrOptions: boolean | { absolute?: boolean; requestRef?: string | null } = true,
  ): string {
    const absolute = typeof absoluteOrOptions === 'boolean'
      ? absoluteOrOptions
      : absoluteOrOptions.absolute !== false
    const requestRef = typeof absoluteOrOptions === 'object' ? absoluteOrOptions.requestRef : null
    const id = encodeURIComponent(findVendorTicketToken(ticketId, requestRef))
    const path = `/admin?findVendor=1&ticket=${id}`
    return absolute ? joinOriginPath(uloAppOrigin(), path) : path
  },

  /**
   * Admin Requests filtered to a specific work order (WO ref or ticket id).
   * Prefer the display ref (`WO-XXXX`) so the requests search matches.
   */
  adminWorkOrder(workOrderQuery: string, absolute = true): string {
    const q = encodeURIComponent(workOrderQuery.trim())
    const path = `/admin/requests?q=${q}`
    return absolute ? joinOriginPath(uloAppOrigin(), path) : path
  },

  /** Thumbtack authorization_code redirect (must match the registered redirect_uri). */
  thumbtackOauthCallback(_absolute = true): string {
    return 'https://www.ulohome.io/'
  },

  /** Lightweight phone capture page for AI Equipment Scan. */
  inspectionCapture(sessionId: string, token: string, absolute = true): string {
    const url = new URL(
      joinOriginPath(
        absolute ? uloAppOrigin() : 'https://placeholder.local',
        `/inspection/capture/${encodeURIComponent(sessionId.trim())}`,
      ),
    )
    url.searchParams.set('token', token.trim())
    if (!absolute) return `${url.pathname}${url.search}`
    return url.toString()
  },
}

export const FIND_EXTERNAL_VENDOR_QUERY = {
  flag: 'findVendor',
  ticket: 'ticket',
} as const

/** Ticket id from an Overview Find External Vendor deep link, or null. */
export function findExternalVendorTicketFromSearch(search: string): string | null {
  const raw = search.startsWith('?') ? search.slice(1) : search
  const params = new URLSearchParams(raw)
  if (params.get(FIND_EXTERNAL_VENDOR_QUERY.flag) !== '1') return null
  const ticketId = params.get(FIND_EXTERNAL_VENDOR_QUERY.ticket)?.trim() ?? ''
  return ticketId || null
}

/** UUID opens directly. A short ref resolves only for the signed-in landlord. */
export async function resolveFindVendorTicketId(
  supabase: {
    from: (table: string) => {
      select: (columns: string) => {
        eq: (column: string, value: string) => {
          eq: (column: string, value: string) => {
            maybeSingle: () => PromiseLike<{
              data: { id?: string } | null
              error: { message?: string } | null
            }>
          }
        }
      }
    }
  },
  landlordId: string,
  token: string,
): Promise<string | null> {
  const value = token.trim()
  if (!value) return null
  if (isUuidTicketToken(value)) return value
  if (!isResidentRequestRefToken(value) || !landlordId.trim()) return null
  const { data, error } = await supabase
    .from('maintenance_requests')
    .select('id')
    .eq('landlord_id', landlordId)
    .eq('resident_request_ref', value.toUpperCase())
    .maybeSingle()
  if (error || !data?.id) return null
  return String(data.id)
}

/** Thumbtack OAuth redirect on `/admin?code=&state=`. */
export function thumbtackOauthParamsFromSearch(search: string): {
  code: string
  state: string
  error: string | null
} | null {
  const raw = search.startsWith('?') ? search.slice(1) : search
  const params = new URLSearchParams(raw)
  const error = params.get('error')?.trim() || null
  const code = params.get('code')?.trim() ?? ''
  const state = params.get('state')?.trim() ?? ''
  if (error && state.length >= 8) return { code: '', state, error }
  if (code && state.length >= 8) return { code, state, error: null }
  return null
}
