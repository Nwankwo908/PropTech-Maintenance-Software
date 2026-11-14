import { serve } from "https://deno.land/std/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { authorizeAdminAccount } from "../_shared/adminAccountAuthorization.ts"
import { adminEdgeCorsHeaders } from "../_shared/admin_edge_cors.ts"

const corsHeaders = adminEdgeCorsHeaders
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })
  if (req.method !== "GET" && req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405)
  }
  let landlordId: unknown
  if (req.method === "GET") {
    landlordId = new URL(req.url).searchParams.get("landlordId")
  } else {
    try {
      const body: unknown = await req.json()
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        return jsonResponse({ error: "Expected JSON object" }, 400)
      }
      landlordId = (body as Record<string, unknown>).landlordId
    } catch {
      return jsonResponse({ error: "Expected JSON body" }, 400)
    }
  }
  if (typeof landlordId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(landlordId.trim())) {
    return jsonResponse({ error: "Missing or invalid landlordId" }, 400)
  }
  const accountId = landlordId.trim()
  const denied = await authorizeAdminAccount(req, accountId, corsHeaders)
  if (denied) return denied

  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim()
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim()
  if (!supabaseUrl || !serviceKey) {
    return jsonResponse({ error: "Statistics temporarily unavailable" }, 503)
  }
  const supabase = createClient(supabaseUrl, serviceKey)
  try {
    const now = Date.now()
    const { count: active, error: activeError } = await supabase
      .from("broadcast_notification_log")
      .select("*", { count: "exact", head: true })
      .eq("landlord_id", accountId)
      .eq("success", true)
      .gte("created_at", new Date(now - 24 * 60 * 60 * 1000).toISOString())
    if (activeError) return jsonResponse({ error: "Statistics temporarily unavailable" }, 503)

    const { data, error } = await supabase
      .from("broadcast_notification_log")
      .select("success, created_at")
      .eq("landlord_id", accountId)
      .gte("created_at", new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString())
    if (error) return jsonResponse({ error: "Statistics temporarily unavailable" }, 503)
    const success = data?.filter((row) => row.success).length ?? 0
    const failed = data?.filter((row) => !row.success).length ?? 0
    return jsonResponse({
      activeNotifications: active ?? 0,
      successRate: success + failed === 0 ? 0 : Math.round(success / (success + failed) * 100),
    })
  } catch {
    return jsonResponse({ error: "Statistics temporarily unavailable" }, 503)
  }
})
