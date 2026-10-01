/**
 * Ask Ulo landlord authorization: JWT + email may use requested landlord_id.
 * Shared secret alone is never proof of landlord scope.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { emailFromAuthUser } from "../../../../../shared/authUserEmail.ts"
import {
  canonicalizeLandlordId,
  emailMayAccessLandlordId,
} from "../../../../../shared/admin/landlordAccess.ts"

export type AskUloAuthUser = {
  id: string
  email: string
}

export type AskUloLandlordAccessOk = {
  ok: true
  user: AskUloAuthUser
  landlordId: string
}

export type AskUloLandlordAccessDenied = {
  ok: false
  status: 401 | 403
  error: string
}

function bearerToken(req: Request): string | null {
  const h = req.headers.get("Authorization")?.trim()
  if (!h?.toLowerCase().startsWith("bearer ")) return null
  const t = h.slice(7).trim()
  return t || null
}

function jwtPayloadRole(token: string): string {
  const parts = token.split(".")
  if (parts.length !== 3) return ""
  try {
    const json = atob(parts[1].replace(/-/g, "+").replace(/_/g, "/"))
    const payload = JSON.parse(json) as { role?: unknown }
    return typeof payload.role === "string" ? payload.role.trim().toLowerCase() : ""
  } catch {
    return ""
  }
}

/** User access JWT only — skip anon/publishable keys that supabase-js puts on Authorization. */
export function extractAskUloUserAccessToken(
  req: Request,
  anonKey: string,
): string | null {
  const candidates = [
    req.headers.get("x-ulo-access-token")?.trim() ?? "",
    bearerToken(req) ?? "",
  ]
  for (const token of candidates) {
    if (!token || token === anonKey) continue
    if (token.startsWith("sb_")) continue
    if (jwtPayloadRole(token) === "anon") continue
    return token
  }
  return null
}

async function authUserFromAccessToken(
  supabaseUrl: string,
  anonKey: string,
  token: string,
): Promise<{ user: Record<string, unknown> | null; error: string | null }> {
  const res = await fetch(`${supabaseUrl.replace(/\/$/, "")}/auth/v1/user`, {
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: anonKey,
    },
  })
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 240)
    return { user: null, error: detail || `auth ${res.status}` }
  }
  const user = (await res.json()) as Record<string, unknown>
  if (!user || typeof user !== "object" || typeof user.id !== "string") {
    return { user: null, error: "malformed auth user" }
  }
  return { user, error: null }
}

/**
 * Resolve session + assert the signed-in admin may use landlordId.
 * Call before any portfolio tool reads.
 */
export async function assertAskUloLandlordAccess(input: {
  req: Request
  supabase: SupabaseClient
  supabaseUrl: string
  anonKey: string
  landlordId: string
}): Promise<AskUloLandlordAccessOk | AskUloLandlordAccessDenied> {
  const landlordId = canonicalizeLandlordId(input.landlordId.trim())
  if (!landlordId) {
    return { ok: false, status: 403, error: "Forbidden" }
  }

  const token = extractAskUloUserAccessToken(input.req, input.anonKey)
  if (!token) {
    return { ok: false, status: 401, error: "Authorization required" }
  }

  const { user, error } = await authUserFromAccessToken(
    input.supabaseUrl,
    input.anonKey,
    token,
  )
  if (error || !user) {
    console.warn("[ask-ulo] auth user lookup failed", error ?? "no user")
    return { ok: false, status: 401, error: "Invalid session" }
  }

  const email = emailFromAuthUser(
    user as Parameters<typeof emailFromAuthUser>[0],
  ).toLowerCase()
  if (!email) {
    return { ok: false, status: 401, error: "Invalid session" }
  }

  const userId = typeof user.id === "string" ? user.id : ""
  if (!userId) {
    return { ok: false, status: 401, error: "Invalid session" }
  }

  const { data: members, error: memberErr } = await input.supabase
    .from("landlord_portal_members")
    .select("landlord_id")
    .eq("email", email)

  if (memberErr) {
    console.warn("[ask-ulo] portal members lookup", memberErr.message)
  }

  const memberLandlordIds = (members ?? [])
    .map((row) =>
      typeof (row as { landlord_id?: unknown }).landlord_id === "string"
        ? String((row as { landlord_id: string }).landlord_id)
        : "",
    )
    .filter(Boolean)

  if (
    !emailMayAccessLandlordId({
      email,
      landlordId,
      memberLandlordIds,
    })
  ) {
    return { ok: false, status: 403, error: "Forbidden" }
  }

  return {
    ok: true,
    user: { id: userId, email },
    landlordId,
  }
}

/** Pure helper for unit tests (no network). */
export function decideAskUloLandlordAccess(input: {
  email: string | null | undefined
  landlordId: string
  memberLandlordIds?: readonly string[]
}): boolean {
  return emailMayAccessLandlordId(input)
}
