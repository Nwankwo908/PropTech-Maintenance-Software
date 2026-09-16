/** Demand-side Connect scopes Thumbtack listed for the authorization_code client. */
export const THUMBTACK_AUTH_CODE_SCOPES = [
  "demand::negotiations.read",
  "demand::messages.write",
  "demand::messages.read",
  "offline_access",
] as const

/** Nested write scope — Thumbtack returns invalid_scope if we request it. */
const THUMBTACK_UNGRANTED_SCOPES = new Set([
  "demand::negotiations/messages.write",
])

export const THUMBTACK_OAUTH_AUDIENCE = "urn:partner-api"

export const DEFAULT_THUMBTACK_AUTH_URL = "https://auth.thumbtack.com/oauth2/auth"
export const DEFAULT_THUMBTACK_TOKEN_URL = "https://auth.thumbtack.com/oauth2/token"

/** Exact redirect registered on the production Message API app. */
export const THUMBTACK_REGISTERED_REDIRECT_URI = "https://www.ulohome.io/"

const PARTNER_CLIENT_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isThumbtackPartnerClientId(value: string): boolean {
  return PARTNER_CLIENT_ID_RE.test(value.trim())
}

/** Log OAuth diagnostics without secrets or full tokens. */
export function thumbtackOauthLogSafe(details: {
  clientId?: string | null
  searchClientId?: string | null
  redirectUri?: string | null
  tokenUrl?: string | null
  authUrl?: string | null
  status?: number | null
  body?: string | null
  hasRefreshToken?: boolean
  hasAccessToken?: boolean
  saved?: boolean
}): Record<string, unknown> {
  const clientId = (details.clientId ?? "").trim()
  const searchId = (details.searchClientId ?? "").trim()
  const body = (details.body ?? "").slice(0, 400)
  let error: string | null = null
  let errorDescription: string | null = null
  try {
    const parsed = JSON.parse(body) as { error?: unknown; error_description?: unknown }
    if (typeof parsed.error === "string") error = parsed.error
    if (typeof parsed.error_description === "string") errorDescription = parsed.error_description
  } catch {
    /* not JSON */
  }
  const fromLocation = /^(https?:\/\/|\/)/i.test(body)
    ? parseThumbtackAuthorizeRedirect(body)
    : { error: null, errorDescription: null }
  return {
    client_id_prefix: clientId.slice(0, 8) || null,
    client_id_valid: clientId ? isThumbtackPartnerClientId(clientId) : false,
    distinct_from_search: Boolean(clientId && searchId && clientId !== searchId),
    redirect_uri: details.redirectUri ?? null,
    token_url: details.tokenUrl ?? null,
    auth_url: details.authUrl ?? null,
    status: details.status ?? null,
    error: error || fromLocation.error,
    error_description: errorDescription || fromLocation.errorDescription,
    body_preview: body.replace(/client_secret=[^&\s]+/gi, "client_secret=redacted"),
    has_refresh_token: details.hasRefreshToken ?? false,
    has_access_token: details.hasAccessToken ?? false,
    saved: details.saved ?? false,
  }
}

export function normalizeThumbtackRedirectUri(raw?: string | null): string {
  const t = (raw ?? "").trim()
  if (!t) return THUMBTACK_REGISTERED_REDIRECT_URI
  try {
    const url = new URL(t)
    if (url.pathname === "" || url.pathname === "/") {
      return `${url.origin}/`
    }
    return t
  } catch {
    return THUMBTACK_REGISTERED_REDIRECT_URI
  }
}

/** Parse Thumbtack's authorize Location (login vs oauth/error). */
export function parseThumbtackAuthorizeRedirect(location: string): {
  ok: boolean
  path: string
  error: string | null
  errorDescription: string | null
} {
  const loc = location.trim()
  if (!loc) {
    return { ok: false, path: "", error: null, errorDescription: null }
  }
  try {
    const url = new URL(loc, DEFAULT_THUMBTACK_AUTH_URL)
    const path = url.pathname
    const error = url.searchParams.get("error")
    const errorDescription = url.searchParams.get("error_description")
    const errorPage =
      /\/oauth\/error/i.test(path) || /\/oauth2\/fallbacks\/error/i.test(path)
    const connectPage = /\/oauth\/connect/i.test(path)
    return {
      ok: !error && !errorPage && (connectPage || !/error/i.test(path)),
      path,
      error,
      errorDescription,
    }
  } catch {
    return { ok: false, path: loc.slice(0, 80), error: null, errorDescription: null }
  }
}

export function pickThumbtackOAuthTokens(json: Record<string, unknown> | null): {
  refreshToken: string
  accessToken: string
  expiresIn: number | null
  scope: string | null
} {
  const empty = { refreshToken: "", accessToken: "", expiresIn: null as number | null, scope: null as string | null }
  if (!json) return empty
  const nested = json.data && typeof json.data === "object" && !Array.isArray(json.data)
    ? json.data as Record<string, unknown>
    : null
  const pick = (keys: string[]): string => {
    for (const row of [json, nested]) {
      if (!row) continue
      for (const key of keys) {
        const value = row[key]
        if (typeof value === "string" && value.trim()) return value.trim()
      }
    }
    return ""
  }
  const pickNum = (keys: string[]): number | null => {
    for (const row of [json, nested]) {
      if (!row) continue
      for (const key of keys) {
        const value = row[key]
        if (typeof value === "number" && Number.isFinite(value)) return value
      }
    }
    return null
  }
  return {
    refreshToken: pick(["refresh_token", "refreshToken"]),
    accessToken: pick(["access_token", "accessToken"]),
    expiresIn: pickNum(["expires_in", "expiresIn"]),
    scope: pick(["scope"]) || null,
  }
}

export function thumbtackAuthCodeScope(
  extra?: string | null,
): string {
  const allowed = new Set<string>(THUMBTACK_AUTH_CODE_SCOPES)
  const parts = new Set<string>(THUMBTACK_AUTH_CODE_SCOPES)
  for (const token of (extra ?? "").split(/\s+/)) {
    if (token && allowed.has(token)) parts.add(token)
  }
  for (const denied of THUMBTACK_UNGRANTED_SCOPES) parts.delete(denied)
  return [...parts].join(" ")
}

export function buildThumbtackAuthorizeUrl(input: {
  clientId: string
  redirectUri: string
  state: string
  scope?: string | null
  authUrl?: string | null
}): string {
  const authUrl = (input.authUrl ?? "").trim() || DEFAULT_THUMBTACK_AUTH_URL
  const url = new URL(authUrl)
  url.searchParams.set("client_id", input.clientId.trim())
  url.searchParams.set("redirect_uri", input.redirectUri.trim())
  url.searchParams.set("response_type", "code")
  url.searchParams.set("state", input.state.trim())
  url.searchParams.set("audience", THUMBTACK_OAUTH_AUDIENCE)
  url.searchParams.set("scope", thumbtackAuthCodeScope(input.scope))
  return url.toString()
}

/** Search client_credentials must never be used for requests / messages. */
export function thumbtackAuthorizationCodeClient(input: {
  messagingClientId?: string | null
  messagingClientSecret?: string | null
}): { clientId: string; clientSecret: string } | null {
  const clientId = input.messagingClientId?.trim() ?? ""
  const clientSecret = input.messagingClientSecret?.trim() ?? ""
  if (!clientId || !clientSecret || !isThumbtackPartnerClientId(clientId)) return null
  return { clientId, clientSecret }
}
