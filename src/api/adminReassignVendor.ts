/**
 * POST admin-reassign-vendor Edge Function (ADMIN_REASSIGN_SECRET).
 * See supabase/VENDOR_PORTAL.md.
 * Prefer `vendorId` (uuid) when known; otherwise the Edge resolves `vendorName`.
 *
 * Hosted Supabase validates `Authorization` as a JWT; the admin secret is sent in
 * `x-admin-reassign-secret` when `VITE_SUPABASE_ANON_KEY` is set.
 */

/** Dev-only: warn when reassign URL points at a different host than `VITE_SUPABASE_URL` (typos → Failed to fetch). */
function warnIfAdminReassignHostMismatch(url: string): void {
  if (!import.meta.env.DEV) return
  const base = import.meta.env.VITE_SUPABASE_URL?.trim()
  if (!base) return
  try {
    const u = new URL(url)
    const b = new URL(base.replace(/\/$/, ''))
    if (u.hostname !== b.hostname) {
      console.warn(
        '[admin reassign] VITE_ADMIN_REASSIGN_URL host differs from VITE_SUPABASE_URL — wrong project ref often causes Failed to fetch.',
        { reassignHost: u.hostname, supabaseHost: b.hostname },
      )
    }
  } catch {
    console.warn('[admin reassign] VITE_ADMIN_REASSIGN_URL is not a valid URL:', url)
  }
}

/**
 * `fetch` for admin Edge URLs; turns opaque `TypeError: Failed to fetch` into
 * actionable text (CORS preflight, bad host, offline, extensions).
 */
export async function fetchAdminEdgeFunction(
  url: string,
  init: RequestInit,
): Promise<Response> {
  warnIfAdminReassignHostMismatch(url)
  try {
    return await fetch(url, init)
  } catch (e) {
    if (e instanceof TypeError) {
      const u = url.trim()
      throw new TypeError(
        `Failed to reach ${u}: ${e.message}. Check DevTools → Network for a failed OPTIONS (CORS) or DNS error; copy the function URL from Supabase Dashboard (same project as VITE_SUPABASE_URL); redeploy admin-reassign-vendor / recommend-vendor-alternatives after CORS changes.`,
      )
    }
    throw e
  }
}

/** Headers for admin-only Edge calls from the browser against hosted Supabase. */
export function adminEdgeInvokeHeaders(secret: string): Record<string, string> {
  const s = secret.trim()
  const anon =
    typeof import.meta !== "undefined" &&
    import.meta.env?.VITE_SUPABASE_ANON_KEY != null
      ? String(import.meta.env.VITE_SUPABASE_ANON_KEY).trim()
      : ""
  const h: Record<string, string> = {
    "Content-Type": "application/json",
    "x-admin-reassign-secret": s,
  }
  if (anon) {
    h.apikey = anon
    h.Authorization = `Bearer ${anon}`
  } else {
    h.Authorization = `Bearer ${s}`
  }
  return h
}

export type AdminVendorReassignChoice = {
  vendorName: string
  vendorId?: string
  /** When true, Edge creates an active vendor row if `vendorName` is not found. */
  createVendorIfMissing?: boolean
  /** Stored on the new vendor row when `createVendorIfMissing` runs (issue category slug). */
  vendorCategory?: string | null
}

export type AdminReassignVendorInput = {
  url: string
  secret: string
  ticketId: string
} & AdminVendorReassignChoice

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
  const vid = input.vendorId?.trim()
  const name = input.vendorName.trim()
  if (!vid && !name) {
    throw new Error("Admin reassign: vendorName or vendorId required")
  }
  const requestJson: Record<string, string | boolean> = {
    ticketId: input.ticketId.trim(),
  }
  if (vid) {
    requestJson.vendorId = vid
  } else {
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
      throw new Error(
        `${base} (401): Edge secret ADMIN_REASSIGN_SECRET must exactly match VITE_ADMIN_REASSIGN_SECRET for this project (trimmed; check Dashboard → Edge Functions → Secrets).`,
      )
    }
    throw new Error(base)
  }
  return parsed as AdminReassignVendorOk
}
