import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { adminReassignSecretAuthorized } from "./admin_reassign_auth.ts"
import { bearerLooksLikeJwt } from "./vendor_portal_bearer.ts"
import { getVendorFromPortalApiKey } from "./vendor_portal_api_key.ts"
import type { ProxiedSenderType } from "./sms/proxiedMessaging.ts"

const ADMIN_ALLOWED_EMAILS = new Set(["emeka@ulohome.io", "osi@ulohome.io"])
const ADMIN_DOMAIN = "property-admin.auth.local"

const uuidRe =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function bearerToken(req: Request): string | null {
  const h = req.headers.get("Authorization")?.trim()
  if (!h?.toLowerCase().startsWith("bearer ")) return null
  const t = h.slice(7).trim()
  return t || null
}

function isStaffAdminEmail(email: string | null | undefined): boolean {
  const normalized = (email ?? "").trim().toLowerCase()
  if (!normalized) return false
  if (ADMIN_ALLOWED_EMAILS.has(normalized)) return true
  return normalized.endsWith(`@${ADMIN_DOMAIN}`)
}

export type ProxiedAuthResult =
  | { ok: true }
  | { ok: false; status: number; error: string }

export async function authorizeProxiedMessageSender(
  req: Request,
  supabase: SupabaseClient,
  params: {
    senderType: ProxiedSenderType
    senderId: string
    maintenanceRequestId: string
    assignedVendorId: string | null
    ticketResidentUserId: string | null
    ticketResidentId: string | null
    landlordId: string
  },
): Promise<ProxiedAuthResult> {
  if (!uuidRe.test(params.senderId) && params.senderType !== "system") {
    return { ok: false, status: 400, error: "Invalid sender_id" }
  }

  if (params.senderType === "system") {
    if (!adminReassignSecretAuthorized(req)) {
      return { ok: false, status: 401, error: "Unauthorized" }
    }
    if (params.senderId !== params.landlordId) {
      return { ok: false, status: 403, error: "Forbidden" }
    }
    return { ok: true }
  }

  const token = bearerToken(req)
  if (!token) {
    return { ok: false, status: 401, error: "Authorization required" }
  }

  if (params.senderType === "vendor") {
    if (!params.assignedVendorId || params.senderId !== params.assignedVendorId) {
      return { ok: false, status: 403, error: "Forbidden" }
    }

    if (bearerLooksLikeJwt(token)) {
      const { data: auth, error } = await supabase.auth.getUser(token)
      if (error || !auth?.user?.id) {
        return { ok: false, status: 401, error: "Invalid session" }
      }

      const authUid = auth.user.id
      const authEmail =
        typeof auth.user.email === "string"
          ? auth.user.email.trim().toLowerCase()
          : null

      const { data: byUid } = await supabase
        .from("vendors")
        .select("id")
        .eq("id", params.senderId)
        .eq("auth_user_id", authUid)
        .eq("active", true)
        .maybeSingle()

      if (byUid?.id) return { ok: true }

      if (authEmail) {
        const { data: byEmail } = await supabase
          .from("vendors")
          .select("id, auth_user_id")
          .eq("id", params.senderId)
          .ilike("email", authEmail)
          .eq("active", true)
          .maybeSingle()

        if (byEmail?.id) {
          if (byEmail.auth_user_id && byEmail.auth_user_id !== authUid) {
            return { ok: false, status: 403, error: "Forbidden" }
          }
          return { ok: true }
        }
      }

      return { ok: false, status: 403, error: "Forbidden" }
    }

    const vendor = await getVendorFromPortalApiKey(supabase, token)
    if (!vendor || vendor.id !== params.senderId) {
      return { ok: false, status: 403, error: "Forbidden" }
    }
    return { ok: true }
  }

  if (params.senderType === "resident") {
    if (!bearerLooksLikeJwt(token)) {
      return { ok: false, status: 401, error: "Resident session required" }
    }

    const { data: auth, error } = await supabase.auth.getUser(token)
    if (error || !auth?.user?.id) {
      return { ok: false, status: 401, error: "Invalid session" }
    }

    if (
      params.ticketResidentUserId &&
      params.ticketResidentUserId !== auth.user.id
    ) {
      return { ok: false, status: 403, error: "Forbidden" }
    }

    if (params.ticketResidentId && params.senderId !== params.ticketResidentId) {
      return { ok: false, status: 403, error: "Forbidden" }
    }

    const { data: residentRow } = await supabase
      .from("users")
      .select("id, supabase_user_id")
      .eq("id", params.senderId)
      .maybeSingle()

    if (!residentRow?.id) {
      return { ok: false, status: 403, error: "Forbidden" }
    }

    if (
      residentRow.supabase_user_id &&
      residentRow.supabase_user_id !== auth.user.id
    ) {
      return { ok: false, status: 403, error: "Forbidden" }
    }

    return { ok: true }
  }

  if (params.senderType === "landlord") {
    if (params.senderId !== params.landlordId) {
      return { ok: false, status: 403, error: "Forbidden" }
    }

    if (adminReassignSecretAuthorized(req)) {
      return { ok: true }
    }

    if (!bearerLooksLikeJwt(token)) {
      return { ok: false, status: 401, error: "Unauthorized" }
    }

    const { data: auth, error } = await supabase.auth.getUser(token)
    if (error || !auth?.user?.email) {
      return { ok: false, status: 401, error: "Invalid session" }
    }

    if (!isStaffAdminEmail(auth.user.email)) {
      return { ok: false, status: 403, error: "Forbidden" }
    }

    return { ok: true }
  }

  return { ok: false, status: 400, error: "Invalid sender_type" }
}
