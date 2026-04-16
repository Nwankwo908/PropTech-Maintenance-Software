import { serve } from "https://deno.land/std/http/server.ts"
import {
  createClient,
  type SupabaseClient,
} from "https://esm.sh/@supabase/supabase-js@2.49.1"

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

  const { data: auth, error: authErr } = await supabase.auth.getUser(accessToken)
  if (authErr || !auth?.user?.id) {
    console.error("[vendor-list-tickets] auth.getUser", authErr)
    return jsonResponse({ error: "Invalid or expired JWT" }, 401)
  }

  const authUid = auth.user.id
  const authEmail =
    typeof auth.user.email === "string" ? auth.user.email.trim().toLowerCase() : null

  let vendor: { id: string; name: string; auth_user_id: string | null } | null = null

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
    vendor = byUid
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
        vendor = linked ?? byEmail
      } else {
        vendor = byEmail
      }
    }
  }

  if (!vendor) {
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

  return jsonResponse({ vendor: { id: vendor.id, name: vendor.name }, tickets })
})
