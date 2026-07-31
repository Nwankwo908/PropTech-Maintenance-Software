/**
 * POST: Property damage report → immediate vendor suspension (pending review).
 * Ulo does not pay claims — claims run through the vendor's COI.
 *
 * Body: { landlord_id, vendor_id, summary, reported_by?, maintenance_request_id? }
 */
import { serve } from "https://deno.land/std/http/server.ts"
import { authorizedCronBearer } from "../_shared/admin_edge_auth.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { reportPropertyDamage } from "../_shared/vendor_incident/vendorIncidentProtocols.ts"

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
  if (!authorizedCronBearer(req, ["REPORT_PROPERTY_DAMAGE_SECRET","REPORT_VENDOR_MISCONDUCT_SECRET","ADMIN_REASSIGN_SECRET"])) {
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
    return jsonResponse({ error: "Invalid JSON" }, 400)
  }

  const landlordId = typeof body.landlord_id === "string"
    ? body.landlord_id.trim()
    : ""
  const vendorId = typeof body.vendor_id === "string" ? body.vendor_id.trim() : ""
  const summary = typeof body.summary === "string" ? body.summary : ""
  const reportedBy = typeof body.reported_by === "string" ? body.reported_by : null
  const maintenanceRequestId = typeof body.maintenance_request_id === "string"
    ? body.maintenance_request_id
    : null

  if (!landlordId || !vendorId) {
    return jsonResponse({ error: "landlord_id and vendor_id required" }, 400)
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  try {
    const result = await reportPropertyDamage(supabase, {
      landlordId,
      vendorId,
      summary,
      reportedBy,
      maintenanceRequestId,
    })
    if (!result.ok) {
      return jsonResponse({ error: result.error ?? "failed" }, 400)
    }
    return jsonResponse({ ok: true, report_id: result.reportId })
  } catch (err) {
    console.error("[report-property-damage]", err)
    return jsonResponse(
      { error: err instanceof Error ? err.message : String(err) },
      500,
    )
  }
})
