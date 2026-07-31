/**
 * POST admin-reassign-vendor Edge Function (ADMIN_REASSIGN_SECRET).
 * See supabase/VENDOR_PORTAL.md.
 * Prefer `vendorId` (uuid) when known; otherwise the Edge resolves `vendorName`.
 *
 * Hosted Supabase validates `Authorization` as a JWT; the admin secret is sent in
 * `x-admin-reassign-secret` when `VITE_SUPABASE_ANON_KEY` is set.
 */

import { requireAdminEdgeSecret, formatAdminEdgeUnauthorizedError } from '@/lib/adminEdgeAuth'

export {
  adminEdgeInvokeHeaders,
  fetchAdminEdgeFunction,
} from '@/lib/adminEdgeAuth'

export type AdminVendorReassignChoice = {
  vendorName: string
  vendorId?: string
  /** When true, Edge creates an active vendor row if `vendorName` is not found. */
  createVendorIfMissing?: boolean
  /** Stored on the new vendor row when `createVendorIfMissing` runs (issue category slug). */
  vendorCategory?: string | null
}

export type AdminReassignVendorOk = {
  ok: true
  ticketId: string
  vendorId: string
  vendorName: string
}

export function resolveAdminReassignUrl(): string | null {
  const explicit = import.meta.env.VITE_ADMIN_REASSIGN_URL?.trim()
  if (explicit) return explicit
  const base = import.meta.env.VITE_SUPABASE_URL?.trim()?.replace(/\/$/, '')
  if (base) return `${base}/functions/v1/admin-reassign-vendor`
  return null
}

export async function postAdminReassignVendor(input: {
  url: string
  secret?: string
  ticketId: string
  vendorName?: string
  vendorId?: string
  createVendorIfMissing?: boolean
  vendorCategory?: string | null
}): Promise<AdminReassignVendorOk> {
  const url = input.url.trim()
  const secret = (input.secret ?? requireAdminEdgeSecret('Admin reassign')).trim()
  if (!url) {
    throw new Error('Admin reassign: missing URL')
  }
  const vid = input.vendorId?.trim()
  const name = input.vendorName?.trim()
  if (!vid && !name) {
    throw new Error("Admin reassign: vendorName or vendorId required")
  }
  const requestJson: Record<string, string | boolean> = {
    ticketId: input.ticketId.trim(),
  }
  if (vid) {
    requestJson.vendorId = vid
  } else if (name) {
    requestJson.vendorName = name
  }
  if (input.createVendorIfMissing === true) {
    requestJson.createVendorIfMissing = true
  }
  const cat = input.vendorCategory?.trim()
  if (cat) {
    requestJson.vendorCategory = cat
  }

  const res = await fetchAdminEdgeFunction(url, {
    method: "POST",
    headers: adminEdgeInvokeHeaders(secret),
    body: JSON.stringify(requestJson),
  })
  const text = await res.text()
  let parsed: unknown
  try {
    parsed = text ? JSON.parse(text) : {}
  } catch {
    throw new Error(`Admin reassign: invalid JSON (${res.status})`)
  }
  if (!res.ok) {
    const err = parsed as { error?: string }
    const base = err.error ?? `Admin reassign failed (${res.status})`
    if (
      res.status === 401 &&
      String(err.error ?? '').toLowerCase() === 'unauthorized'
    ) {
      throw new Error(formatAdminEdgeUnauthorizedError(base))
    }
    throw new Error(base)
  }
  return parsed as AdminReassignVendorOk
}
