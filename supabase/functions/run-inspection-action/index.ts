import { serve } from "https://deno.land/std/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { adminEdgeCorsHeaders } from "../_shared/admin_edge_cors.ts"
import { authorizeAdminAccount } from "../_shared/adminAccountAuthorization.ts"
import { runInspectionViaEngine } from "../_shared/engine/inspectionEngine.ts"
import type { InspectionAdminEngineAction } from "../_shared/engine/inspectionProgress.ts"

const corsHeaders = adminEdgeCorsHeaders
const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const ENGINE_ACTIONS = new Set<InspectionAdminEngineAction>([
  "send_reminder",
  "mark_no_show",
  "record_outcome",
  "complete_inspection",
  "cancel_inspection",
])

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
    workflowRunId?: string
    action?: string
    outcome?: string | null
    notes?: string | null
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

  const landlordId = typeof body.landlordId === "string" ? body.landlordId.trim() : ""
  const workflowRunId = typeof body.workflowRunId === "string"
    ? body.workflowRunId.trim()
    : ""
  const action = typeof body.action === "string" ? body.action.trim() : ""

  if (!uuidRe.test(landlordId) || !uuidRe.test(workflowRunId) || !action) {
    return jsonResponse({ error: "Missing landlordId, workflowRunId, or action" }, 400)
  }

  const denied = await authorizeAdminAccount(req, landlordId, corsHeaders)
  if (denied) return denied

  if (!ENGINE_ACTIONS.has(action as InspectionAdminEngineAction)) {
    return jsonResponse({ error: "Unsupported inspection action" }, 400)
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim()
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim()
  if (!supabaseUrl || !serviceKey) {
    return jsonResponse({ error: "Server misconfiguration" }, 500)
  }

  const supabase = createClient(supabaseUrl, serviceKey)

  try {
    const { data: run, error: runError } = await supabase
      .from("workflow_runs")
      .select("id, landlord_id")
      .eq("id", workflowRunId)
      .eq("landlord_id", landlordId)
      .eq("template_id", "inspection")
      .maybeSingle()
    if (runError) return jsonResponse({ error: "Workflow lookup unavailable" }, 503)
    if (!run) return jsonResponse({ error: "Workflow not found" }, 404)

    const engineResult = await runInspectionViaEngine(supabase, {
      landlordId,
      runId: workflowRunId,
      trigger: "dashboard",
      inspection: {
        action: action as InspectionAdminEngineAction,
        outcome: body.outcome ?? null,
        notes: body.notes ?? null,
      },
    })

    const meta = engineResult?.metadata ?? {}
    if (meta.ok === false) {
      return jsonResponse(
        { ok: false, error: typeof meta.error === "string" ? meta.error : "Action failed" },
        400,
      )
    }

    return jsonResponse({ ok: true })
  } catch (err) {
    console.error("[run-inspection-action]", err)
    const message = err instanceof Error ? err.message : String(err)
    return jsonResponse({ ok: false, error: message }, 400)
  }
})
