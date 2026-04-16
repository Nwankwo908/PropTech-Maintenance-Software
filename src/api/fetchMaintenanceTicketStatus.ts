const STATUS_URL = import.meta.env.VITE_MAINTENANCE_TICKET_STATUS_URL as
  | string
  | undefined

export function isMaintenanceTicketStatusConfigured(): boolean {
  return Boolean(STATUS_URL?.trim())
}

const POLL_MS_RAW = import.meta.env.VITE_MAINTENANCE_TICKET_STATUS_POLL_MS as
  | string
  | undefined

/** Poll interval when status URL is set (default 45s). */
export function maintenanceTicketStatusPollIntervalMs(): number {
  const n = Number.parseInt(POLL_MS_RAW ?? '', 10)
  if (Number.isFinite(n) && n >= 5000) return n
  return 45_000
}

export type TicketStatusAuth = {
  accessToken: string
  residentUserId: string
}

export type MaintenanceTicketStatusResult = {
  /** Raw status string from the API (mapped in the UI layer). */
  status: string
  /** Optional line shown under the active step (e.g. ETA or note). */
  detail?: string
}

function buildStatusUrl(base: string, ticketId: string): string {
  const b = base.trim()
  const sep = b.includes('?') ? '&' : '?'
  return `${b}${sep}ticketId=${encodeURIComponent(ticketId.trim())}`
}

function stringOrEmpty(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined
}

/**
 * GET JSON from `VITE_MAINTENANCE_TICKET_STATUS_URL` with `ticketId` query param.
 * Expected body includes `status` or `phase` or `state`, and optional `detail` / `subtitle` / `message`.
 * Returns `null` when the env URL is unset (UI keeps its default phase).
 */
export async function fetchMaintenanceTicketStatus(input: {
  ticketId: string
  auth?: TicketStatusAuth
}): Promise<MaintenanceTicketStatusResult | null> {
  if (!STATUS_URL?.trim()) return null

  const headers: Record<string, string> = {
    Accept: 'application/json',
  }
  if (input.auth?.accessToken) {
    headers.Authorization = `Bearer ${input.auth.accessToken}`
  }

  const res = await fetch(buildStatusUrl(STATUS_URL, input.ticketId), {
    method: 'GET',
    headers,
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(
      text.trim().length > 0 && text.length < 200
        ? text.trim()
        : `Status request failed (${res.status}).`,
    )
  }

  const ct = res.headers.get('content-type') ?? ''
  if (!ct.includes('application/json')) {
    return { status: 'under_review' }
  }

  const data = (await res.json()) as Record<string, unknown>
  const status =
    stringOrEmpty(data.status) ??
    stringOrEmpty(data.phase) ??
    stringOrEmpty(data.state) ??
    'under_review'

  const detail =
    stringOrEmpty(data.detail) ??
    stringOrEmpty(data.subtitle) ??
    stringOrEmpty(data.eta) ??
    stringOrEmpty(data.message)

  return { status, detail }
}
