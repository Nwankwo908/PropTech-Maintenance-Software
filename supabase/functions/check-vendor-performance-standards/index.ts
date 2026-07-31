/**
 * Scheduled POST: Vendor Performance Standards (§7).
 *
 * Ratings / no-shows / acceptance → coaching, warnings, profile & suspension reviews.
 * Misconduct is handled via report-vendor-misconduct (immediate suspend).
 *
 *   curl -X POST ".../functions/v1/check-vendor-performance-standards" \
 *     -H "Authorization: Bearer $CHECK_VENDOR_PERFORMANCE_SECRET" \
 *     -H "Content-Type: application/json" \
 *     -d '{"landlord_id":"YOUR_LANDLORD_UUID"}'
 */
import { serve } from "https://deno.land/std/http/server.ts"
import { authorizedCronBearer } from "../_shared/admin_edge_auth.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { checkVendorPerformanceStandards } from "../_shared/vendor_performance/vendorPerformanceStandards.ts"

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
  if (!authorizedCronBearer(req, ["CHECK_VENDOR_PERFORMANCE_SECRET","CHECK_VENDOR_COMPLIANCE_EXPIRY_SECRET","CHECK_VENDOR_ONBOARDING_SECRET","ADMIN_REASSIGN_SECRET"])) {
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
    : Deno.env.get("DEFAULT_LANDLORD_ID")?.trim() ?? null

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  try {
    const summary = await checkVendorPerformanceStandards(supabase, landlordId)
    return jsonResponse({ ok: true, ...summary })
  } catch (err) {
    console.error("[check-vendor-performance-standards]", err)
    return jsonResponse(
      { error: err instanceof Error ? err.message : String(err) },
      500,
    )
  }
})
