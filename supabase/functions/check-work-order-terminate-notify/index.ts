/**
 * Scheduled POST: retry failed vendor terminate SMS notifications.
 */
import { serve } from "https://deno.land/std/http/server.ts"
import { authorizedCronBearer } from "../_shared/admin_edge_auth.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { processWorkOrderTerminateNotifyRetries } from "../_shared/terminateWorkOrder.ts"

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

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
  if (
    !authorizedCronBearer(req, [
      "CHECK_WORK_ORDER_TERMINATE_NOTIFY_SECRET",
      "ADMIN_REASSIGN_SECRET",
      "CHECK_LANDLORD_ESTIMATE_NOTIFY_SECRET",
    ])
  ) {
    return jsonResponse({ error: "Unauthorized" }, 401)
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim()
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim()
  if (!supabaseUrl || !serviceKey) {
    return jsonResponse({ error: "Server misconfiguration" }, 500)
  }

  let body: Record<string, unknown> = {}
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    body = {}
  }

  const landlordId = typeof body.landlord_id === "string"
    ? body.landlord_id.trim()
    : null

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  try {
    const summary = await processWorkOrderTerminateNotifyRetries(supabase, {
      landlordId,
    })
    return jsonResponse({ ok: true, ...summary })
  } catch (err) {
    console.error("[check-work-order-terminate-notify]", err)
    return jsonResponse(
      { error: err instanceof Error ? err.message : String(err) },
      500,
    )
  }
})
