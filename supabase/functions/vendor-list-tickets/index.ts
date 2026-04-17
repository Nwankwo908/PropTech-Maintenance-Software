import { serve } from "https://deno.land/std/http/server.ts"
import {
  createClient,
  type SupabaseClient,
} from "https://esm.sh/@supabase/supabase-js@2.49.1"
import {
  bearerLooksLikeJwt,
  PORTAL_API_KEY_UUID_RE,
} from "../_shared/vendor_portal_bearer.ts"

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
}

function failReason(reason: string) {
  console.log("[vendor-list-tickets] FAIL reason:", reason)
}

function bearerKey(req: Request): string | null {
  const h = req.headers.get("Authorization")?.trim()
  if (!h?.toLowerCase().startsWith("bearer ")) return null
  const t = h.slice(7).trim()
  return t || null
}

const SIGNED_URL_TTL_SEC = 3600

/** Signed GET URLs for `maintenance-uploads` paths (private bucket). */
async function photoSignedUrls(
  supabase: SupabaseClient,
  paths: unknown,
): Promise<string[]> {
  if (!Array.isArray(paths) || paths.length === 0) return []
  const urls: string[] = []
  for (const p of paths) {
    if (typeof p !== "string" || !p.trim()) continue
    const { data, error } = await supabase.storage
      .from("maintenance-uploads")
      .createSignedUrl(p.trim(), SIGNED_URL_TTL_SEC)
    if (error) {
      console.error("[vendor-list-tickets] signed url", p, error)
      continue
    }
    if (data?.signedUrl) urls.push(data.signedUrl)
  }
  return urls
}

serve(async (req) => {
  console.log("SUPABASE CLIENT TYPE:", !!Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"))
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  if (req.method !== "GET") {
    return jsonResponse({ error: "Method not allowed" }, 405)
  }

  const accessToken = bearerKey(req)
  if (!accessToken) {
    return jsonResponse({ error: "Missing Authorization: Bearer <access_token>" }, 401)
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

  let vendor: { id: string; name: string } | null = null

  if (bearerLooksLikeJwt(accessToken)) {
    const { data: auth, error: authErr } = await supabase.auth.getUser(accessToken)
    if (authErr || !auth?.user?.id) {
      console.error("[vendor-list-tickets] auth.getUser", authErr)
      return jsonResponse({ error: "Invalid or expired JWT" }, 401)
    }

    const authUid = auth.user.id
    const authEmail =
      typeof auth.user.email === "string" ? auth.user.email.trim().toLowerCase() : null

    let jwtVendor: { id: string; name: string; auth_user_id: string | null } | null = null

    const { data: byUid, error: byUidErr } = await supabase
      .from("vendors")
      .select("id, name, auth_user_id")
      .eq("auth_user_id", authUid)
      .eq("active", true)
      .maybeSingle()

    if (byUidErr) {
      console.error("[vendor-list-tickets] vendor lookup by auth_user_id", byUidErr)
      return jsonResponse({ error: "Lookup failed" }, 500)
    }
    if (byUid) {
      jwtVendor = byUid
    } else if (authEmail) {
      const { data: byEmail, error: byEmailErr } = await supabase
        .from("vendors")
        .select("id, name, auth_user_id")
        .ilike("email", authEmail)
        .eq("active", true)
        .maybeSingle()

      if (byEmailErr) {
        console.error("[vendor-list-tickets] vendor lookup by email", byEmailErr)
        return jsonResponse({ error: "Lookup failed" }, 500)
      }

      if (byEmail) {
        if (byEmail.auth_user_id && byEmail.auth_user_id !== authUid) {
          failReason("jwt email vendor mismatch")
          return jsonResponse({ error: "Forbidden" }, 403)
        }
        if (!byEmail.auth_user_id) {
          const { data: linked, error: linkErr } = await supabase
            .from("vendors")
            .update({ auth_user_id: authUid })
            .eq("id", byEmail.id)
            .is("auth_user_id", null)
            .select("id, name, auth_user_id")
            .maybeSingle()

          if (linkErr) {
            console.error("[vendor-list-tickets] vendor link auth_user_id", linkErr)
            return jsonResponse({ error: "Link failed" }, 500)
          }
          jwtVendor = linked ?? byEmail
        } else {
          jwtVendor = byEmail
        }
      }
    }

    if (!jwtVendor) {
      failReason("jwt vendor not found")
      return jsonResponse({ error: "Vendor not found" }, 403)
    }
    vendor = { id: jwtVendor.id, name: jwtVendor.name }
  } else if (PORTAL_API_KEY_UUID_RE.test(accessToken)) {
    // `?k=` / Bearer: per-ticket `vendor_action_token` (UUID). Not `portal_api_key`.
    console.log("[vendor-list-tickets] incoming token:", accessToken)

    const { data: ticket, error: tErr } = await supabase
      .from("maintenance_requests")
      .select("assigned_vendor_id")
      .eq("vendor_action_token", accessToken)
      .maybeSingle()

    if (tErr) {
      console.error("[vendor-list-tickets] ticket lookup error", tErr)
      return jsonResponse({ error: "Lookup failed" }, 500)
    }

    if (!ticket) {
      failReason("invalid or expired vendor_action_token")
      return jsonResponse({ error: "Invalid or expired vendor token" }, 403)
    }

    if (!ticket.assigned_vendor_id) {
      failReason("ticket has no assigned_vendor_id")
      return jsonResponse({ error: "Vendor not found or inactive" }, 403)
    }

    const { data: actionVendor, error: vErr } = await supabase
      .from("vendors")
      .select("id, name")
      .eq("id", ticket.assigned_vendor_id)
      .eq("active", true)
      .maybeSingle()

    if (vErr) {
      console.error("[vendor-list-tickets] vendor lookup", vErr)
      return jsonResponse({ error: "Lookup failed" }, 500)
    }

    if (!actionVendor) {
      failReason("vendor not found or inactive after token lookup")
      return jsonResponse({ error: "Vendor not found or inactive" }, 403)
    }

    vendor = { id: actionVendor.id, name: actionVendor.name }
  } else {
    return jsonResponse({ error: "Invalid Authorization token" }, 401)
  }

  if (!vendor) {
    failReason("vendor unresolved after auth branches")
    return jsonResponse({ error: "Vendor not found" }, 403)
  }

  const { data: rows, error: qErr } = await supabase
    .from("maintenance_requests")
    .select(
      "id, created_at, priority, urgency, resident_name, unit, description, photo_paths, vendor_work_status, assigned_vendor_id, due_at, estimated_minutes, severity, issue_category",
    )
    .eq("assigned_vendor_id", vendor.id)
    .order("created_at", { ascending: false })

  if (qErr) {
    console.error("[vendor-list-tickets] query", qErr)
    return jsonResponse({ error: "Query failed" }, 500)
  }

  const tickets = await Promise.all(
    (rows ?? []).map(async (row) => {
      const photo_urls = await photoSignedUrls(supabase, row.photo_paths)
      return { ...row, photo_urls }
    }),
  )

  const data = { vendor: { id: vendor.id, name: vendor.name }, tickets }
  console.log("[vendor-list-tickets] SUCCESS returning data")
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
})
