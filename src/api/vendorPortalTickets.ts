import {
  readVendorAccessToken,
  VENDOR_INVALID_ACCESS_CODE_FLAG,
  VENDOR_TOKEN_STORAGE_KEY,
} from "@/lib/vendorToken"

function clearVendorTokenAndShowInvalidCode() {
  try {
    localStorage.removeItem(VENDOR_TOKEN_STORAGE_KEY)
  } catch {
    /* ignore */
  }
  try {
    sessionStorage.setItem(VENDOR_INVALID_ACCESS_CODE_FLAG, "1")
  } catch {
    /* ignore */
  }
  window.location.assign("/vendor")
}

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
  /** Time-limited signed URLs for `photo_paths` (from vendor-list-tickets). */
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

/** Collapses overlapping calls (e.g. React Strict Mode) to a single in-flight request. */
const vendorListInflight = new Map<string, Promise<VendorListResponse>>()
const vendorListRecentOk = new Map<string, { data: VendorListResponse; at: number }>()
const VENDOR_LIST_DEDUPE_MS = 15_000

async function executeVendorListFetch(
  url: string,
  vendorToken: string,
): Promise<VendorListResponse> {
  const bearer = readVendorAccessToken() || vendorToken.trim()
  if (!bearer) throw new Error("Missing vendor token")

  const headers = new Headers()
  headers.set("Authorization", `Bearer ${bearer}`)

  const res = await fetch(url, {
    method: "GET",
    headers,
  })

  if (res.status === 401) {
    clearVendorTokenAndShowInvalidCode()
    throw new Error("Invalid access code")
  }

  let data: VendorListResponse | null = null
  try {
    data = (await res.json()) as VendorListResponse
  } catch {
    console.error("[vendor-frontend] failed to parse JSON")
  }

  if (!res.ok) {
    console.error("[vendor-frontend] API ERROR:", {
      status: res.status,
      data,
    })
    const errBody = data as { error?: string } | null
    throw new Error(errBody?.error || "Request failed")
  }

  if (!data) {
    throw new Error("Vendor list: empty response")
  }
  return data
}

export async function fetchVendorTickets(
  url: string,
  vendorToken: string,
): Promise<VendorListResponse> {
  const bearer = readVendorAccessToken() || vendorToken.trim()
  if (!bearer) throw new Error("Missing vendor token")

  const key = `${url}::${bearer}`

  const recent = vendorListRecentOk.get(key)
  if (recent && Date.now() - recent.at < VENDOR_LIST_DEDUPE_MS) {
    return recent.data
  }

  let p = vendorListInflight.get(key)
  if (p) return p

  p = executeVendorListFetch(url, vendorToken)
    .then((data) => {
      vendorListRecentOk.set(key, { data, at: Date.now() })
      return data
    })
    .finally(() => {
      vendorListInflight.delete(key)
    })

  vendorListInflight.set(key, p)
  return p
}

const uuidRe =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export async function postVendorJobStatus(
  updateUrl: string,
  ticketId: string,
  action: "accept" | "decline" | "in_progress" | "completed",
  vendorToken: string,
): Promise<{ vendor_work_status: string }> {
  if (!uuidRe.test(ticketId)) {
    throw new Error("Invalid ticket id")
  }

  const bearer = readVendorAccessToken() || vendorToken.trim()
  if (!bearer) throw new Error("Missing vendor token")

  const headers = new Headers()
  headers.set("Authorization", `Bearer ${bearer}`)
  headers.set("Content-Type", "application/json")

  const res = await fetch(updateUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({ ticketId, action }),
  })

  if (res.status === 401) {
    clearVendorTokenAndShowInvalidCode()
    throw new Error("Invalid access code")
  }

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
  vendorToken: string
}

export async function updateJobStatus(
  input: UpdateJobStatusInput,
): Promise<{ ok: true; vendor_work_status: string }> {
  const { vendor_work_status } = await postVendorJobStatus(
    input.updateUrl,
    input.ticketId,
    input.action,
    input.vendorToken,
  )
  return { ok: true, vendor_work_status }
}
