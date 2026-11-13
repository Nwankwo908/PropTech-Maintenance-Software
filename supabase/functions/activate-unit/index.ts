import { serve } from "https://deno.land/std/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { adminEdgeCorsHeaders } from "../_shared/admin_edge_cors.ts"
import { authorizeAdminAccount } from "../_shared/adminAccountAuthorization.ts"
import { activateUnit } from "../_shared/unitVacancy.ts"
import { startMoveInWorkflow } from "../_shared/engine/startWorkflow.ts"

const corsHeaders = adminEdgeCorsHeaders

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

  let body: {
    landlordId?: string
    unitId?: string
    skipTenantRegistration?: boolean
    tenantName?: string
    tenantPhone?: string
    tenantEmail?: string
    moveInDate?: string
    residentId?: string
  }
  try {
    const parsed: unknown = await req.json()
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return jsonResponse({ error: "Expected JSON object" }, 400)
    }
    body = parsed as typeof body
  } catch {
    return jsonResponse({ error: "Expected JSON body" }, 400)
  }

  const unitId = typeof body.unitId === "string" ? body.unitId.trim() : ""
  if (!unitId || !uuidRe.test(unitId)) {
    return jsonResponse({ error: "Missing or invalid unitId" }, 400)
  }
  const landlordId = typeof body.landlordId === "string" ? body.landlordId.trim() : ""
  if (!landlordId || !uuidRe.test(landlordId)) {
    return jsonResponse({ error: "Missing or invalid landlordId" }, 400)
  }
  const denied = await authorizeAdminAccount(req, landlordId, corsHeaders)
  if (denied) return denied
  const residentId = typeof body.residentId === "string" ? body.residentId.trim() : null
  if (residentId && !uuidRe.test(residentId)) {
    return jsonResponse({ error: "Invalid residentId" }, 400)
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim()
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim()
  if (!supabaseUrl || !serviceKey) {
    return jsonResponse({ error: "Server misconfiguration" }, 500)
  }

  const supabase = createClient(supabaseUrl, serviceKey)
  const skip = body.skipTenantRegistration === true

  try {
    const { data: unit, error: unitError } = await supabase
      .from("units").select("id, landlord_id")
      .eq("id", unitId).eq("landlord_id", landlordId).maybeSingle()
    if (unitError) return jsonResponse({ error: "Unit lookup unavailable" }, 503)
    if (!unit) return jsonResponse({ error: "Unit not found" }, 404)
    if (residentId) {
      const { data: resident, error: residentError } = await supabase
        .from("users").select("id, landlord_id")
        .eq("id", residentId).eq("landlord_id", landlordId).maybeSingle()
      if (residentError) return jsonResponse({ error: "Resident lookup unavailable" }, 503)
      if (!resident) return jsonResponse({ error: "Resident not found" }, 404)
    }
    if (skip) {
      const result = await activateUnit(supabase, {
        landlordId,
        unitId,
        skipTenantRegistration: true,
        residentId: residentId ?? undefined,
      })
      return jsonResponse({ ok: true, ...result })
    }

    const moveInDate = typeof body.moveInDate === "string" ? body.moveInDate.trim() : null

    const started = await startMoveInWorkflow(supabase, {
      landlordId,
      unitId,
      residentId,
      moveInDate,
      triggerType: "dashboard",
      classification: "new_occupancy",
      reuseActiveRun: true,
      initialAction: {
        moveIn: {
          action: "register_and_outreach",
          register: {
            tenantName: body.tenantName,
            tenantPhone: body.tenantPhone,
            tenantEmail: body.tenantEmail,
            moveInDate,
            residentId,
          },
        },
      },
    })

    const meta = started.engineResult?.metadata ?? {}
    if (meta.error || meta.ok === false) {
      return jsonResponse(
        { error: typeof meta.error === "string" ? meta.error : "Move-in activation failed" },
        400,
      )
    }

    const { data: runRow } = await supabase
      .from("workflow_runs")
      .select("metadata, resident_id")
      .eq("id", started.workflow_run_id)
      .maybeSingle()

    const runMeta = (runRow?.metadata ?? {}) as Record<string, unknown>
    return jsonResponse({
      ok: true,
      unitId,
      residentId: (runRow?.resident_id as string | null) ??
        (typeof meta.residentId === "string" ? meta.residentId : null) ??
        (typeof runMeta.resident_id === "string" ? runMeta.resident_id : null),
      occupancyId: typeof runMeta.occupancy_id === "string" ? runMeta.occupancy_id : null,
      skippedTenantRegistration: false,
      workflowRunId: started.workflow_run_id,
    })
  } catch (err) {
    console.error("[activate-unit]", err)
    const message = err instanceof Error ? err.message : String(err)
    return jsonResponse({ error: message }, 400)
  }
})
