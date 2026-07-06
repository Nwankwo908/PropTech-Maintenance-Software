/**
 * POST sla-auto-reassign — roster auto-reassign when SLA expired (ADMIN_REASSIGN_SECRET).
 */

import {
  adminEdgeInvokeHeaders,
  fetchAdminEdgeFunction,
} from '@/api/adminReassignVendor'

export type SlaAutoReassignOk = {
  ok: true
  ticketId: string
  outcome: 'reassigned' | 'needs_admin_vendor' | 'skipped'
  reason?: string
  newVendorId?: string
}

export function resolveSlaAutoReassignUrl(): string | null {
  const explicit = import.meta.env.VITE_SLA_AUTO_REASSIGN_URL?.trim()
  if (explicit) return explicit
  const base = import.meta.env.VITE_SUPABASE_URL?.trim()?.replace(/\/$/, '')
  if (base) return `${base}/functions/v1/sla-auto-reassign`
  return null
}

export async function postSlaAutoReassign(input: {
  url: string
  secret: string
  ticketId: string
}): Promise<SlaAutoReassignOk> {
  const url = input.url.trim()
  const secret = input.secret.trim()
  if (!url || !secret) {
    throw new Error('SLA auto-reassign: missing URL or secret')
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
    throw new Error(`SLA auto-reassign: invalid JSON (${res.status})`)
  }
  if (!res.ok) {
    const err = body as { error?: string }
    throw new Error(err.error ?? `SLA auto-reassign failed (${res.status})`)
  }
  return body as SlaAutoReassignOk
}
