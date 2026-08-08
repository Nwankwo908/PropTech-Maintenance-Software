import { serve } from "https://deno.land/std/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { adminEdgeCorsHeaders } from "../_shared/admin_edge_cors.ts"
import { requireAdminReassignAuth } from "../_shared/admin_edge_auth.ts"
import { runMoveOutViaEngine } from "../_shared/engine/moveOutEngine.ts"
import type { MoveOutAdminEngineAction } from "../_shared/engine/moveOutProgress.ts"

const corsHeaders = adminEdgeCorsHeaders

const ENGINE_ACTIONS = new Set<MoveOutAdminEngineAction>([
  "send_reminder",
  "schedule_inspection",
  "mark_keys_returned",
  "complete_cleaning",
  "complete_move_out",
  "cancel_move_out",
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
  const adminAuth = requireAdminReassignAuth(req, "[run-move-out-action]", corsHeaders)
  if (!adminAuth.ok) return adminAuth.response

  let body: {
    landlordId?: string
    workflowRunId?: string
    action?: string
    scheduledAt?: string | null
  }
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: "Expected JSON body" }, 400)
  }

  const landlordId = typeof body.landlordId === "string" ? body.landlordId.trim() : ""
  const workflowRunId = typeof body.workflowRunId === "string"
    ? body.workflowRunId.trim()
    : ""
  const action = typeof body.action === "string" ? body.action.trim() : ""

  if (!landlordId || !workflowRunId || !action) {
    return jsonResponse({ error: "Missing landlordId, workflowRunId, or action" }, 400)
  }

  if (!ENGINE_ACTIONS.has(action as MoveOutAdminEngineAction)) {
    return jsonResponse({ error: "Unsupported move-out action" }, 400)
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim()
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim()
  if (!supabaseUrl || !serviceKey) {
    return jsonResponse({ error: "Server misconfiguration" }, 500)
  }

  const supabase = createClient(supabaseUrl, serviceKey)

  try {
    const engineResult = await runMoveOutViaEngine(supabase, {
      landlordId,
      runId: workflowRunId,
      trigger: "dashboard",
      moveOut: {
        action: action as MoveOutAdminEngineAction,
        scheduledAt: body.scheduledAt ?? null,
      },
    })

    const meta = engineResult?.metadata ?? {}
    if (meta.ok === false) {
      return jsonResponse(
        { ok: false, error: typeof meta.error === "string" ? meta.error : "Action failed" },
        400,
      )
    }

    return jsonResponse({
      ok: true,
      inspection_run_id: meta.inspection_run_id ?? null,
    })
  } catch (err) {
    console.error("[run-move-out-action]", err)
    const message = err instanceof Error ? err.message : String(err)
    return jsonResponse({ ok: false, error: message }, 400)
  }
})
