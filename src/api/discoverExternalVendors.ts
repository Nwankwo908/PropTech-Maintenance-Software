/**
 * POST discover-external-vendors (same ADMIN_REASSIGN_SECRET as admin reassign).
 */

import {
  adminEdgeInvokeHeaders,
  fetchAdminEdgeFunction,
} from '@/api/adminReassignVendor'

export type ExternalVendorSuggestionDto = {
  name: string
  rating: number | null
  reviewCount: number | null
  priceLabel: string | null
  sources: ('google' | 'yelp' | 'netvendor' | 'mock')[]
  etaMinutes?: number | null
  address?: string | null
  phone?: string | null
  website?: string | null
  tags?: string[]
}

export type DiscoverExternalVendorsOk = {
  ticketId: string
  suggestions: ExternalVendorSuggestionDto[]
  providersUsed?: ('google' | 'yelp' | 'netvendor' | 'mock')[]
  mode?: 'live' | 'mock'
  configured: boolean
  notice?: string
}

export function resolveDiscoverExternalVendorsUrl(): string | null {
  const explicit = import.meta.env.VITE_DISCOVER_EXTERNAL_VENDORS_URL?.trim()
  if (explicit) return explicit
  const base = import.meta.env.VITE_SUPABASE_URL?.trim()?.replace(/\/$/, '')
  if (base) return `${base}/functions/v1/discover-external-vendors`
  return null
}

export async function postDiscoverExternalVendors(input: {
  url: string
  secret: string
  ticketId: string
}): Promise<DiscoverExternalVendorsOk> {
  const url = input.url.trim()
  const secret = input.secret.trim()
  if (!url || !secret) {
    throw new Error('Discover vendors: missing URL or secret')
  }
  const res = await fetchAdminEdgeFunction(url, {
    method: 'POST',
    headers: adminEdgeInvokeHeaders(secret),
    body: JSON.stringify({ ticketId: input.ticketId.trim() }),
  })
  const text = await res.text()
  let body: unknown
  try {
    body = text ? JSON.parse(text) : {}
  } catch {
    throw new Error(`Discover vendors: invalid JSON (${res.status})`)
  }
  if (!res.ok) {
    const err = body as { error?: string }
    const base = err.error ?? `Discover vendors failed (${res.status})`
    if (
      res.status === 401 &&
      String(err.error ?? '').toLowerCase() === 'unauthorized'
    ) {
      throw new Error(
        `${base} (401): Edge ADMIN_REASSIGN_SECRET must match VITE_ADMIN_REASSIGN_SECRET.`,
      )
    }
    throw new Error(base)
  }
  return body as DiscoverExternalVendorsOk
}
