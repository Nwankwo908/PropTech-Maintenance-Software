/**
 * POST recommend-vendor-alternatives (ADMIN_REASSIGN_SECRET via `x-admin-reassign-secret` when anon key is set).
 */

import {
  adminEdgeInvokeHeaders,
  fetchAdminEdgeFunction,
} from '@/api/adminReassignVendor'

export type AlternativeVendorDto = { id: string; name: string }

export type RecommendVendorAlternativesOk = {
  ticketId: string
  alternatives: AlternativeVendorDto[]
  mode: 'openai' | 'fallback'
}

export async function postRecommendVendorAlternatives(input: {
  url: string
  secret: string
  ticketId: string
  limit?: number
}): Promise<RecommendVendorAlternativesOk> {
  const url = input.url.trim()
  const secret = input.secret.trim()
  if (!url || !secret) {
    throw new Error('Vendor recommendations: missing URL or secret')
  }
  const res = await fetchAdminEdgeFunction(url, {
    method: 'POST',
    headers: adminEdgeInvokeHeaders(secret),
    body: JSON.stringify({
      ticketId: input.ticketId.trim(),
      limit: input.limit ?? 3,
    }),
  })
  const text = await res.text()
  let body: unknown
  try {
    body = text ? JSON.parse(text) : {}
  } catch {
    throw new Error(`Vendor recommendations: invalid JSON (${res.status})`)
  }
  if (!res.ok) {
    const err = body as { error?: string }
    if (
      res.status === 401 &&
      String(err.error ?? '').toLowerCase() === 'unauthorized'
    ) {
      throw new Error("This feature isn't available right now. Please try again later.")
    }
    throw new Error(
      typeof err.error === 'string' && err.error.trim()
        ? err.error.trim()
        : "Couldn't find vendors nearby. Please try again.",
    )
  }
  return body as RecommendVendorAlternativesOk
}
