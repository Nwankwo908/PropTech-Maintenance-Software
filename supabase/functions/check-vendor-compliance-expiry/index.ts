/**
 * Scheduled POST: COI & license expiration management.
 *
 * 30 days before → SMS warning + renewal link (ACTIVE)
 * 7 days before  → 2nd SMS + Ulo ops notified (ACTIVE)
 * Expiry date    → Auto-SUSPENDED
 *
 *   curl -X POST ".../functions/v1/check-vendor-compliance-expiry" \
 *     -H "Authorization: Bearer $CHECK_VENDOR_COMPLIANCE_EXPIRY_SECRET" \
 *     -H "Content-Type: application/json" \
 *     -d '{"landlord_id":"YOUR_LANDLORD_UUID"}'
 */
import { serve } from "https://deno.land/std/http/server.ts"
import { authorizedCronBearer } from "../_shared/admin_edge_auth.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { checkVendorComplianceExpiry } from "../_shared/vendor_verification/vendorComplianceExpiry.ts"

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
  if (!authorizedCronBearer(req, ["CHECK_VENDOR_COMPLIANCE_EXPIRY_SECRET","CHECK_VENDOR_ONBOARDING_SECRET","CHECK_RENT_COLLECTION_SECRET","RUN_WORKFLOW_TRIGGERS_SECRET","ADMIN_REASSIGN_SECRET"])) {
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
    const summary = await checkVendorComplianceExpiry(supabase, landlordId)
    return jsonResponse({ ok: true, ...summary })
  } catch (err) {
    console.error("[check-vendor-compliance-expiry]", err)
    return jsonResponse(
      { error: err instanceof Error ? err.message : String(err) },
      500,
    )
  }
})
