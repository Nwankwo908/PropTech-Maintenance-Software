export type VendorApiTicket = {
  id: string
  created_at: string
  /** Preferred when present (matches resident urgency); falls back to `priority`. */
  urgency?: string | null
  priority?: string | null
  resident_name: string
  unit: string
  description: string
  photo_paths: string[] | null
  /** Time-limited signed URLs for `photo_paths` (set by vendor-list-tickets). */
  photo_urls?: string[] | null
  vendor_work_status: string
  assigned_vendor_id: string | null
  /** SLA target resolution time (ISO). */
  due_at?: string | null
  estimated_minutes?: number | null
  severity?: string | null
  issue_category?: string | null
}

export type VendorListResponse = {
  vendor: { id: string; name: string }
  tickets: VendorApiTicket[]
}

export function vendorPortalListUrl(): string | undefined {
  const u = import.meta.env.VITE_VENDOR_PORTAL_LIST_URL?.trim()
  return u || undefined
}

export function vendorPortalUpdateUrl(): string | undefined {
  const explicit = import.meta.env.VITE_VENDOR_PORTAL_UPDATE_URL?.trim()
  if (explicit) return explicit
  const list = vendorPortalListUrl()
  if (!list) return undefined
  return list.replace(/vendor-list-tickets\/?$/, "vendor-update-job-status")
}

const uuidRe =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export async function fetchVendorTickets(url: string, bearerToken: string): Promise<VendorListResponse> {
  const k =
    typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search).get('k')?.trim()
      : null

  const authToken = k || bearerToken

  console.log('[vendor-frontend] FINAL TOKEN USED:', authToken)

  const res = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${authToken}`,
      'Content-Type': 'application/json',
    },
  })

  // 4. Parse response safely
  let data: VendorListResponse | null = null
  try {
    data = (await res.json()) as VendorListResponse
  } catch {
    console.error('[vendor-frontend] failed to parse JSON')
  }

  // 5. Handle API errors properly
  if (!res.ok) {
    console.error('[vendor-frontend] API ERROR:', {
      status: res.status,
      data,
    })
    const errBody = data as { error?: string } | null
    throw new Error(errBody?.error || 'Request failed')
  }

  console.log('[vendor-frontend] SUCCESS:', data)

  if (!data) {
    throw new Error('Vendor list: empty response')
  }
  return data
}

export async function postVendorJobStatus(
  updateUrl: string,
  ticketId: string,
  action: "accept" | "decline" | "in_progress" | "completed",
  opts: { accessToken?: string; token?: string },
): Promise<{ vendor_work_status: string }> {
  if (!uuidRe.test(ticketId)) {
    throw new Error("Invalid ticket id")
  }
  const k =
    typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search).get('k')?.trim()
      : null
  const authToken = (k || opts.accessToken)?.trim()

  const headers: Record<string, string> = { "Content-Type": "application/json" }
  if (authToken) {
    headers.Authorization = `Bearer ${authToken}`
  }
  const body: Record<string, string> = { ticketId, action }
  if (opts.token) body.token = opts.token

  const res = await fetch(updateUrl, { method: "POST", headers, body: JSON.stringify(body) })
  const text = await res.text()
  let parsed: unknown
  try {
    parsed = text ? JSON.parse(text) : {}
  } catch {
    throw new Error(`Vendor update: invalid JSON (${res.status})`)
  }
  if (!res.ok) {
    const err = parsed as { error?: string; vendor_work_status?: string }
    const msg = err.error ?? `Vendor update failed (${res.status})`
    const e = new Error(msg) as Error & { status?: number; vendor_work_status?: string }
    e.status = res.status
    if (err.vendor_work_status) e.vendor_work_status = err.vendor_work_status
    throw e
  }
  const ok = parsed as { vendor_work_status?: string }
  if (!ok.vendor_work_status) throw new Error("Vendor update: missing status")
  return { vendor_work_status: ok.vendor_work_status }
}

export type UpdateJobStatusInput = {
  ticketId: string
  action: "accept" | "decline" | "in_progress" | "completed"
  updateUrl: string
  accessToken?: string
  token?: string
}

/**
 * Wrapper around {@link postVendorJobStatus}: throws on failure; returns `{ ok: true }` on success.
 */
export async function updateJobStatus(
  input: UpdateJobStatusInput,
): Promise<{ ok: true; vendor_work_status: string }> {
  const { vendor_work_status } = await postVendorJobStatus(
    input.updateUrl,
    input.ticketId,
    input.action,
    { accessToken: input.accessToken, token: input.token },
  )
  return { ok: true, vendor_work_status }
}
