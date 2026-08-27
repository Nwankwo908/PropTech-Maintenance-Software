/**
 * Live contractor license lookup via StateLicense.io
 * (GET /v1/verify, POST /v1/search).
 */
export type StateLicenseRecord = {
  state: string | null
  licenseNumber: string | null
  businessName: string | null
  licenseType: string | null
  authority: string | null
  status: string | null
  expirationDate: string | null
}

export type StateLicenseLookup =
  | { ok: true; record: StateLicenseRecord; valid: boolean }
  | { ok: false; reason: "missing_input" | "not_found" | "api_error"; detail: string }

const DEFAULT_BASE = "https://api.statelicense.io"

function apiBase(): string {
  return (Deno.env.get("STATELICENSE_API_BASE") ?? DEFAULT_BASE).replace(/\/$/, "")
}

function apiHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
  }
  const key = Deno.env.get("STATELICENSE_API_KEY")?.trim()
  if (key) {
    headers.Authorization = `Bearer ${key}`
    headers["X-API-Key"] = key
  }
  return headers
}

export function normalizeLicenseState(value: string | null | undefined): string | null {
  const letters = (value ?? "").trim().toUpperCase().replace(/[^A-Z]/g, "")
  if (letters.length < 2) return null
  return letters.slice(0, 2)
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null
  const t = value.trim()
  return t.length > 0 ? t : null
}

export function parseStateLicenseRecord(raw: unknown): StateLicenseRecord | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null
  const row = raw as Record<string, unknown>
  const licenseNumber = asString(row.license_number ?? row.licenseNumber)
  const status = asString(row.status)
  if (!licenseNumber && !status && !asString(row.business_name)) return null
  return {
    state: asString(row.state),
    licenseNumber,
    businessName: asString(row.business_name ?? row.licensee_name),
    licenseType: asString(row.license_type),
    authority: asString(row.authority),
    status,
    expirationDate: asString(row.expiration_date ?? row.expirationDate),
  }
}

export function mapBoardStatus(
  status: string | null,
  expirationDate: string | null,
  valid?: boolean,
): "verified" | "active" | "not_found" | "expired" {
  const today = new Date().toISOString().slice(0, 10)
  if (expirationDate && expirationDate < today) return "expired"
  const normalized = (status ?? "").trim().toLowerCase()
  if (
    normalized.includes("expir") ||
    normalized.includes("inactive") ||
    normalized.includes("revok") ||
    normalized.includes("suspend") ||
    normalized.includes("lapsed")
  ) {
    return "expired"
  }
  if (valid === false && !normalized.includes("active")) return "not_found"
  if (normalized.includes("active") || normalized.includes("current") || valid === true) {
    return "verified"
  }
  return "not_found"
}

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text()
  try {
    return text ? JSON.parse(text) : null
  } catch {
    return null
  }
}

export async function verifyStateLicense(input: {
  state: string
  licenseNumber: string
}): Promise<StateLicenseLookup> {
  const state = normalizeLicenseState(input.state)
  const licenseNumber = input.licenseNumber.trim()
  if (!state || !licenseNumber) {
    return {
      ok: false,
      reason: "missing_input",
      detail: "Enter a two-letter state and license number to check the licensing board.",
    }
  }

  const url = new URL(`${apiBase()}/v1/verify`)
  url.searchParams.set("state", state)
  url.searchParams.set("license_number", licenseNumber)

  try {
    const res = await fetch(url, { headers: apiHeaders() })
    const body = await readJson(res)
    if (!res.ok) {
      console.error("[stateLicenseApi] verify failed", res.status, body)
      return {
        ok: false,
        reason: "api_error",
        detail: "We couldn't reach the state licensing board. Try again in a moment.",
      }
    }
    const root = body && typeof body === "object" ? (body as Record<string, unknown>) : {}
    const record = parseStateLicenseRecord(root.license) ??
      (Array.isArray(root.matches) ? parseStateLicenseRecord(root.matches[0]) : null)
    if (!record) {
      return {
        ok: false,
        reason: "not_found",
        detail: "No match in the state licensing database.",
      }
    }
    return {
      ok: true,
      record,
      valid: root.valid === true,
    }
  } catch (err) {
    console.error("[stateLicenseApi] verify error", err)
    return {
      ok: false,
      reason: "api_error",
      detail: "We couldn't reach the state licensing board. Try again in a moment.",
    }
  }
}

export async function searchStateLicense(input: {
  state?: string | null
  businessName: string
}): Promise<StateLicenseLookup> {
  const businessName = input.businessName.trim()
  if (!businessName) {
    return {
      ok: false,
      reason: "missing_input",
      detail: "Enter a business name to search the licensing board.",
    }
  }
  const state = normalizeLicenseState(input.state)

  try {
    const res = await fetch(`${apiBase()}/v1/search`, {
      method: "POST",
      headers: apiHeaders(),
      body: JSON.stringify({
        state,
        business_name: businessName.slice(0, 128),
        page: 1,
        page_size: 5,
      }),
    })
    const body = await readJson(res)
    if (!res.ok) {
      console.error("[stateLicenseApi] search failed", res.status, body)
      return {
        ok: false,
        reason: "api_error",
        detail: "We couldn't reach the state licensing board. Try again in a moment.",
      }
    }
    const root = body && typeof body === "object" ? (body as Record<string, unknown>) : {}
    const results = Array.isArray(root.results) ? root.results : []
    const records = results
      .map(parseStateLicenseRecord)
      .filter((row): row is StateLicenseRecord => row != null)
    const needle = businessName.toLowerCase()
    const record =
      records.find((row) => (row.businessName ?? "").toLowerCase() === needle) ??
      records.find((row) => (row.status ?? "").toLowerCase().includes("active")) ??
      records[0] ??
      null
    if (!record) {
      return {
        ok: false,
        reason: "not_found",
        detail: "No match in the state licensing database.",
      }
    }
    return { ok: true, record, valid: true }
  } catch (err) {
    console.error("[stateLicenseApi] search error", err)
    return {
      ok: false,
      reason: "api_error",
      detail: "We couldn't reach the state licensing board. Try again in a moment.",
    }
  }
}
