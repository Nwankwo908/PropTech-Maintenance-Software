import { serve } from "https://deno.land/std/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

const uuidRe =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405)
  }

  let body: { token?: string; vendorId?: string }
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: "Expected JSON body" }, 400)
  }

  const token = typeof body.token === "string" ? body.token.trim() : ""
  const vendorId = typeof body.vendorId === "string" ? body.vendorId.trim() : ""

  if (!token || !vendorId || !uuidRe.test(vendorId)) {
    return jsonResponse({ error: "Missing or invalid token or vendorId" }, 400)
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim()
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim()
  if (!supabaseUrl || !serviceKey) {
    return jsonResponse({ error: "Server misconfiguration" }, 500)
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data: vendor, error: vErr } = await supabase
    .from("vendors")
    .select("id, email, portal_api_key, active")
    .eq("id", vendorId)
    .eq("active", true)
    .maybeSingle()

  if (vErr) {
    console.error("[vendor-verify-token] vendor load", vErr)
    return jsonResponse({ error: "Lookup failed" }, 500)
  }

  if (!vendor?.email?.trim()) {
    return jsonResponse({ error: "Invalid vendor" }, 403)
  }

  const portalKey =
    typeof vendor.portal_api_key === "string" ? vendor.portal_api_key.trim() : ""
  if (!portalKey || portalKey !== token) {
    return jsonResponse({ error: "Invalid token" }, 403)
  }

  const email = vendor.email.trim()

  const { data: linkData, error: linkErr } = await supabase.auth.admin.generateLink({
    type: "magiclink",
    email,
  })

  if (linkErr || !linkData) {
    console.error("[vendor-verify-token] generateLink", linkErr)
    return jsonResponse({ error: "Could not create login session" }, 500)
  }

  const props = linkData.properties as Record<string, unknown> | undefined
  const hashed_token =
    typeof props?.hashed_token === "string" ? props.hashed_token : null

  if (hashed_token) {
    return jsonResponse({ email, hashed_token })
  }

  const action_link = typeof props?.action_link === "string" ? props.action_link : null
  if (action_link) {
    try {
      const u = new URL(action_link)
      const hash = u.hash.startsWith("#") ? u.hash.slice(1) : u.hash
      const hp = new URLSearchParams(hash)
      const access_token = hp.get("access_token")
      const refresh_token = hp.get("refresh_token")
      if (access_token && refresh_token) {
        return jsonResponse({ access_token, refresh_token })
      }
    } catch {
      /* ignore */
    }
  }

  return jsonResponse({ error: "Login exchange not available" }, 500)
})
