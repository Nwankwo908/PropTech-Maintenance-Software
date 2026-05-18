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
    const base = err.error ?? `Vendor recommendations failed (${res.status})`
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
  return body as RecommendVendorAlternativesOk
}
