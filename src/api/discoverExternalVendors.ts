/**
 * POST discover-external-vendors (same ADMIN_REASSIGN_SECRET as admin reassign).
 */

import {
  adminEdgeInvokeHeaders,
  fetchAdminEdgeFunction,
} from '@/api/adminReassignVendor'
import { formatAdminEdgeUnauthorizedError } from '@/lib/adminEdgeAuth'
import { EXTERNAL_VENDOR_SEARCH_LIMIT } from '@shared/externalVendor/searchLimit'

export type ExternalVendorContactStatus = 'awaiting_response' | 'vendor_replied' | 'closed'

export type ExternalVendorJobContextDto = {
  propertyAddress: string
  jobCategory: string
  issueSummary: string | null
  urgency: string | null
  timeframe: string | null
}

export type ExternalVendorSuggestionDto = {
  name: string
  rating: number | null
  reviewCount: number | null
  priceLabel: string | null
  sources: ('thumbtack' | 'mock')[]
  etaMinutes?: number | null
  address?: string | null
  phone?: string | null
  website?: string | null
  tags?: string[]
  listingUrl?: string | null
  searchId?: string | null
  categoryId?: string | null
  providerRef?: string | null
  contactStatus?: ExternalVendorContactStatus | null
  contactedAt?: string | null
  lastInboundAt?: string | null
  lastInboundPreview?: string | null
  imageUrl?: string | null
}

export type DiscoverExternalVendorsOk = {
  ticketId: string
  suggestions: ExternalVendorSuggestionDto[]
  providersUsed?: ('thumbtack' | 'mock')[]
  mode?: 'live' | 'mock'
  configured: boolean
  notice?: string
  searchLocation?: string
  locationLabel?: string
  areaLabel?: string | null
  issueCategory?: string | null
  jobContext?: ExternalVendorJobContextDto
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
    body: JSON.stringify({
      ticketId: input.ticketId.trim(),
      limit: EXTERNAL_VENDOR_SEARCH_LIMIT,
    }),
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
      throw new Error(formatAdminEdgeUnauthorizedError(base))
    }
    throw new Error(base)
  }
  return body as DiscoverExternalVendorsOk
}
