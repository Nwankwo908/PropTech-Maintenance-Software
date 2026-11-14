import { serve } from "https://deno.land/std/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { adminEdgeCorsHeaders } from "../_shared/admin_edge_cors.ts"
import { authorizeAdminAccount } from "../_shared/adminAccountAuthorization.ts"
import { triggerMoveOutFromLeaseRenewal } from "../_shared/move_out_from_lease_renewal.ts"
import { isUuidShape } from "../_shared/uuid_shape.ts"

const corsHeaders = adminEdgeCorsHeaders

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
}

function readString(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed || null
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405)
  }


  let body: Record<string, unknown> = {}
  try {
    const parsed: unknown = await req.json()
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return jsonResponse({ error: "Expected JSON object" }, 400)
    body = parsed as Record<string, unknown>
  } catch {
    return jsonResponse({ error: "Expected JSON body" }, 400)
  }

  const leaseRenewalRunId = readString(body.leaseRenewalRunId)
  if (!leaseRenewalRunId || !isUuidShape(leaseRenewalRunId)) {
    return jsonResponse({ error: "Missing or invalid leaseRenewalRunId" }, 400)
  }

  const landlordId = readString(body.landlordId)
  if (!landlordId || !isUuidShape(landlordId)) {
    return jsonResponse({ error: "Missing or invalid landlordId" }, 400)
  }

  const denied = await authorizeAdminAccount(req, landlordId, corsHeaders)
  if (denied) return denied

  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim()
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim()
  if (!supabaseUrl || !serviceKey) {
    return jsonResponse({ error: "Server misconfiguration" }, 500)
  }

  const supabase = createClient(supabaseUrl, serviceKey)

  try {
    const { data: run, error } = await supabase.from("workflow_runs").select("id, resident_id, unit_id").eq("id", leaseRenewalRunId).eq("landlord_id", landlordId).eq("template_id", "lease_renewal").maybeSingle()
    if (error) return jsonResponse({ error: "Workflow lookup unavailable" }, 503)
    if (!run) return jsonResponse({ error: "Lease renewal not found" }, 404)
    if (!run.resident_id) return jsonResponse({ error: "Lease renewal has no resident" }, 400)
    const resident = await supabase.from("users").select("id").eq("id", run.resident_id).eq("landlord_id", landlordId).maybeSingle()
    if (resident.error) return jsonResponse({ error: "Resident lookup unavailable" }, 503)
    if (!resident.data) return jsonResponse({ error: "Resident not found" }, 404)
    if (run.unit_id) {
      const unit = await supabase.from("units").select("id").eq("id", run.unit_id).eq("landlord_id", landlordId).maybeSingle()
      if (unit.error) return jsonResponse({ error: "Unit lookup unavailable" }, 503)
      if (!unit.data) return jsonResponse({ error: "Unit not found" }, 404)
    }
    if (!run.unit_id) {
      const { data: occupancies, error } = await supabase.from("occupancy").select("unit_id").eq("landlord_id", landlordId).eq("resident_id", run.resident_id).eq("status", "active")
      if (error) return jsonResponse({ error: "Occupancy lookup unavailable" }, 503)
      for (const occupancy of occupancies ?? []) {
        if (!occupancy.unit_id) continue
        const unit = await supabase.from("units").select("id").eq("id", occupancy.unit_id).eq("landlord_id", landlordId).maybeSingle()
        if (unit.error) return jsonResponse({ error: "Unit lookup unavailable" }, 503)
        if (!unit.data) return jsonResponse({ error: "Unit not found" }, 404)
      }
    }
    const result = await triggerMoveOutFromLeaseRenewal(supabase, {
      landlordId,
      leaseRenewalRunId,
    })

    if (!result.ok) {
      return jsonResponse({ ok: false, error: result.error }, 400)
    }

    return jsonResponse({
      ok: true,
      lease_renewal_run_id: result.leaseRenewalRunId,
      move_out_run_id: result.moveOutRunId,
      conversation_id: result.conversationId,
    })
  } catch (err) {
    console.error("[trigger-move-out-from-lease-renewal]", err)
    const message = err instanceof Error ? err.message : String(err)
    return jsonResponse({ ok: false, error: message }, 500)
  }
})
