import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { emailMayAccessLandlordId } from "../../../shared/admin/landlordAccess.ts"
import { isStaffAdminEmail } from "../../../shared/admin/staffAllowlist.ts"
import { cronBearerMatches } from "../../../shared/security/cronBearer.ts"
import { emailFromAuthUser } from "../../../shared/authUserEmail.ts"
import { adminEdgeCorsHeaders } from "./admin_edge_cors.ts"
import { extractAskUloUserAccessToken } from "./ask_ulo/auth/assertAskUloLandlordAccess.ts"

export type AdminReassignAuthResult =
  | {
    ok: true
    email: string
    userId: string
    platformStaff: boolean
    denyUnless: (
      supabase: SupabaseClient,
      landlordId: string | null | undefined,
    ) => Promise<Response | null>
  }
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

async function authUserFromAccessToken(
  supabaseUrl: string,
  anonKey: string,
  token: string,
): Promise<{ user: Record<string, unknown> | null; error: string | null }> {
  const res = await fetch(`${supabaseUrl.replace(/\/$/, "")}/auth/v1/user`, {
    signal: AbortSignal.timeout(8000),
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: anonKey,
    },
  })
  if (!res.ok) {
    return { user: null, error: `auth ${res.status}` }
  }
  const user = (await res.json()) as Record<string, unknown>
  if (!user || typeof user !== "object" || typeof user.id !== "string") {
    return { user: null, error: "malformed auth user" }
  }
  return { user, error: null }
}

/**
 * Interactive admin Edge auth.
 * A shared secret, the anon key, or a landlord id in the body is not identity.
 * Call denyUnless with the landlord id loaded from the resource row.
 */
export async function requireAdminReassignAuth(
  req: Request,
  logTag: string,
  corsHeaders: Record<string, string> = adminEdgeCorsHeaders,
): Promise<AdminReassignAuthResult> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim() ?? ""
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")?.trim() ?? ""
  if (!supabaseUrl || !anonKey) {
    console.error(`${logTag} missing SUPABASE_URL or SUPABASE_ANON_KEY`)
    return {
      ok: false,
      response: adminJsonResponse({ error: "Server misconfiguration" }, 500, corsHeaders),
    }
  }

  const token = extractAskUloUserAccessToken(req, anonKey)
  if (!token) {
    return {
      ok: false,
      response: adminJsonResponse({ error: "Authorization required" }, 401, corsHeaders),
    }
  }

  const { user, error } = await authUserFromAccessToken(supabaseUrl, anonKey, token)
  if (error || !user) {
    console.warn(`${logTag} session lookup failed`)
    return {
      ok: false,
      response: adminJsonResponse({ error: "Invalid session" }, 401, corsHeaders),
    }
  }

  const email = emailFromAuthUser(
    user as Parameters<typeof emailFromAuthUser>[0],
  ).toLowerCase()
  const userId = typeof user.id === "string" ? user.id : ""
  if (!email || !userId) {
    return {
      ok: false,
      response: adminJsonResponse({ error: "Invalid session" }, 401, corsHeaders),
    }
  }

  const denyUnless = async (
    supabase: SupabaseClient,
    landlordId: string | null | undefined,
  ): Promise<Response | null> => {
    const id = (landlordId ?? "").trim()
    if (!id) {
      return adminJsonResponse({ error: "Forbidden" }, 403, corsHeaders)
    }
    const { data: members, error: memberErr } = await supabase
      .from("landlord_portal_members")
      .select("landlord_id")
      .ilike("email", email)
    if (memberErr) {
      console.warn(`${logTag} portal members lookup`, memberErr.message)
      return adminJsonResponse({ error: "Forbidden" }, 403, corsHeaders)
    }
    const memberLandlordIds = (members ?? [])
      .map((row) =>
        typeof (row as { landlord_id?: unknown }).landlord_id === "string"
          ? String((row as { landlord_id: string }).landlord_id)
          : ""
      )
      .filter(Boolean)
    if (!emailMayAccessLandlordId({ email, landlordId: id, memberLandlordIds })) {
      return adminJsonResponse({ error: "Forbidden" }, 403, corsHeaders)
    }
    return null
  }

  return {
    ok: true,
    email,
    userId,
    platformStaff: isStaffAdminEmail(email),
    denyUnless,
  }
}

/**
 * Bearer auth for cron / automation. Fails closed when no secret is configured.
 * Pass the dedicated cron secret first. Do not treat a browser secret as proof.
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
  return cronBearerMatches(secret, req.headers.get("Authorization"))
}
