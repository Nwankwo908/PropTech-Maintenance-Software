import { adminEdgeCorsHeaders } from "./admin_edge_cors.ts"
import { adminReassignSecretAuthorized } from "./admin_reassign_auth.ts"

export type AdminReassignAuthResult =
  | { ok: true }
  | { ok: false; response: Response }

function adminJsonResponse(
  body: unknown,
  status: number,
  corsHeaders: Record<string, string>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
}

/**
 * Guard admin dashboard Edge handlers that accept ADMIN_REASSIGN_SECRET via
 * `x-admin-reassign-secret` (or legacy Bearer).
 */
export function requireAdminReassignAuth(
  req: Request,
  logTag: string,
  corsHeaders: Record<string, string> = adminEdgeCorsHeaders,
): AdminReassignAuthResult {
  if (!Deno.env.get("ADMIN_REASSIGN_SECRET")?.trim()) {
    console.error(`${logTag} ADMIN_REASSIGN_SECRET not set`)
    return {
      ok: false,
      response: adminJsonResponse({ error: "Server misconfiguration" }, 500, corsHeaders),
    }
  }

  if (!adminReassignSecretAuthorized(req)) {
    console.warn(`${logTag} 401 Unauthorized: x-admin-reassign-secret mismatch`)
    return {
      ok: false,
      response: adminJsonResponse({ error: "Unauthorized" }, 401, corsHeaders),
    }
  }

  return { ok: true }
}

/**
 * Bearer auth for cron / automation Edge entry points.
 * When no secret env is set, returns true (local dev / unset cron secret).
 */
export function authorizedCronBearer(
  req: Request,
  envKeys: string[],
): boolean {
  let secret: string | undefined
  for (const key of envKeys) {
    const value = Deno.env.get(key)?.trim()
    if (value) {
      secret = value
      break
    }
  }
  if (!secret) return true
  const h = req.headers.get("Authorization")?.trim()
  if (!h?.toLowerCase().startsWith("bearer ")) return false
  return h.slice(7).trim() === secret
}
