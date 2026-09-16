/**
 * Thumbtack authorization_code connect (requests + messaging).
 * Search stays on client_credentials. This app is the messaging client.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { serve } from "https://deno.land/std/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { adminEdgeCorsHeaders } from "../_shared/admin_edge_cors.ts"
import { requireAdminReassignAuth } from "../_shared/admin_edge_auth.ts"
import { isUuidShape } from "../_shared/uuid_shape.ts"
import { uloAppUrl } from "../_shared/uloAppUrl.ts"
import { recordActivityLog } from "../_shared/graph/recordActivityLog.ts"
import {
  buildThumbtackAuthorizeUrl,
  DEFAULT_THUMBTACK_AUTH_URL,
  DEFAULT_THUMBTACK_TOKEN_URL,
  THUMBTACK_OAUTH_AUDIENCE,
  thumbtackAuthorizationCodeClient,
  thumbtackOauthLogSafe,
  parseThumbtackAuthorizeRedirect,
  pickThumbtackOAuthTokens,
  normalizeThumbtackRedirectUri,
} from "../_shared/external_vendor/thumbtackOauth.ts"
import {
  landlordThumbtackIsConnected,
  saveLandlordThumbtackRefreshToken,
} from "../_shared/external_vendor/thumbtackOauthStore.ts"

const corsHeaders = adminEdgeCorsHeaders

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
}

function messagingClient(): { id: string; secret: string } {
  const creds = thumbtackAuthorizationCodeClient({
    messagingClientId: Deno.env.get("THUMBTACK_MESSAGING_CLIENT_ID"),
    messagingClientSecret: Deno.env.get("THUMBTACK_MESSAGING_CLIENT_SECRET"),
  })
  return { id: creds?.clientId ?? "", secret: creds?.clientSecret ?? "" }
}

function redirectUri(): string {
  return normalizeThumbtackRedirectUri(Deno.env.get("THUMBTACK_OAUTH_REDIRECT_URI"))
}

function isAllowedOauthReturnOrigin(origin: string): boolean {
  try {
    const url = new URL(origin)
    if (url.protocol !== "http:" && url.protocol !== "https:") return false
    const host = url.hostname.toLowerCase()
    if (host === "localhost" || host === "127.0.0.1") return true
    return host === "ulohome.io" || host.endsWith(".ulohome.io")
  } catch {
    return false
  }
}

function oauthReturnDestination(input: {
  returnPath?: string
  returnOrigin?: string
}): string {
  const path =
    typeof input.returnPath === "string" && input.returnPath.startsWith("/")
      ? input.returnPath
      : "/admin"
  const origin = (input.returnOrigin ?? "").trim().replace(/\/$/, "")
  if (origin && isAllowedOauthReturnOrigin(origin)) return `${origin}${path}`
  return path
}

function withThumbtackFlag(dest: string, value: "connected" | "error"): string {
  if (/[?&]thumbtack=/.test(dest)) return dest
  const join = dest.includes("?") ? "&" : "?"
  return `${dest}${join}thumbtack=${value}`
}

async function thumbtackAuthorizeClientIsKnown(authorizeUrl: string): Promise<{
  ok: boolean
  status: number
  location: string
  error: string | null
  errorDescription: string | null
}> {
  try {
    const res = await fetch(authorizeUrl, { method: "GET", redirect: "manual" })
    const location = res.headers.get("location") ?? res.url
    const parsed = parseThumbtackAuthorizeRedirect(location)
    console.warn("[thumbtack-oauth] authorize probe", JSON.stringify({
      status: res.status,
      location: location.slice(0, 240),
      ok: parsed.ok,
      error: parsed.error,
      error_description: parsed.errorDescription,
      path: parsed.path,
    }))
    return {
      ok: parsed.ok,
      status: res.status,
      location: location.slice(0, 240),
      error: parsed.error,
      errorDescription: parsed.errorDescription,
    }
  } catch (err) {
    console.warn("[thumbtack-oauth] authorize probe failed", err)
    return { ok: true, status: 0, location: "", error: null, errorDescription: null }
  }
}

async function exchangeThumbtackCode(
  supabase: SupabaseClient,
  input: { code: string; state: string },
): Promise<{ ok: true; returnPath: string } | { ok: false; error: string }> {
  const code = input.code.trim()
  const state = input.state.trim()
  if (!code || state.length < 8) {
    return { ok: false, error: "Missing code or state." }
  }
  const { data: row, error: stateErr } = await supabase
    .from("thumbtack_oauth_states")
    .select("landlord_id, return_path, expires_at")
    .eq("state", state)
    .maybeSingle()
  if (stateErr || !row) {
    return { ok: false, error: "This Thumbtack sign-in expired. Try Connect Thumbtack again." }
  }
  if (new Date(String(row.expires_at)).getTime() < Date.now()) {
    await supabase.from("thumbtack_oauth_states").delete().eq("state", state)
    return { ok: false, error: "This Thumbtack sign-in expired. Try Connect Thumbtack again." }
  }
  const landlordId = String(row.landlord_id)
  const { id: clientId, secret: clientSecret } = messagingClient()
  if (!clientId || !clientSecret) {
    console.error(
      "[thumbtack-oauth] token exchange missing messaging client",
      JSON.stringify(thumbtackOauthLogSafe({
        clientId: Deno.env.get("THUMBTACK_MESSAGING_CLIENT_ID"),
        searchClientId: Deno.env.get("THUMBTACK_CLIENT_ID"),
        redirectUri: redirectUri(),
      })),
    )
    return { ok: false, error: "Thumbtack messaging OAuth is not configured." }
  }
  const tokenUrl =
    Deno.env.get("THUMBTACK_MESSAGING_TOKEN_URL")?.trim() ||
    Deno.env.get("THUMBTACK_TOKEN_URL")?.trim() ||
    DEFAULT_THUMBTACK_TOKEN_URL
  const form = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri(),
    audience: THUMBTACK_OAUTH_AUDIENCE,
  })
  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: form,
  })
  const text = await res.text().catch(() => "")
  let json: Record<string, unknown> | null = null
  try {
    json = text ? JSON.parse(text) as Record<string, unknown> : null
  } catch {
    json = null
  }
  const tokens = pickThumbtackOAuthTokens(json)
  const refresh = tokens.refreshToken
  const accessToken = tokens.accessToken
  console.warn(
    "[thumbtack-oauth] token exchange",
    JSON.stringify(thumbtackOauthLogSafe({
      clientId,
      searchClientId: Deno.env.get("THUMBTACK_CLIENT_ID"),
      redirectUri: redirectUri(),
      tokenUrl,
      status: res.status,
      body: text,
      hasRefreshToken: Boolean(refresh),
      hasAccessToken: Boolean(accessToken),
    })),
  )
  if (!res.ok) {
    return { ok: false, error: "Thumbtack did not finish sign-in. Try Connect Thumbtack again." }
  }
  if (!refresh) {
    return {
      ok: false,
      error:
        "Thumbtack signed in but did not return a refresh token. Ask Thumbtack to include offline_access on the Message API app.",
    }
  }
  const saved = await saveLandlordThumbtackRefreshToken(supabase, landlordId, refresh, {
    scope: tokens.scope,
    accessToken,
    expiresInSec: tokens.expiresIn,
  })
  console.warn(
    "[thumbtack-oauth] persist tokens",
    JSON.stringify({
      landlord_id: landlordId,
      saved: saved.ok,
      save_error: saved.error ?? null,
      has_refresh_token: true,
      has_access_token: Boolean(accessToken),
    }),
  )
  if (!saved.ok) {
    return { ok: false, error: "Could not save the Thumbtack connection. Try Connect Thumbtack again." }
  }
  await supabase.from("thumbtack_oauth_states").delete().eq("state", state)
  void recordActivityLog(supabase, {
    landlordId,
    eventType: "vendor.thumbtack_connected",
    source: "dashboard",
    actorType: "landlord",
    metadata: { message: "Connected Thumbtack for in-app vendor messaging." },
  })
  const stored = typeof row.return_path === "string" ? row.return_path.trim() : ""
  const returnPath =
    stored.startsWith("/") || stored.startsWith("http://") || stored.startsWith("https://")
      ? stored
      : "/admin"
  return { ok: true, returnPath }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim()
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim()
  if (!supabaseUrl || !serviceKey) {
    return jsonResponse(
      { error: "Server misconfiguration: missing Supabase credentials" },
      500,
    )
  }
  const supabase = createClient(supabaseUrl, serviceKey)

  const incoming = new URL(req.url)
  if (req.method === "GET" && incoming.searchParams.get("code") && incoming.searchParams.get("state")) {
    const result = await exchangeThumbtackCode(supabase, {
      code: incoming.searchParams.get("code") ?? "",
      state: incoming.searchParams.get("state") ?? "",
    })
    if (!result.ok) {
      console.warn("[thumbtack-oauth] callback failed", result.error)
      return Response.redirect(withThumbtackFlag(uloAppUrl.admin(), "error"), 302)
    }
    const dest = result.returnPath.startsWith("http")
      ? result.returnPath
      : uloAppUrl.absolute(result.returnPath)
    return Response.redirect(withThumbtackFlag(dest, "connected"), 302)
  }

  const adminAuth = requireAdminReassignAuth(req, "[thumbtack-oauth]", corsHeaders)
  if (!adminAuth.ok) return adminAuth.response

  if (req.method === "GET") {
    const landlordId = new URL(req.url).searchParams.get("landlordId")?.trim() ?? ""
    if (!landlordId || !isUuidShape(landlordId)) {
      return jsonResponse({ error: "Missing or invalid landlordId" }, 400)
    }
    const connected = await landlordThumbtackIsConnected(supabase, landlordId)
    const { id: clientId, secret: clientSecret } = messagingClient()
    return jsonResponse({
      connected,
      messagingClientReady: Boolean(clientId && clientSecret && isUuidShape(clientId)),
    })
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405)
  }

  let body: {
    action?: string
    landlordId?: string
    returnOrigin?: string
    returnPath?: string
    code?: string
    state?: string
  }
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: "Expected JSON body" }, 400)
  }

  const action = (body.action ?? "").trim()
  if (action === "start") {
    const landlordId = body.landlordId?.trim() ?? ""
    if (!landlordId || !isUuidShape(landlordId)) {
      return jsonResponse({ error: "Missing or invalid landlordId" }, 400)
    }
    const { id: clientId, secret: clientSecret } = messagingClient()
    if (!clientId || !clientSecret) {
      console.error(
        "[thumbtack-oauth] start missing messaging client",
        JSON.stringify(thumbtackOauthLogSafe({
          clientId: Deno.env.get("THUMBTACK_MESSAGING_CLIENT_ID"),
          searchClientId: Deno.env.get("THUMBTACK_CLIENT_ID"),
          redirectUri: redirectUri(),
        })),
      )
      return jsonResponse({
        error:
          "Thumbtack in-app messaging needs a valid Message API client id (THUMBTACK_MESSAGING_CLIENT_ID). The search client cannot be used here.",
      }, 500)
    }
    const state = crypto.randomUUID()
    const expires = new Date(Date.now() + 20 * 60 * 1000).toISOString()
    const returnPath = oauthReturnDestination({
      returnPath: body.returnPath,
      returnOrigin: body.returnOrigin,
    })
    const { error } = await supabase.from("thumbtack_oauth_states").insert({
      state,
      landlord_id: landlordId,
      return_path: returnPath,
      expires_at: expires,
    })
    if (error) {
      return jsonResponse({ error: "Could not start Thumbtack sign-in." }, 500)
    }
    const authorizeUrl = buildThumbtackAuthorizeUrl({
      clientId,
      redirectUri: redirectUri(),
      state,
      scope: Deno.env.get("THUMBTACK_MESSAGING_OAUTH_SCOPE"),
      authUrl: Deno.env.get("THUMBTACK_AUTH_URL")?.trim() || DEFAULT_THUMBTACK_AUTH_URL,
    })
    const probe = await thumbtackAuthorizeClientIsKnown(authorizeUrl)
    if (!probe.ok) {
      await supabase.from("thumbtack_oauth_states").delete().eq("state", state)
      console.error(
        "[thumbtack-oauth] start rejected by Thumbtack",
        JSON.stringify(thumbtackOauthLogSafe({
          clientId,
          searchClientId: Deno.env.get("THUMBTACK_CLIENT_ID"),
          redirectUri: redirectUri(),
          authUrl: Deno.env.get("THUMBTACK_AUTH_URL")?.trim() || DEFAULT_THUMBTACK_AUTH_URL,
          status: probe.status,
          body: probe.location,
        })),
      )
      const mismatch = /redirect_uri/i.test(probe.errorDescription ?? "")
      return jsonResponse({
        error: mismatch
          ? `Thumbtack does not have this redirect URI registered: ${redirectUri()}`
          : probe.errorDescription
            ? `Thumbtack rejected Connect (${probe.error}): ${probe.errorDescription}`
            : "Thumbtack did not recognize the Message API app, so Ulo stayed here. Confirm THUMBTACK_MESSAGING_CLIENT_ID with Thumbtack, then try again.",
      }, 500)
    }
    console.warn(
      "[thumbtack-oauth] start ok",
      JSON.stringify(thumbtackOauthLogSafe({
        clientId,
        searchClientId: Deno.env.get("THUMBTACK_CLIENT_ID"),
        redirectUri: redirectUri(),
        authUrl: Deno.env.get("THUMBTACK_AUTH_URL")?.trim() || DEFAULT_THUMBTACK_AUTH_URL,
        status: probe.status,
      })),
    )
    return jsonResponse({ authorizeUrl })
  }

  if (action === "exchange") {
    const result = await exchangeThumbtackCode(supabase, {
      code: body.code ?? "",
      state: body.state ?? "",
    })
    if (!result.ok) {
      return jsonResponse({ error: result.error }, 400)
    }
    return jsonResponse({ ok: true, returnPath: result.returnPath })
  }

  return jsonResponse({ error: "Unknown action" }, 400)
})
