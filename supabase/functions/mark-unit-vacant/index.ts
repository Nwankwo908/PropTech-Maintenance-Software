import { serve } from "https://deno.land/std/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { adminEdgeCorsHeaders } from "../_shared/admin_edge_cors.ts"
import { authorizeAdminAccount } from "../_shared/adminAccountAuthorization.ts"
import { isUuidShape } from "../_shared/uuid_shape.ts"
import { markUnitVacant } from "../_shared/unitVacancy.ts"
import {
  findActiveMoveOutRunForUnit,
} from "../_shared/engine/moveOutProgress.ts"
import { runMoveOutViaEngine } from "../_shared/engine/moveOutEngine.ts"
import type { MoveOutAdminEngineAction } from "../_shared/engine/moveOutProgress.ts"

const corsHeaders = adminEdgeCorsHeaders

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
    unitLabel?: string
    building?: string | null
  }
  try {
    const parsed: unknown = await req.json()
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return jsonResponse({ error: "Expected JSON object" }, 400)
    body = parsed as typeof body
  } catch {
    return jsonResponse({ error: "Expected JSON body" }, 400)
  }

  const landlordId = typeof body.landlordId === "string" ? body.landlordId.trim() : ""
  const unitId = typeof body.unitId === "string" ? body.unitId.trim() : ""
  if (!isUuidShape(landlordId) || !isUuidShape(unitId)) {
    return jsonResponse({ error: "Missing landlordId or unitId" }, 400)
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
    const { data: unit, error } = await supabase.from("units").select("id, unit_label, building").eq("id", unitId).eq("landlord_id", landlordId).maybeSingle()
    if (error) return jsonResponse({ error: "Unit lookup unavailable" }, 503)
    if (!unit) return jsonResponse({ error: "Unit not found" }, 404)
    // Canonical scoped unit fields, never a conflicting client-provided label.
    body.unitLabel = String(unit.unit_label)
    body.building = typeof unit.building === "string" ? unit.building : null
    const activeRunId = await findActiveMoveOutRunForUnit(supabase, {
      landlordId,
      unitId,
    })

    if (activeRunId) {
      const engineResult = await runMoveOutViaEngine(supabase, {
        landlordId,
        runId: activeRunId,
        trigger: "dashboard",
        moveOut: {
          action: "mark_vacated",
          unitId,
          unitLabel: body.unitLabel,
          building: body.building,
        },
      })
      const meta = engineResult?.metadata ?? {}
      if (meta.ok === false) {
        return jsonResponse(
          { error: typeof meta.error === "string" ? meta.error : "Failed to mark unit vacant" },
          400,
        )
      }
      return jsonResponse({ ok: true, workflow_run_id: activeRunId, via_engine: true })
    }

    const result = await markUnitVacant(supabase, {
      landlordId,
      unitId,
      unitLabel: body.unitLabel,
      building: body.building,
    })

    return jsonResponse({ ok: true, ...result, via_engine: false })
  } catch (err) {
    console.error("[mark-unit-vacant]", err)
    const message = err instanceof Error ? err.message : String(err)
    return jsonResponse({ error: message }, 400)
  }
})
