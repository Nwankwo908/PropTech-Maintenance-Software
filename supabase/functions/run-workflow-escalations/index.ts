/**
 * Scheduled POST: escalate workflow_runs waiting on tenant/vendor/admin past
 * workflow_templates.escalation_config thresholds (due_at or no_response_days).
 *
 * Schedule hourly or daily:
 *   curl -X POST ".../functions/v1/run-workflow-escalations" \
 *     -H "Authorization: Bearer $RUN_WORKFLOW_ESCALATIONS_SECRET" \
 *     -H "Content-Type: application/json" \
 *     -d '{"landlord_id":"YOUR_LANDLORD_UUID"}'
 */
import { serve } from "https://deno.land/std/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { runWorkflowEscalations } from "../_shared/engine/runWorkflowEscalations.ts"

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
  const secret = Deno.env.get("RUN_WORKFLOW_ESCALATIONS_SECRET")?.trim() ??
    Deno.env.get("CHECK_LEASE_RENEWALS_SECRET")?.trim() ??
    Deno.env.get("RUN_WORKFLOW_ENGINE_SECRET")?.trim() ??
    Deno.env.get("RUN_WORKFLOW_TRIGGERS_SECRET")?.trim()
  if (!secret) return true
  const h = req.headers.get("Authorization")?.trim()
  if (!h?.toLowerCase().startsWith("bearer ")) return false
  return h.slice(7).trim() === secret
}

function resolveLandlordId(body: Record<string, unknown>): string | null {
  const fromBody = typeof body.landlord_id === "string"
    ? body.landlord_id.trim()
    : ""
  if (fromBody) return fromBody

  return Deno.env.get("DEFAULT_LANDLORD_ID")?.trim() ?? null
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
    body = {}
  }

  const landlordId = resolveLandlordId(body)
  if (!landlordId) {
    return jsonResponse({ error: "landlord_id required" }, 400)
  }

  const supabase = createClient(supabaseUrl, serviceKey)

  try {
    const result = await runWorkflowEscalations(supabase, { landlordId })

    return jsonResponse({
      ok: true,
      landlord_id: result.landlord_id,
      summary: {
        candidates: result.candidates,
        escalated: result.escalated,
        skipped: result.skipped,
        errors: result.errors.length,
      },
      escalations: result.escalations,
      errors: result.errors,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error("[run-workflow-escalations]", message)
    return jsonResponse({ ok: false, error: message }, 500)
  }
})
