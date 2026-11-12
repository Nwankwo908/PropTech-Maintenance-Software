/** Account authorization for the reviewed F08 admin entry points. */
type Runtime = {
  env: (name: string) => string | undefined
  fetch: typeof fetch
}

type AuthRecord = Record<string, unknown>

function record(value: unknown): AuthRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as AuthRecord
    : null
}

function normalizedEmail(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : ""
}

/** Decode claims only AFTER GoTrue has validated this exact access token. */
function verifiedClaims(token: string): AuthRecord | null {
  try {
    const parts = token.split(".")
    if (parts.length !== 3) return null
    const bytes = Uint8Array.from(
      atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")),
      (character) => character.charCodeAt(0),
    )
    return record(JSON.parse(new TextDecoder().decode(bytes)))
  } catch {
    return null
  }
}

export async function authorizeAdminAccount(
  request: Request,
  landlordId: string,
  corsHeaders: Record<string, string>,
  runtime: Runtime = { env: (name) => Deno.env.get(name), fetch },
): Promise<Response | null> {
  const deny = (error: string, status: number) =>
    new Response(JSON.stringify({ error }), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  const url = runtime.env("SUPABASE_URL")?.trim().replace(/\/$/, "")
  const anonKey = runtime.env("SUPABASE_ANON_KEY")?.trim()
  const serviceKey = runtime.env("SUPABASE_SERVICE_ROLE_KEY")?.trim()
  if (!url || !anonKey || !serviceKey) {
    return deny("Authorization temporarily unavailable", 503)
  }

  // An explicitly supplied user-token header takes precedence, including when
  // invalid. Neither a browser secret nor a project API key is a user identity.
  const explicit = request.headers.get("x-ulo-access-token")
  const bearer = /^Bearer\s+(\S+)$/i.exec(
    request.headers.get("Authorization")?.trim() ?? "",
  )?.[1]
  const token = explicit !== null ? explicit.trim() : bearer ?? ""
  if (!token || /\s/.test(token) || token === anonKey || token === serviceKey || token.startsWith("sb_")) {
    return deny("Sign in to perform this action", 401)
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(landlordId)) {
    return deny("Forbidden", 403)
  }

  const authHeaders = { apikey: anonKey, Authorization: `Bearer ${token}` }
  const get = (path: string, headers: Record<string, string>, method = "GET", body?: string) =>
    runtime.fetch(`${url}${path}`, {
      method,
      headers,
      body,
      signal: AbortSignal.timeout(8000),
      redirect: "error",
    })
  try {
    const response = await get("/auth/v1/user", authHeaders)
    if (!response.ok) {
      await response.body?.cancel()
      return deny(
        response.status === 401 || response.status === 403
          ? "Invalid or expired session"
          : "Authorization temporarily unavailable",
        response.status === 401 || response.status === 403 ? 401 : 503,
      )
    }
    const user = record(await response.json())
    const claims = verifiedClaims(token)
    const email = normalizedEmail(user?.email)
    if (!user || typeof user.id !== "string" || !email || user.is_anonymous === true ||
      !user.email_confirmed_at || !claims || claims.sub !== user.id ||
      normalizedEmail(claims.email) !== email || claims.role !== "authenticated") {
      return deny("Invalid or expired session", 401)
    }

    // Old access tokens must not authorize a banned/deleted account. The live
    // admin record also catches an email change racing the session lookup.
    const statusResponse = await get(`/auth/v1/admin/users/${encodeURIComponent(user.id)}`, {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
    })
    if (!statusResponse.ok) {
      await statusResponse.body?.cancel()
      return deny("Account access unavailable", statusResponse.status === 404 ? 403 : 503)
    }
    const body = record(await statusResponse.json())
    const account = record(body?.user) ?? body
    if (!account || account.id !== user.id || normalizedEmail(account.email) !== email) {
      return deny("Account access unavailable", 403)
    }
    const banned = account.banned_until
    if (account.deleted_at || (banned != null && banned !== "" &&
      (typeof banned !== "string" || !Number.isFinite(Date.parse(banned)) || Date.parse(banned) > Date.now()))) {
      return deny("Account access unavailable", 403)
    }

    // Use the CALLER'S JWT, never the service role, for database authority.
    // Do not reproduce membership rules with wildcard email matching or trust
    // user_metadata. The existing RPC checks current memberships and scope.
    const accessResponse = await get("/rest/v1/rpc/can_access_landlord", {
      ...authHeaders,
      "Content-Type": "application/json",
    }, "POST", JSON.stringify({ p_landlord_id: landlordId }))
    if (!accessResponse.ok) {
      await accessResponse.body?.cancel()
      return deny("Authorization temporarily unavailable", 503)
    }
    const access: unknown = await accessResponse.json()
    if (access === false) return deny("Forbidden", 403)
    return access === true ? null : deny("Authorization temporarily unavailable", 503)
  } catch {
    // No token, credential, remote error body, or customer data is logged.
    return deny("Authorization temporarily unavailable", 503)
  }
}
