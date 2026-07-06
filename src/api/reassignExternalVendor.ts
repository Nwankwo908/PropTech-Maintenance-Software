/**
 * POST reassign-external-vendor (ADMIN_REASSIGN_SECRET).
 */

import {
  adminEdgeInvokeHeaders,
  fetchAdminEdgeFunction,
} from '@/api/adminReassignVendor'

export type ReassignExternalVendorOk = {
  ok: true
  ticketId: string
  assigned_vendor_id: string
  createdVendor: boolean
}

export function resolveReassignExternalVendorUrl(): string | null {
  const explicit = import.meta.env.VITE_REASSIGN_EXTERNAL_VENDOR_URL?.trim()
  if (explicit) return explicit
  const base = import.meta.env.VITE_SUPABASE_URL?.trim()?.replace(/\/$/, '')
  if (base) return `${base}/functions/v1/reassign-external-vendor`
  return null
}

export async function postReassignExternalVendor(input: {
  url: string
  secret: string
  ticketId: string
  vendorName: string
  vendorCategory?: string | null
  rating?: number | null
  reviewCount?: number | null
  priceLabel?: string | null
  sources?: ('google' | 'yelp' | 'netvendor' | 'mock')[]
}): Promise<ReassignExternalVendorOk> {
  const url = input.url.trim()
  const secret = input.secret.trim()
  if (!url || !secret) {
    throw new Error('External reassign: missing URL or secret')
  }
  const res = await fetchAdminEdgeFunction(url, {
    method: 'POST',
    headers: adminEdgeInvokeHeaders(secret),
    body: JSON.stringify({
      ticketId: input.ticketId.trim(),
      vendorName: input.vendorName.trim(),
      vendorCategory: input.vendorCategory ?? undefined,
      rating: input.rating ?? undefined,
      reviewCount: input.reviewCount ?? undefined,
      priceLabel: input.priceLabel ?? undefined,
      sources: input.sources ?? undefined,
    }),
  })
  const text = await res.text()
  let body: unknown
  try {
    body = text ? JSON.parse(text) : {}
  } catch {
    throw new Error(`External reassign: invalid JSON (${res.status})`)
  }
  if (!res.ok) {
    const err = body as { error?: string }
    throw new Error(err.error ?? `External reassign failed (${res.status})`)
  }
  return body as ReassignExternalVendorOk
}
