import { serve } from "https://deno.land/std/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { authorizedCronBearer } from "../_shared/admin_edge_auth.ts"
import { retryFailedSupportNotifications } from "../_shared/support/retrySupportNotifications.ts"

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405)
  if (!authorizedCronBearer(req, ["ULO_OPS_CRON_SECRET", "ADMIN_REASSIGN_SECRET"])) {
    return jsonResponse({ error: "Unauthorized" }, 401)
  }
  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim()
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim()
  if (!supabaseUrl || !serviceKey) return jsonResponse({ error: "Server misconfiguration" }, 500)
  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const result = await retryFailedSupportNotifications(supabase)
  return jsonResponse(result)
})
