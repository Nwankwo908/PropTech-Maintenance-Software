/**
 * Scheduled POST: evaluate high-confidence portfolio recommendations and surface
 * new proactive alerts (activity feed + notification bell).
 *
 * Schedule daily, e.g.:
 *   curl -X POST ".../functions/v1/check-proactive-recommendations" \
 *     -H "Authorization: Bearer $CHECK_PROACTIVE_RECOMMENDATIONS_SECRET" \
 *     -H "Content-Type: application/json" \
 *     -d '{"landlord_id":"YOUR_LANDLORD_UUID"}'
 */
import { serve } from "https://deno.land/std/http/server.ts"
import { authorizedCronBearer } from "../_shared/admin_edge_auth.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { runProactiveRecommendations } from "../_shared/portfolioIntelligence/runProactiveRecommendations.ts"

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

function resolveLandlordId(body: Record<string, unknown>): string | null {
  const fromBody = typeof body.landlord_id === "string"
    ? body.landlord_id.trim()
    : ""
  if (fromBody) return fromBody
  return Deno.env.get("DEFAULT_LANDLORD_ID")?.trim() ?? null
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
      "CHECK_PROACTIVE_RECOMMENDATIONS_SECRET",
      "CHECK_RENT_COLLECTION_SECRET",
      "RUN_WORKFLOW_ENGINE_SECRET",
    ])
  ) {
    return jsonResponse({ error: "Unauthorized" }, 401)
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim()
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim()
  if (!supabaseUrl || !serviceKey) {
    return jsonResponse(
      { error: "Server misconfiguration: missing Supabase credentials" },
      500,
    )
  }

  let body: Record<string, unknown> = {}
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    body = {}
  }

  const landlordId = resolveLandlordId(body)
  if (!landlordId) {
    return jsonResponse({ error: "landlord_id required" }, 400)
  }

  const supabase = createClient(supabaseUrl, serviceKey)

  try {
    const result = await runProactiveRecommendations(supabase, landlordId)
    return jsonResponse(result)
  } catch (err) {
    console.error("[check-proactive-recommendations] failed", err)
    return jsonResponse(
      { error: err instanceof Error ? err.message : "Proactive recommendations failed" },
      500,
    )
  }
})
