/**
 * POST admin-reassign-vendor Edge Function (Bearer ADMIN_REASSIGN_SECRET).
 * See supabase/VENDOR_PORTAL.md.
 */

export type AdminReassignVendorInput = {
  url: string
  secret: string
  ticketId: string
  vendorName: string
}

export type AdminReassignVendorOk = {
  ok: true
  ticketId: string
  assigned_vendor_id: string
}

export async function postAdminReassignVendor(
  input: AdminReassignVendorInput,
): Promise<AdminReassignVendorOk> {
  const url = input.url.trim()
  const secret = input.secret.trim()
  if (!url || !secret) {
    throw new Error("Admin reassign: missing URL or secret")
  }
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${secret}`,
    },
    body: JSON.stringify({
      ticketId: input.ticketId.trim(),
      vendorName: input.vendorName.trim(),
    }),
  })
  const text = await res.text()
  let body: unknown
  try {
    body = text ? JSON.parse(text) : {}
  } catch {
    throw new Error(`Admin reassign: invalid JSON (${res.status})`)
  }
  if (!res.ok) {
    const err = body as { error?: string }
    throw new Error(err.error ?? `Admin reassign failed (${res.status})`)
  }
  return body as AdminReassignVendorOk
}
