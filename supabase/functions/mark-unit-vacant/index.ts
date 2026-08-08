import { serve } from "https://deno.land/std/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { adminEdgeCorsHeaders } from "../_shared/admin_edge_cors.ts"
import { requireAdminReassignAuth } from "../_shared/admin_edge_auth.ts"
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
  const adminAuth = requireAdminReassignAuth(req, "[mark-unit-vacant]", corsHeaders)
  if (!adminAuth.ok) return adminAuth.response

  let body: {
    landlordId?: string
    unitId?: string
    unitLabel?: string
    building?: string | null
  }
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: "Expected JSON body" }, 400)
  }

  const landlordId = typeof body.landlordId === "string" ? body.landlordId.trim() : ""
  const unitId = typeof body.unitId === "string" ? body.unitId.trim() : ""
  if (!landlordId || !unitId) {
    return jsonResponse({ error: "Missing landlordId or unitId" }, 400)
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim()
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim()
  if (!supabaseUrl || !serviceKey) {
    return jsonResponse({ error: "Server misconfiguration" }, 500)
  }

  const supabase = createClient(supabaseUrl, serviceKey)

  try {
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
