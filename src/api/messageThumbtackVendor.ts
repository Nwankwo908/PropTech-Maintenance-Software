/**
 * POST/GET message-thumbtack-vendor (ADMIN_REASSIGN_SECRET). Never call Thumbtack from the browser.
 */

import {
  adminEdgeInvokeHeaders,
  fetchAdminEdgeFunction,
} from '@/api/adminReassignVendor'
import { formatAdminEdgeUnauthorizedError } from '@/lib/adminEdgeAuth'
import type { ExternalVendorContactStatus } from '@/api/discoverExternalVendors'

export type ThumbtackVendorThreadDto = {
  id: string
  ticket_id: string
  landlord_id: string
  business_id: string
  vendor_name: string
  search_id: string | null
  category_id: string | null
  request_id: string | null
  negotiation_id: string | null
  status: ExternalVendorContactStatus
  last_outbound_text: string | null
  last_outbound_at: string | null
  last_inbound_text: string | null
  last_inbound_at: string | null
}

export function resolveMessageThumbtackVendorUrl(): string | null {
  const explicit = import.meta.env.VITE_MESSAGE_THUMBTACK_VENDOR_URL?.trim()
  if (explicit) return explicit
  const base = import.meta.env.VITE_SUPABASE_URL?.trim()?.replace(/\/$/, '')
  if (base) return `${base}/functions/v1/message-thumbtack-vendor`
  return null
}

async function parseAdminJson(res: Response): Promise<unknown> {
  const text = await res.text()
  let body: unknown
  try {
    body = text ? JSON.parse(text) : {}
  } catch {
    throw new Error(`Thumbtack message: invalid JSON (${res.status})`)
  }
  if (!res.ok) {
    const err = body as { error?: string }
    const base = err.error ?? `Thumbtack message failed (${res.status})`
    if (res.status === 401 && String(err.error ?? '').toLowerCase() === 'unauthorized') {
      throw new Error(formatAdminEdgeUnauthorizedError(base))
    }
    throw new Error(base)
  }
  return body
}

export async function getThumbtackVendorThreads(input: {
  url: string
  secret: string
  ticketId: string
}): Promise<{ ticketId: string; threads: ThumbtackVendorThreadDto[] }> {
  const url = new URL(input.url.trim())
  url.searchParams.set('ticketId', input.ticketId.trim())
  const res = await fetchAdminEdgeFunction(url.toString(), {
    method: 'GET',
    headers: adminEdgeInvokeHeaders(input.secret.trim()),
  })
  return (await parseAdminJson(res)) as { ticketId: string; threads: ThumbtackVendorThreadDto[] }
}

export async function postMessageThumbtackVendor(input: {
  url: string
  secret: string
  ticketId: string
  businessId: string
  vendorName: string
  searchId?: string | null
  categoryId?: string | null
  text: string
}): Promise<{ ok: true; ticketId: string; thread: ThumbtackVendorThreadDto }> {
  const res = await fetchAdminEdgeFunction(input.url.trim(), {
    method: 'POST',
    headers: adminEdgeInvokeHeaders(input.secret.trim()),
    body: JSON.stringify({
      ticketId: input.ticketId.trim(),
      businessId: input.businessId.trim(),
      vendorName: input.vendorName.trim(),
      searchId: input.searchId ?? undefined,
      categoryId: input.categoryId ?? undefined,
      text: input.text,
    }),
  })
  return (await parseAdminJson(res)) as {
    ok: true
    ticketId: string
    thread: ThumbtackVendorThreadDto
  }
}
