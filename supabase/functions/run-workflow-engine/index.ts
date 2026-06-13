/**
 * Programmatic workflow engine entry point.
 *
 * POST JSON:
 *   template_type  — workflow_templates.id (e.g. maintenance_intake, lease_renewal)
 *   entity_type    — sms_conversation | maintenance_request | user | unit
 *   entity_id      — UUID of the entity
 *   metadata       — optional workflow metadata (landlord_id may live here)
 *   landlord_id    — required if not in metadata
 *   trigger_type   — optional (default automation)
 *   property_id, resident_id, unit_id — optional graph links on workflow_runs
 *
 * Returns workflow_run_id and next_action derived from workflow_templates.route_config.
 */
import { serve } from "https://deno.land/std/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import {
  InvokeWorkflowError,
  invokeWorkflowEngine,
  parseInvokeWorkflowRequest,
} from "../_shared/engine/invokeWorkflow.ts"

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

function authorized(req: Request): boolean {
  const secret = Deno.env.get("RUN_WORKFLOW_ENGINE_SECRET")?.trim() ??
    Deno.env.get("RUN_WORKFLOW_TRIGGERS_SECRET")?.trim()
  if (!secret) return true
  const h = req.headers.get("Authorization")?.trim()
  if (!h?.toLowerCase().startsWith("bearer ")) return false
  return h.slice(7).trim() === secret
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405)
  }

  if (!authorized(req)) {
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
    return jsonResponse({ error: "Invalid JSON body" }, 400)
  }

  const supabase = createClient(supabaseUrl, serviceKey)

  try {
    const request = parseInvokeWorkflowRequest(body)
    const result = await invokeWorkflowEngine(supabase, request)

    return jsonResponse({
      ok: true,
      workflow_run_id: result.workflow_run_id,
      next_action: result.next_action,
      classified: result.classified,
      template_type: result.template_type,
      template: result.template,
      stages: result.stages,
    })
  } catch (err) {
    if (err instanceof InvokeWorkflowError) {
      return jsonResponse({ ok: false, error: err.message }, err.status)
    }

    const message = err instanceof Error ? err.message : String(err)
    console.error("[run-workflow-engine]", message)
    return jsonResponse({ ok: false, error: message }, 500)
  }
})
